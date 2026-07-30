import {parseDate} from "@internationalized/date";
import {findSpans} from "unicode-default-word-boundary";
import {createAccessPolicyForContentCreatedByBot} from "~/server/access/create_access_policy_for_content_created_by_bot.js";
import {ApiServiceBotActionContext} from "~/server/api/internal/shared/api_service_context.js";
import {createApiTaskMovePatchResultCursor} from "~/server/api/internal/tasks/internal/create_api_task_move_patch_result_cursor.js";
import {fromApiTaskLayout} from "~/server/api/internal/tasks/internal/from_api_task_layout.js";
import {resolveApiTaskMovesInCollection} from "~/server/api/internal/tasks/internal/resolve_api_task_moves_in_collection.js";
import {resolveApiTaskMovesInParent} from "~/server/api/internal/tasks/internal/resolve_api_task_moves_in_parent.js";
import {
    ApiTaskResolvedMove,
    ApiTaskUnresolvedMove,
} from "~/server/api/internal/tasks/internal/resolve_api_task_moves_in_scope.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {attachFileToTargetAsBot} from "~/server/files/data/attach_file_to_target_as_bot.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {FileTaskAuthorizer} from "~/server/tasks/data/authorization/file_task_authorizer.js";
import {commitTaskActionTransaction} from "~/server/tasks/data/commit_task_action_transaction.js";
import {createTaskNotesCreateTransactionEntry} from "~/server/tasks/data/create_task_notes_create_transaction_entry.js";
import {extractFileIdsFromApiContent} from "~/shared/api/content/closed_source/extract_file_ids_from_api_content.js";
import {fromApiContent} from "~/shared/api/content/closed_source/from_api_content.js";
import {
    ApiTaskBatchPatch,
    ApiTaskBatchPatchResult,
    ApiTaskCreateRequest,
    ApiTaskPatch,
    ApiTaskPatchResult,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {FailedPreconditionError, InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {NonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {
    HybridLogicalClock,
    HybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {diff} from "~/shared/helpers/diff/diff.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {
    OrderKey,
    generateOrderKeyBetween,
    initialOrderKey,
} from "~/shared/helpers/sort/order_key.js";
import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {collectReferencedIdsFromTaskAction} from "~/shared/tasks/actions/collect_referenced_ids_from_task_action.js";
import {TaskAction, TaskUpdateTaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskCreateAction} from "~/shared/tasks/actions/task_task_action.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskCreator} from "~/shared/tasks/task_creator.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {
    TaskNotesContentProsemirrorSchema,
    assertTaskNotesContent,
} from "~/shared/tasks/task_notes_content_schema.js";
import {TaskPosition} from "~/shared/tasks/task_position.js";
import {TaskRealtimeUpdateEvent} from "~/shared/tasks/task_realtime_protocol.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {
    TaskTitleModel,
    emptyTaskTitleModel,
    randomlyGenerateTaskTitleClientId,
} from "~/shared/tasks/title/task_title.js";

export const commitTaskPatchesFromApiBeforeLoadNewReferencesTestCheckpoint =
    new TestCheckpoint<AccountId>();

/**
 * The single write path for API task endpoints. Applies creates and updates in
 * request order and commits every generated action in one atomic
 * `commitTaskActionTransaction()`.
 *
 * `PATCH /tasks` maps its request body onto this function directly. `POST /tasks`
 * and `PATCH /tasks/{id}` are narrower variants: a single create patch and a list
 * of update patches for a single task respectively.
 *
 * Notes patches are handled separately by `updateTaskNotesFromApi()` since they
 * target the notes collaboration Durable Object rather than task action
 * transactions. The initial notes of a created task, however, are committed here
 * atomically with the task's `Create` action.
 */
export async function commitTaskPatchesFromApi(
    context: ApiServiceBotActionContext,
    {
        spaceId,
        actorId: originalActorId,
        patches,
    }: {
        spaceId: SpaceId;
        actorId?: AccountId;
        patches: ReadonlyArray<ApiTaskBatchPatch>;
    },
): Promise<{
    /** The committed task models, one per unique task in first-patch order. */
    tasks: ReadonlyArray<TaskModel>;
    updateEvent: Pick<
        TaskRealtimeUpdateEvent,
        "backfillTasks" | "backfillCollections" | "referencedAccounts"
    >;
    results: ReadonlyArray<ApiTaskBatchPatchResult>;
}> {
    const botAccountId = context.actor.getBotAccountId();
    const actorId = originalActorId ?? botAccountId;

    const clock = new HybridLogicalClock(unsynchronizedSystemClock);
    const timeZone = defaultTimeZone;
    const currentTime = new Date();

    const orderedTaskIds: Array<TaskId> = [];
    const updateTaskIds: Array<TaskId> = [];
    const seenUpdateTaskIds = new Set<TaskId>();
    const steps: Array<ApiTaskCommitStep> = [];
    const extraTransactionEntries: Array<DynamoTransactionEntry> = [];
    const fileAttachmentPromises: Array<Promise<void>> = [];
    let hasCreates = false;

    // The patch results each batch patch's steps write into, indexed by batch patch.
    // Assembled into `ApiTaskBatchPatchResult`s after action generation.
    const patchResultsByPatchIndex: Array<Array<ApiTaskPatchResult | null>> = [];
    const createTaskIdByPatchIndex = new Map<number, TaskId>();

    patches.forEach((patch, patchIndex) => {
        switch (patch.type) {
            case "Create": {
                hasCreates = true;
                const taskId = generateId<TaskId>();

                const creatorId = patch.task.creator?.id ?? actorId;

                steps.push({
                    type: "CreateTask",
                    taskId,
                    creator: {
                        accountId: creatorId,
                        from:
                            creatorId !== botAccountId
                                ? {type: "Bot", accountId: botAccountId}
                                : null,
                    },
                });

                for (const fieldPatch of createApiTaskPatchesFromCreateRequest(patch.task)) {
                    steps.push({
                        type: "ApplyPatch",
                        taskId,
                        patch: fieldPatch,
                        resultSlot: null,
                    });
                }

                // The create's own patches apply on top of the fields the create request
                // initialized. They support every task patch, notably the moves, which can't be
                // expressed in a create request.
                const patchResults: Array<ApiTaskPatchResult | null> = createArrayWithLength(
                    patch.patches?.length ?? 0,
                    () => null,
                );

                patch.patches?.forEach((taskPatch, taskPatchIndex) => {
                    steps.push({
                        type: "ApplyPatch",
                        taskId,
                        patch: taskPatch,
                        resultSlot: {results: patchResults, index: taskPatchIndex},
                    });
                });

                patchResultsByPatchIndex[patchIndex] = patchResults;
                createTaskIdByPatchIndex.set(patchIndex, taskId);

                if (patch.task.notes) {
                    const notesContent = assertTaskNotesContent(
                        fromApiContent(TaskNotesContentProsemirrorSchema, patch.task.notes.content),
                    );

                    // The initial notes commit atomically with the task. If we used
                    // `commitTaskActionTransaction()` to create the task and then made a follow-up
                    // `updateTaskNotesContent()` write then would allow the task to be created even if
                    // persisting its notes failed and the API endpoint wouldn't be atomic.
                    extraTransactionEntries.push(
                        createTaskNotesCreateTransactionEntry({
                            spaceId,
                            taskId,
                            content: notesContent,
                            createdTime: currentTime,
                        }),
                    );

                    // Attach files referenced in the notes before creating the task so there's no race
                    // where a reader sees the task before its files are attached. Attaching files is
                    // adjacent to task creation, but it is not part of the task write itself, so it
                    // does not need to be atomic with the task transaction.
                    for (const fileId of extractFileIdsFromApiContent(patch.task.notes.content)) {
                        fileAttachmentPromises.push(
                            attachFileToTargetAsBot(
                                context,
                                fileId,
                                FileTaskAuthorizer.bind({type: "TaskNotes", taskId}),
                            ),
                        );
                    }
                }

                orderedTaskIds.push(taskId);
                break;
            }
            case "Update": {
                const patchResults: Array<ApiTaskPatchResult | null> = [null];

                steps.push({
                    type: "ApplyPatch",
                    taskId: patch.id,
                    patch: patch.patch,
                    resultSlot: {results: patchResults, index: 0},
                });

                patchResultsByPatchIndex[patchIndex] = patchResults;

                if (!seenUpdateTaskIds.has(patch.id)) {
                    seenUpdateTaskIds.add(patch.id);
                    orderedTaskIds.push(patch.id);
                    updateTaskIds.push(patch.id);
                }
                break;
            }
            default:
                throw exhaustive(patch);
        }
    });

    const [result, createAccessPolicy] = await runAllPromises([
        // TODO(calebmer): An optimization that would be pretty nice here is if we move
        // notes loading into `TaskRealtimeService`. Currently we have to load the data for
        // bot authorization twice. Once here in `ApiService` and again in
        // `TaskRealtimeService`. If we pushed task notes loading into
        // `TaskRealtimeService` then we could leverage `ContextCache` to only load the bot
        // authorization data once.
        updateTaskIds.length > 0
            ? context.tasks.loadQueries(
                  spaceId,
                  {
                      queries: [],
                      taskIds: updateTaskIds,
                      collectionIds: [],
                  },
                  {consistency: "StrongWithinCache"},
              )
            : null,

        // Every task created by this commit shares one access policy: content created by
        // this bot in this space.
        hasCreates
            ? createAccessPolicyForContentCreatedByBot(context, spaceId, {
                  consistency: "StrongWithinCache",
              })
            : null,

        runAllPromises(fileAttachmentPromises),
    ]);

    // If the task is not found or you don't have permission to access the task then
    // `loadQueries()` will throw an error.
    const backfillAuthorizedTaskById = new Map<TaskId, TaskModel>();

    if (result) {
        for (const backfillTask of result.updateEvent.backfillTasks) {
            if (backfillTask.type === "Authorized") {
                backfillAuthorizedTaskById.set(backfillTask.task.id, backfillTask.task);
            }
        }
    }

    const initialTasks = updateTaskIds.map(taskId =>
        assertExists(backfillAuthorizedTaskById.get(taskId)),
    );

    // `MoveInParent` moves within the parent established by preceding patches for the
    // same task. Resolve those destinations before preparing moves.
    const parentTaskIdByTaskId = new Map(
        initialTasks.map(task => [task.id, task.getParent()?.taskId ?? null]),
    );

    // Group the move patches by the scope they move within. Each scope resolves its
    // moves together so moves to the same destination land in patch order and tied
    // destinations are re-keyed exactly once.
    const moveScopeByKey = new Map<string, ApiTaskMoveScope>();

    steps.forEach((step, stepIndex) => {
        if (step.type === "CreateTask") {
            // A created task starts without a parent. A derived `SetParent` step below may
            // establish one.
            parentTaskIdByTaskId.set(step.taskId, null);
            return;
        }

        const {taskId, patch} = step;

        switch (patch.type) {
            case "SetParent": {
                parentTaskIdByTaskId.set(taskId, patch.parent?.task.id ?? null);
                break;
            }
            case "MoveInCollection": {
                const moveScope = getOrSetDefaultMapValue(
                    moveScopeByKey,
                    JSON.stringify(["Collection", patch.collectionId]),
                    (): ApiTaskMoveScope => ({
                        type: "Collection",
                        collectionId: patch.collectionId,
                        moves: [],
                    }),
                );

                moveScope.moves.push({patchIndex: stepIndex, taskId, position: patch.position});
                break;
            }
            case "MoveInParent": {
                const parentTaskId = parentTaskIdByTaskId.get(taskId);

                // Without a parent there's no scope to move within. Generating actions for this
                // patch below throws the request error.
                if (parentTaskId == null) break;

                const moveScope = getOrSetDefaultMapValue(
                    moveScopeByKey,
                    JSON.stringify(["Parent", parentTaskId]),
                    (): ApiTaskMoveScope => ({type: "Parent", parentTaskId, moves: []}),
                );

                moveScope.moves.push({patchIndex: stepIndex, taskId, position: patch.position});
                break;
            }
            default:
                break;
        }
    });

    const resolvedMoveMaps = await runAllPromises(
        Array.from(moveScopeByKey.values(), moveScope => {
            switch (moveScope.type) {
                case "Collection": {
                    return resolveApiTaskMovesInCollection(
                        context,
                        spaceId,
                        moveScope.collectionId,
                        moveScope.moves,
                    );
                }
                case "Parent": {
                    return resolveApiTaskMovesInParent(
                        context,
                        spaceId,
                        moveScope.parentTaskId,
                        moveScope.moves,
                    );
                }
                default:
                    throw exhaustive(moveScope);
            }
        }),
    );

    const resolvedMoveByStepIndex = new Map<number, ApiTaskResolvedMove>();

    for (const resolvedMoveMap of resolvedMoveMaps) {
        for (const [stepIndex, resolvedMove] of resolvedMoveMap) {
            resolvedMoveByStepIndex.set(stepIndex, resolvedMove);
        }
    }

    // Make sure all times we generate are higher than the times in the tasks we're
    // updating. That includes tasks that were tied with a move destination since we
    // update their positions too.
    {
        for (const initialTask of initialTasks) initialTask.tick(clock);

        for (const resolvedMove of resolvedMoveByStepIndex.values()) {
            for (const tiedTaskUpdate of resolvedMove.tiedTaskUpdates) {
                tiedTaskUpdate.task.tick(clock);
            }
        }
    }

    const stateByTaskId = new Map<TaskId, ApiTaskCommitTaskState>();

    for (const initialTask of initialTasks) {
        stateByTaskId.set(initialTask.id, {
            title: initialTask.getTitle(),
            assigneeId: initialTask.getAssignee()?.assignee.accountId ?? null,
            parentTaskId: initialTask.getParent()?.taskId ?? null,
            collectionIds: new Set(
                initialTask
                    .getCollections()
                    .getArray()
                    .map(({collectionId}) => collectionId),
            ),
            lastCollectionOrderKey: initialTask.getCollections().getLastOrderKey(),
        });
    }

    const actions: Array<TaskUpdateTaskAction> = [];
    const createActionByTaskId = new Map<
        TaskId,
        {time: HybridLogicalTime; taskAction: TaskCreateAction}
    >();

    // A move cursor needs the moved task's created time: the `Create` action time for
    // tasks created in this batch, the loaded task's created time otherwise.
    function getTaskCreatedTimeForMoveCursor(taskId: TaskId): HybridLogicalTime {
        return (
            createActionByTaskId.get(taskId)?.time ??
            assertExists(backfillAuthorizedTaskById.get(taskId)).getCreatedTime().absoluteTime
        );
    }

    for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
        const step = steps[stepIndex]!;

        if (step.type === "CreateTask") {
            stateByTaskId.set(step.taskId, {
                title: emptyTaskTitleModel.get(),
                assigneeId: null,
                parentTaskId: null,
                collectionIds: new Set(),
                lastCollectionOrderKey: null,
            });

            const taskAction: TaskCreateAction = {
                type: "Create",
                creator: step.creator,
                creatorTimeZone: timeZone,
                accessPolicy: assertExists(createAccessPolicy),
            };

            const time = clock.now();

            actions.push({type: "UpdateTask", time, taskId: step.taskId, taskAction});
            createActionByTaskId.set(step.taskId, {time, taskAction});
            continue;
        }

        const {taskId, patch, resultSlot} = step;
        const state = assertExists(stateByTaskId.get(taskId));

        switch (patch.type) {
            case "SetTitle": {
                setStepPatchResult(resultSlot, {type: "SetTitle"});

                const titleUpdates: Array<{from: number; to: number; text: string}> = [];

                const oldTokens = Array.from(findSpans(state.title.getText()), ({text}) => text);
                const newTokens = Array.from(findSpans(patch.title), ({text}) => text);

                const changes = diff(oldTokens, newTokens, {equals: (a, b) => a === b});

                let pendingHunk: {
                    from: number;
                    removedLength: number;
                    added: string;
                } | null = null;

                let oldPos = 0;
                let posDifference = 0;

                for (const change of changes) {
                    switch (change.type) {
                        case "Added": {
                            pendingHunk ??= {
                                from: oldPos + posDifference,
                                removedLength: 0,
                                added: "",
                            };

                            pendingHunk.added += change.newToken;
                            posDifference += change.newToken.length;
                            break;
                        }
                        case "Removed": {
                            pendingHunk ??= {
                                from: oldPos + posDifference,
                                removedLength: 0,
                                added: "",
                            };

                            pendingHunk.removedLength += change.oldToken.length;
                            posDifference -= change.oldToken.length;
                            oldPos += change.oldToken.length;
                            break;
                        }
                        case "Equal": {
                            if (pendingHunk !== null) {
                                titleUpdates.push({
                                    from: pendingHunk.from,
                                    to: pendingHunk.from + pendingHunk.removedLength,
                                    text: pendingHunk.added,
                                });
                                pendingHunk = null;
                            }

                            oldPos += change.oldToken.length;
                            break;
                        }
                        default:
                            throw exhaustive(change);
                    }
                }

                if (pendingHunk !== null) {
                    titleUpdates.push({
                        from: pendingHunk.from,
                        to: pendingHunk.from + pendingHunk.removedLength,
                        text: pendingHunk.added,
                    });
                    pendingHunk = null;
                }

                if (titleUpdates.length === 0) break;

                const titleUpdate = state.title.replaceMany(
                    randomlyGenerateTaskTitleClientId(),
                    titleUpdates,
                );

                actions.push({
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {type: "UpdateTitle", titleUpdate: titleUpdate.raw},
                });

                state.title = titleUpdate.newTitle;
                break;
            }
            case "SetAssignee": {
                setStepPatchResult(resultSlot, {type: "SetAssignee"});

                const assigneeId = patch.assignee?.id ?? null;
                const time = clock.now();

                actions.push({
                    type: "UpdateTask",
                    time,
                    taskId,
                    taskAction: {
                        type: "UpdateAssignee",
                        assignee:
                            assigneeId !== null
                                ? {
                                      assigneeId,
                                      assignerId: botAccountId,
                                      assignedTime: new TaskFilterableTime({
                                          absoluteTime: time,
                                          setterTimeZone: timeZone,
                                      }),
                                  }
                                : null,

                        // Remember: updating the assignee resets the assignee status register. This is the
                        // desired behavior as that's what happens in the product when you change the
                        // assignee.
                    },
                });

                state.assigneeId = assigneeId;
                break;
            }
            case "SetStatus": {
                setStepPatchResult(resultSlot, {type: "SetStatus"});

                switch (patch.status.type) {
                    case "Closed": {
                        const time = clock.now();

                        actions.push({
                            type: "UpdateTask",
                            time,
                            taskId,
                            taskAction: {
                                type: "UpdateStatus",
                                status: {
                                    type: "Closed",
                                    closerId: botAccountId,
                                    closedTime: new TaskFilterableTime({
                                        absoluteTime: time,
                                        setterTimeZone: timeZone,
                                    }),
                                },
                            },
                        });
                        break;
                    }
                    case "Open": {
                        if (!patch.status.isActive) {
                            const time = clock.now();

                            actions.push({
                                type: "UpdateTask",
                                time,
                                taskId,
                                taskAction: {
                                    type: "UpdateStatus",
                                    status: {type: "Open"},
                                },
                            });
                        } else {
                            // A task can't be active unless it has an assignee. So if the task doesn't
                            // currently have an assignee, assign it to the bot. This is what the UI will do.
                            // If you try to mark an unassigned task as active it will assign you to the task.
                            if (state.assigneeId === null) {
                                const time1 = clock.now();

                                actions.push({
                                    type: "UpdateTask",
                                    time: time1,
                                    taskId,
                                    taskAction: {
                                        type: "UpdateAssignee",
                                        assignee: {
                                            assigneeId: botAccountId,
                                            assignerId: botAccountId,
                                            assignedTime: new TaskFilterableTime({
                                                absoluteTime: time1,
                                                setterTimeZone: timeZone,
                                            }),
                                        },
                                    },
                                });

                                state.assigneeId = botAccountId;
                            }

                            const time2 = clock.now();

                            actions.push({
                                type: "UpdateTask",
                                time: time2,
                                taskId,
                                taskAction: {
                                    type: "UpdateStatus",
                                    status: {type: "Open"},
                                    assigneeStatus: {
                                        type: "Active",
                                        activatedTime: new TaskFilterableTime({
                                            absoluteTime: time2,
                                            setterTimeZone: timeZone,
                                        }),
                                    },
                                },
                            });
                        }
                        break;
                    }
                    default:
                        throw exhaustive(patch.status);
                }
                break;
            }
            case "SetDue": {
                setStepPatchResult(resultSlot, {type: "SetDue"});

                const dueDate = patch.due ? parseDate(patch.due.date) : null;

                actions.push({
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {type: "UpdateDueDate", dueDate},
                });
                break;
            }
            case "SetPriority": {
                setStepPatchResult(resultSlot, {type: "SetPriority"});

                const priority = patch.priority?.type ?? null;

                actions.push({
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {type: "UpdatePriority", priority},
                });
                break;
            }
            case "SetLayout": {
                setStepPatchResult(resultSlot, {type: "SetLayout"});

                const layout = fromApiTaskLayout(patch.layout);

                actions.push({
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {type: "UpdateLayout", layout},
                });
                break;
            }
            case "SetParent": {
                setStepPatchResult(resultSlot, {type: "SetParent"});

                const parentTaskId = patch.parent?.task.id ?? null;

                actions.push({
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {type: "UpdateParentTaskId", parentTaskId},
                });

                state.parentTaskId = parentTaskId;
                break;
            }
            case "AddCollection": {
                setStepPatchResult(resultSlot, {type: "AddCollection"});

                const collectionId = patch.item.collection.id;
                const orderKey = generateOrderKeyBetween(state.lastCollectionOrderKey, null);

                actions.push({
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {type: "AddCollection", collectionId, orderKey},
                });

                state.lastCollectionOrderKey = orderKey;
                state.collectionIds.add(collectionId);
                break;
            }
            case "RemoveCollection": {
                setStepPatchResult(resultSlot, {type: "RemoveCollection"});

                const collectionId = patch.collectionId;

                actions.push({
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {type: "RemoveCollection", collectionId},
                });

                state.collectionIds.delete(collectionId);
                break;
            }
            case "MoveInCollection": {
                const {collectionId} = patch;

                if (!state.collectionIds.has(collectionId)) {
                    throw new InvalidArgumentError(
                        "Trying to move task when it\u2019s not in collection",
                        {
                            displayMessage: errorDisplayMessage`The task isn\u2019t in the collection you\u2019re moving it within. Try again after adding the task to the collection with an \`AddCollection\` patch.`,
                        },
                    );
                }

                const resolvedMove = assertExists(resolvedMoveByStepIndex.get(stepIndex));

                const positionUpdates = createApiTaskMovePositionUpdates(
                    taskId,
                    resolvedMove,
                    clock,
                );

                setStepPatchResult(resultSlot, {
                    type: "MoveInCollection",
                    cursor: createApiTaskMovePatchResultCursor({
                        id: taskId,
                        createdTime: getTaskCreatedTimeForMoveCursor(taskId),
                        position: positionUpdates[0].position,
                        scope: {type: "Collection", collectionId},
                    }),
                });

                for (const update of positionUpdates) {
                    actions.push({
                        type: "UpdateTask",
                        time: update.time,
                        taskId: update.taskId,
                        taskAction: {
                            type: "UpdateCollectionPosition",
                            collectionId,
                            position: update.position,
                        },
                    });
                }
                break;
            }
            case "MoveInParent": {
                if (state.parentTaskId === null) {
                    throw new InvalidArgumentError("Trying to move a task without a parent", {
                        displayMessage: errorDisplayMessage`The task doesn\u2019t have a parent to move within. Try again after setting the task\u2019s parent with a \`SetParent\` patch.`,
                    });
                }

                const resolvedMove = assertExists(resolvedMoveByStepIndex.get(stepIndex));

                const positionUpdates = createApiTaskMovePositionUpdates(
                    taskId,
                    resolvedMove,
                    clock,
                );

                setStepPatchResult(resultSlot, {
                    type: "MoveInParent",
                    cursor: createApiTaskMovePatchResultCursor({
                        id: taskId,
                        createdTime: getTaskCreatedTimeForMoveCursor(taskId),
                        position: positionUpdates[0].position,
                        scope: {type: "Parent"},
                    }),
                });

                for (const update of positionUpdates) {
                    actions.push({
                        type: "UpdateTask",
                        time: update.time,
                        taskId: update.taskId,
                        taskAction: {
                            type: "UpdateParentPosition",
                            parentPosition: update.position,
                        },
                    });
                }
                break;
            }
            default:
                throw exhaustive(patch);
        }
    }

    const results = createApiTaskBatchPatchResults({
        patches,
        patchResultsByPatchIndex,
        createTaskIdByPatchIndex,
    });

    if (actions.length === 0) {
        return {
            tasks: initialTasks,
            updateEvent: result?.updateEvent ?? {
                backfillTasks: [],
                backfillCollections: [],
                referencedAccounts: [],
            },
            results,
        };
    }

    // The update event we loaded above only backfills the tasks' references from
    // before the patch. Load any parent task, collections, or assignee account the
    // batch newly references (including everything created tasks reference) so the API
    // response can include their data.
    const newParentTaskIds = new Set(
        filterMapIterable(actions, (action): TaskId | undefined => {
            if (action.type !== "UpdateTask") return;
            if (action.taskAction.type !== "UpdateParentTaskId") return;
            if (action.taskAction.parentTaskId === null) return;
            return action.taskAction.parentTaskId;
        }),
    );

    const newCollectionIds = new Set(
        filterMapIterable(actions, (action): TaskCollectionId | undefined => {
            if (action.type !== "UpdateTask") return;
            if (action.taskAction.type !== "AddCollection") return;
            return action.taskAction.collectionId;
        }),
    );

    const newAssigneeIds = new Set(
        filterMapIterable(actions, (action): AccountId | undefined => {
            if (action.type !== "UpdateTask") return;
            if (action.taskAction.type !== "UpdateAssignee") return;
            return action.taskAction.assignee?.assigneeId;
        }),
    );

    const hasNewParentTasks = newParentTaskIds.size > 0;
    const hasNewCollections = newCollectionIds.size > 0;

    const [{extraActions}, taskSortableAccountById, newReferencesResult, newAssigneeAccounts] =
        await runAllPromises([
            commitTaskActionTransaction(context, spaceId, actions, {
                actorId,
                consistency: "StrongWithinCache",
                // Very important! For the API to have read-after-write consistency we need to wait
                // until our actions have been sent to every `TaskRealtimeService`. Then future
                // reads against `TaskRealtimeService` will return the data we wrote.
                waitForProcessing: true,
                extraTransactionEntries:
                    extraTransactionEntries.length > 0 ? extraTransactionEntries : undefined,
            }),
            // We're loading references so eventual consistency is ok.
            loadTaskSortableAccountsForActions(context.dynamo.unexpectStrongReadConsistency(), {
                spaceId,
                initialTasks,
                actions,
            }),
            hasNewParentTasks || hasNewCollections
                ? captureResultPromise(
                      (async () => {
                          // The transaction and this load normally run concurrently. The checkpoint lets
                          // tests delay only the load so access can change after the transaction commits.
                          await commitTaskPatchesFromApiBeforeLoadNewReferencesTestCheckpoint.waitForTest(
                              botAccountId,
                          );

                          return await context.dynamo
                              .unexpectStrongReadConsistency()
                              .tasks.loadQueries(spaceId, {
                                  queries: [],
                                  taskIds: Array.from(newParentTaskIds),
                                  collectionIds: Array.from(newCollectionIds),
                              });
                      })(),
                  )
                : null,
            runAllPromises(
                Array.from(newAssigneeIds, assigneeId =>
                    getAccount(context.dynamo.unexpectStrongReadConsistency(), spaceId, assigneeId),
                ),
            ),
        ]);

    function getTaskSortableAccount(accountId: AccountId): TaskSortableAccount {
        return assertExists(taskSortableAccountById.get(accountId));
    }

    // Build the response models by replaying the committed actions: created tasks
    // start from their `Create` action, updated tasks start from the task we loaded.
    // Move patches may also update other tasks that share a position, so only apply
    // the actions targeting each requested task.
    const tasks = orderedTaskIds.map(taskId => {
        const createAction = createActionByTaskId.get(taskId);

        let task =
            createAction !== undefined
                ? TaskModel.createFromAction(
                      spaceId,
                      taskId,
                      createAction.time,
                      createAction.taskAction,
                      getTaskSortableAccount,
                  )
                : assertExists(backfillAuthorizedTaskById.get(taskId));

        for (const action of concatIterables(actions, extraActions)) {
            if (action.type !== "UpdateTask") continue;
            if (action.taskId !== taskId) continue;
            if (action.taskAction.type === "Create") continue;
            task = task.applyAction(action, getTaskSortableAccount);
        }

        return task;
    });

    let referencesUpdateEvent: TaskRealtimeUpdateEvent | null = null;

    if (newReferencesResult) {
        if (newReferencesResult.ok) {
            referencesUpdateEvent = newReferencesResult.value.updateEvent;
        } else {
            const displayMessage =
                hasNewParentTasks && hasNewCollections
                    ? errorDisplayMessage`Update was successful, but we couldn\u2019t load the referenced parent task or a referenced collection. This was probably due to a race condition. Try reading the updated task again.`
                    : hasNewParentTasks
                      ? errorDisplayMessage`Update was successful, but we couldn\u2019t load the referenced parent task. This was probably due to a race condition. Try reading the updated task again.`
                      : errorDisplayMessage`Update was successful, but we couldn\u2019t load a referenced collection. This was probably due to a race condition. Try reading the updated task again.`;

            throw FailedPreconditionError.from(
                newReferencesResult.error,
                "Task update committed but newly referenced tasks or collections couldn\u2019t be loaded",
                {displayMessage},
            );
        }
    }

    let updateEvent: Pick<
        TaskRealtimeUpdateEvent,
        "backfillTasks" | "backfillCollections" | "referencedAccounts"
    > = result?.updateEvent ?? {
        backfillTasks: [],
        backfillCollections: [],
        referencedAccounts: [],
    };

    updateEvent = {
        backfillTasks: [
            ...updateEvent.backfillTasks,
            ...(referencesUpdateEvent?.backfillTasks ?? []),
            ...tasks.map(task => ({type: "Authorized" as const, task})),
        ],

        backfillCollections:
            referencesUpdateEvent === null
                ? updateEvent.backfillCollections
                : [
                      ...updateEvent.backfillCollections,
                      ...referencesUpdateEvent.backfillCollections,
                  ],

        referencedAccounts:
            referencesUpdateEvent === null && newAssigneeAccounts.length === 0
                ? updateEvent.referencedAccounts
                : [
                      ...updateEvent.referencedAccounts,
                      ...(referencesUpdateEvent?.referencedAccounts ?? []),
                      ...newAssigneeAccounts,
                  ],
    };

    return {
        tasks,
        updateEvent,
        results,
    };
}

/**
 * A unit of action generation. A create patch expands into a `CreateTask` step
 * followed by an `ApplyPatch` step for each field the create request initializes
 * and each of the create's own patches, an update patch is a single `ApplyPatch`
 * step. This lets creates and updates share one action generation path.
 */
type ApiTaskCommitStep =
    | {type: "CreateTask"; taskId: TaskId; creator: TaskCreator}
    | {
          type: "ApplyPatch";
          taskId: TaskId;
          patch: ApiTaskPatch;

          // Where this step's patch result is recorded, or `null` for the field steps
          // derived from a create request's fields (the created task itself is their
          // result).
          resultSlot: ApiTaskCommitStepResultSlot | null;
      };

/**
 * One cell of a batch patch's results: `results[index]`. An update patch has a
 * single cell, a create patch has one cell per patch in its `patches` list.
 */
type ApiTaskCommitStepResultSlot = {
    results: Array<ApiTaskPatchResult | null>;
    index: number;
};

/**
 * A scope tasks move within: one collection's tasks or one parent's subtasks.
 */
type ApiTaskMoveScope =
    | {type: "Collection"; collectionId: TaskCollectionId; moves: Array<ApiTaskUnresolvedMove>}
    | {type: "Parent"; parentTaskId: TaskId; moves: Array<ApiTaskUnresolvedMove>};

/**
 * The working state of one task as its patches generate actions. Later patches in
 * the batch see the fields established by earlier ones. Created tasks start from a
 * blank state.
 */
type ApiTaskCommitTaskState = {
    title: TaskTitleModel;
    assigneeId: AccountId | null;
    parentTaskId: TaskId | null;
    collectionIds: Set<TaskCollectionId>;
    lastCollectionOrderKey: OrderKey | null;
};

/**
 * Translates a create request's fields into the task patches that initialize them.
 * A create commits as a `Create` action followed by these patches, flowing through
 * the same action generation as updates. The assignee patch comes before the
 * status patch so an active status sees the requested assignee.
 */
function createApiTaskPatchesFromCreateRequest(task: ApiTaskCreateRequest): Array<ApiTaskPatch> {
    const patches: Array<ApiTaskPatch> = [];

    if (task.title !== undefined) patches.push({type: "SetTitle", title: task.title});
    if (task.assignee !== undefined) patches.push({type: "SetAssignee", assignee: task.assignee});
    if (task.status !== undefined) patches.push({type: "SetStatus", status: task.status});
    if (task.due !== undefined) patches.push({type: "SetDue", due: task.due});
    if (task.priority !== undefined) patches.push({type: "SetPriority", priority: task.priority});
    if (task.layout !== undefined) patches.push({type: "SetLayout", layout: task.layout});
    if (task.parent !== undefined) patches.push({type: "SetParent", parent: task.parent});

    // The product treats a task's collections as a set, so drop duplicate collection
    // IDs instead of adding the same collection twice.
    const collectionIds = new Set<TaskCollectionId>();
    for (const item of task.collections ?? []) {
        if (collectionIds.has(item.collection.id)) continue;
        collectionIds.add(item.collection.id);
        patches.push({type: "AddCollection", item});
    }

    return patches;
}

/**
 * Records an `ApplyPatch` step's result in its owning batch patch's result list.
 * Does nothing for the steps derived from a create request's fields, which have no
 * result slot.
 */
function setStepPatchResult(
    resultSlot: ApiTaskCommitStepResultSlot | null,
    result: ApiTaskPatchResult,
): void {
    if (resultSlot === null) return;
    resultSlot.results[resultSlot.index] = result;
}

/**
 * Converts a resolved move into the position updates to commit: the moved task's
 * new position followed by re-keys for the tasks that shared a `TaskPosition` with
 * a move destination.
 *
 * The first item is always the new position for the `taskId`.
 */
function createApiTaskMovePositionUpdates(
    taskId: TaskId,
    resolvedMove: ApiTaskResolvedMove,
    clock: HybridLogicalClock,
): NonEmptyReadonlyArray<{taskId: TaskId; time: HybridLogicalTime; position: TaskPosition}> {
    const time = clock.now();

    let position: TaskPosition;

    switch (resolvedMove.position.type) {
        case "FreshOrderTime": {
            // A fresh `orderTime` with the initial `orderKey` sorts below every existing
            // position. Reusing the action time keeps later moves in the same batch sorted
            // below earlier ones.
            position = {orderTime: time, orderKey: initialOrderKey};
            break;
        }
        case "Assigned": {
            position = resolvedMove.position.position;
            break;
        }
        default:
            throw exhaustive(resolvedMove.position);
    }

    return [
        {taskId, time, position},
        ...resolvedMove.tiedTaskUpdates.map(tiedTaskUpdate => ({
            taskId: tiedTaskUpdate.task.id,
            time: clock.now(),
            position: tiedTaskUpdate.position,
        })),
    ];
}

/**
 * Pairs each batch patch with its result: the created task's ID and its patches'
 * results for creates, the single patch result for updates.
 */
function createApiTaskBatchPatchResults({
    patches,
    patchResultsByPatchIndex,
    createTaskIdByPatchIndex,
}: {
    patches: ReadonlyArray<ApiTaskBatchPatch>;
    patchResultsByPatchIndex: ReadonlyArray<ReadonlyArray<ApiTaskPatchResult | null>>;
    createTaskIdByPatchIndex: ReadonlyMap<number, TaskId>;
}): Array<ApiTaskBatchPatchResult> {
    return patches.map((patch, patchIndex): ApiTaskBatchPatchResult => {
        const patchResults = assertExists(patchResultsByPatchIndex[patchIndex]);

        switch (patch.type) {
            case "Create":
                return {
                    type: "Create",
                    task: {id: assertExists(createTaskIdByPatchIndex.get(patchIndex))},
                    results: patchResults.map(patchResult => assertExists(patchResult)),
                };
            case "Update":
                return {type: "Update", result: assertExists(patchResults[0])};
            default:
                throw exhaustive(patch);
        }
    });
}

/**
 * Load the sortable account payloads needed to apply the generated actions to the
 * in-memory `TaskModel`s.
 */
async function loadTaskSortableAccountsForActions(
    context: ApiServiceBotActionContext,
    {
        spaceId,
        initialTasks,
        actions,
    }: {
        spaceId: SpaceId;
        initialTasks: ReadonlyArray<TaskModel>;
        actions: ReadonlyArray<TaskAction>;
    },
): Promise<Map<AccountId, TaskSortableAccount>> {
    const accountIds = new Set<AccountId>();
    for (const action of actions) {
        collectReferencedIdsFromTaskAction(accountIds, new Set(), action);
    }

    // Seed the lookup from the tasks' embedded sortable accounts so we only fetch
    // accounts newly introduced by this patch batch.
    const taskSortableAccountById = new Map<AccountId, TaskSortableAccount>();
    for (const initialTask of initialTasks) {
        for (const taskSortableAccount of getTaskSortableAccountsFromTask(initialTask)) {
            taskSortableAccountById.set(taskSortableAccount.accountId, taskSortableAccount);
        }
    }

    const missingAccountIds = [...accountIds].filter(
        accountId => !taskSortableAccountById.has(accountId),
    );

    const missingAccounts = await runAllPromises(
        missingAccountIds.map(accountId => getAccount(context, spaceId, accountId)),
    );

    // `TaskModel.applyAction()` needs sortable account payloads, not bare account IDs,
    // so load and cache any referenced accounts that weren't already present on the
    // task.
    for (let i = 0; i < missingAccountIds.length; i++) {
        const missingAccount = missingAccounts[i]!;

        taskSortableAccountById.set(missingAccount.id, {
            accountId: missingAccount.id,
            workingAccountName: missingAccount.initialData.name,
            workingAccountNameVersion: missingAccount.initialData.nameVersion,
        });
    }

    return taskSortableAccountById;
}

/**
 * Collects the sortable account payloads already present on the task so local
 * action application can reuse them before loading anything missing.
 */
function getTaskSortableAccountsFromTask(task: TaskModel): Array<TaskSortableAccount> {
    const taskSortableAccounts: Array<TaskSortableAccount> = [task.rawData.creator];

    if (task.rawData.status.value.type === "Closed") {
        taskSortableAccounts.push(task.rawData.status.value.closer);
    }

    if (task.rawData.assignee.value) {
        taskSortableAccounts.push(task.rawData.assignee.value.assignee);
        taskSortableAccounts.push(task.rawData.assignee.value.assigner);
    }

    return taskSortableAccounts;
}
