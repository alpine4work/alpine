import {parseDate} from "@internationalized/date";
import {findSpans} from "unicode-default-word-boundary";
import {ApiServiceBotActionContext} from "~/server/api/internal/shared/api_service_context.js";
import {
    ApiTaskMovePreparedPositionStateShared as PreparedApiTaskMovePatchSharedState,
    ApiTaskMovePreparedPositionState as PreparedApiTaskMovePatchState,
    createApiTaskMovePositionUpdates as createApiTaskMovePatchUpdates,
} from "~/server/api/internal/tasks/internal/create_api_task_move_position_updates.js";
import {fromApiTaskLayout} from "~/server/api/internal/tasks/internal/from_api_task_layout.js";
import {prepareApiTaskMoveInCollectionPatch} from "~/server/api/internal/tasks/internal/prepare_api_task_move_in_collection_patch.js";
import {prepareApiTaskMoveInParentPatch} from "~/server/api/internal/tasks/internal/prepare_api_task_move_in_parent_patch.js";
import {PreparedApiTaskMovePatch} from "~/server/api/internal/tasks/internal/prepare_api_task_move_patch.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {commitTaskActionTransaction} from "~/server/tasks/data/commit_task_action_transaction.js";
import {ApiTaskPatch} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {diff} from "~/shared/helpers/diff/diff.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {generateOrderKeyBetween} from "~/shared/helpers/sort/order_key.js";
import {AccountId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {collectReferencedIdsFromTaskAction} from "~/shared/tasks/actions/collect_referenced_ids_from_task_action.js";
import {TaskAction, TaskUpdateTaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskActor} from "~/shared/tasks/task_creator.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskRealtimeUpdateEvent} from "~/shared/tasks/task_realtime_protocol.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {randomlyGenerateTaskTitleClientId} from "~/shared/tasks/title/task_title.js";

export type ApiTaskIdPatch = {
    readonly id: TaskId;
    readonly patch: ApiTaskPatch;
};

/**
 * Applies API task metadata patches, commits the resulting task actions, and
 * returns the updated task model used for the response.
 *
 * Notes patches are handled separately by `updateTaskNotesFromApi()` since they
 * target the notes collaboration Durable Object rather than task action
 * transactions.
 */
export async function updateTaskWithoutNotesFromApi(
    context: ApiServiceBotActionContext,
    {
        spaceId,
        taskId,
        actorId,
        patches,
    }: {
        spaceId: SpaceId;
        taskId: TaskId;
        actorId?: AccountId;
        patches: ReadonlyArray<ApiTaskPatch>;
    },
): Promise<{
    updatedTask: TaskModel;
    updateEvent: TaskRealtimeUpdateEvent;
}> {
    const result = await updateTasksWithoutNotesFromApi(context, {
        spaceId,
        actorId,
        patches: patches.map(patch => ({id: taskId, patch})),
    });

    return {updatedTask: assertExists(result.updatedTasks[0]), updateEvent: result.updateEvent};
}

/**
 * Applies patches to multiple tasks in request order and commits every generated
 * action in one transaction.
 */
export async function updateTasksWithoutNotesFromApi(
    context: ApiServiceBotActionContext,
    {
        spaceId,
        actorId,
        patches,
    }: {
        spaceId: SpaceId;
        actorId?: AccountId;
        patches: ReadonlyArray<ApiTaskIdPatch>;
    },
): Promise<{
    updatedTasks: ReadonlyArray<TaskModel>;
    updateEvent: TaskRealtimeUpdateEvent;
}> {
    const botAccountId = context.actor.getBotAccountId();
    const clock = new HybridLogicalClock(unsynchronizedSystemClock);
    const timeZone = defaultTimeZone;

    const actor: TaskActor = {
        accountId: actorId ?? botAccountId,
        from: {type: "Bot", accountId: botAccountId},
    };

    const taskIds = Array.from(new Set(patches.map(({id}) => id)));

    // TODO(calebmer): An optimization that would be pretty nice here is if we move
    // notes loading into `TaskRealtimeService`. Currently we have to load the data for
    // bot authorization twice. Once here in `ApiService` and again in
    // `TaskRealtimeService`. If we pushed task notes loading into
    // `TaskRealtimeService` then we could leverage `ContextCache` to only load the bot
    // authorization data once.
    const result = await context.tasks.loadQueries(
        // NOCOMMIT: What happens if task exists but in a different space? We should throw
        // some kind of error.
        spaceId,
        {
            queries: [],
            taskIds,
            collectionIds: [],
        },
        {consistency: "StrongWithinCache"},
    );

    // If the task is not found or you don't have permission to access the task then
    // `loadQueries()` will throw an error.
    //
    // NOCOMMIT: Test not found and permission denied errors from the task update
    // endpoint
    const backfillAuthorizedTaskById = new Map<TaskId, TaskModel>();

    for (const backfillTask of result.updateEvent.backfillTasks) {
        if (backfillTask.type === "Authorized") {
            backfillAuthorizedTaskById.set(backfillTask.task.id, backfillTask.task);
        }
    }

    const initialTasks = taskIds.map(taskId =>
        assertExists(backfillAuthorizedTaskById.get(taskId)),
    );

    // `MoveInParent` uses the parent established by preceding patches for the same
    // task. Resolve those destinations before preparing moves in parallel.
    const parentTaskIdByTaskId = new Map(
        initialTasks.map(task => [task.id, task.getParent()?.taskId ?? null]),
    );

    const preparedPromiseByKey = new Map<
        string,
        {
            shared: PreparedApiTaskMovePatchSharedState;
            promise: Promise<PreparedApiTaskMovePatch>;
        }
    >();
    const movedTaskIdsByScopeKey = new Map<string, Set<TaskId>>();

    const preparedStates = await runAllPromises(
        patches.map(({id, patch}): Promise<PreparedApiTaskMovePatchState> | null => {
            if (patch.type === "SetParent") {
                parentTaskIdByTaskId.set(id, patch.parent?.task.id ?? null);
                return null;
            }

            if (patch.type === "MoveInCollection") {
                const scopeKey = JSON.stringify(["Collection", patch.collectionId]);
                const movedTaskIdsInScope = getOrSetDefaultMapValue(
                    movedTaskIdsByScopeKey,
                    scopeKey,
                    () => new Set<TaskId>(),
                );
                movedTaskIdsInScope.add(id);

                const key = JSON.stringify(["Collection", patch.collectionId, patch.position]);

                const preparedPromise = getOrSetDefaultMapValue(preparedPromiseByKey, key, () => ({
                    shared: {
                        count: 0,
                        orderKeys: null,
                        hasUpdatedTiedTasks: false,
                        movedTaskIdsInScope,
                    },
                    promise: prepareApiTaskMoveInCollectionPatch(context, spaceId, patch),
                }));

                const index = preparedPromise.shared.count++;

                return preparedPromise.promise.then(position => ({
                    index,
                    shared: preparedPromise.shared,
                    position,
                }));
            }

            if (patch.type === "MoveInParent") {
                const moveParentTaskId = parentTaskIdByTaskId.get(id);
                if (moveParentTaskId == null) return null;

                const scopeKey = JSON.stringify(["Parent", moveParentTaskId]);
                const movedTaskIdsInScope = getOrSetDefaultMapValue(
                    movedTaskIdsByScopeKey,
                    scopeKey,
                    () => new Set<TaskId>(),
                );
                movedTaskIdsInScope.add(id);

                const key = JSON.stringify(["Parent", moveParentTaskId, patch.position]);

                const preparedPromise = getOrSetDefaultMapValue(preparedPromiseByKey, key, () => ({
                    shared: {
                        count: 0,
                        orderKeys: null,
                        hasUpdatedTiedTasks: false,
                        movedTaskIdsInScope,
                    },
                    promise: prepareApiTaskMoveInParentPatch(
                        context,
                        spaceId,
                        moveParentTaskId,
                        patch,
                    ),
                }));

                const index = preparedPromise.shared.count++;

                return preparedPromise.promise.then(position => ({
                    index,
                    shared: preparedPromise.shared,
                    position,
                }));
            }

            return null;
        }),
    );

    // Make sure all times we generate are higher than the times in the tasks we're
    // updating. That includes tasks sharing a position with a move destination since
    // we update their positions too.
    {
        for (const initialTask of initialTasks) initialTask.tick(clock);

        for (const preparedState of preparedStates) {
            if (preparedState?.position.type !== "BetweenTied") continue;

            for (const tiedTask of preparedState.position.tiedTasksToUpdate) {
                tiedTask.tick(clock);
            }
        }
    }

    const stateByTaskId = new Map(
        initialTasks.map(initialTask => [
            initialTask.id,
            {
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
            },
        ]),
    );
    const actions: Array<TaskUpdateTaskAction> = [];

    for (let patchIndex = 0; patchIndex < patches.length; patchIndex++) {
        const {id: taskId, patch} = patches[patchIndex]!;
        const state = assertExists(stateByTaskId.get(taskId));

        switch (patch.type) {
            case "SetTitle": {
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
                    actor,
                    taskId,
                    taskAction: {type: "UpdateTitle", titleUpdate: titleUpdate.raw},
                });

                state.title = titleUpdate.newTitle;
                break;
            }
            case "SetAssignee": {
                const assigneeId = patch.assignee?.id ?? null;
                const time = clock.now();

                actions.push({
                    type: "UpdateTask",
                    time,
                    actor,
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
                switch (patch.status.type) {
                    case "Closed": {
                        const time = clock.now();

                        actions.push({
                            type: "UpdateTask",
                            time,
                            actor,
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
                                actor,
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
                                    actor,
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
                                actor,
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
                const dueDate = patch.due ? parseDate(patch.due.date) : null;

                actions.push({
                    type: "UpdateTask",
                    time: clock.now(),
                    actor,
                    taskId,
                    taskAction: {type: "UpdateDueDate", dueDate},
                });
                break;
            }
            case "SetPriority": {
                const priority = patch.priority?.type ?? null;

                actions.push({
                    type: "UpdateTask",
                    time: clock.now(),
                    actor,
                    taskId,
                    taskAction: {type: "UpdatePriority", priority},
                });
                break;
            }
            case "SetLayout": {
                const layout = fromApiTaskLayout(patch.layout);

                actions.push({
                    type: "UpdateTask",
                    time: clock.now(),
                    actor,
                    taskId,
                    taskAction: {type: "UpdateLayout", layout},
                });
                break;
            }
            case "SetParent": {
                const parentTaskId = patch.parent?.task.id ?? null;

                actions.push({
                    type: "UpdateTask",
                    time: clock.now(),
                    actor,
                    taskId,
                    taskAction: {type: "UpdateParentTaskId", parentTaskId},
                });

                state.parentTaskId = parentTaskId;
                break;
            }
            case "AddCollection": {
                const collectionId = patch.item.collection.id;
                const orderKey = generateOrderKeyBetween(state.lastCollectionOrderKey, null);

                actions.push({
                    type: "UpdateTask",
                    time: clock.now(),
                    actor,
                    taskId,
                    taskAction: {type: "AddCollection", collectionId, orderKey},
                });

                state.lastCollectionOrderKey = orderKey;
                state.collectionIds.add(collectionId);
                break;
            }
            case "RemoveCollection": {
                const collectionId = patch.collectionId;

                actions.push({
                    type: "UpdateTask",
                    time: clock.now(),
                    actor,
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

                const preparedState = assertExists(preparedStates[patchIndex]);

                for (const update of createApiTaskMovePatchUpdates(taskId, preparedState, clock)) {
                    actions.push({
                        type: "UpdateTask",
                        time: update.time,
                        actor,
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

                const preparedState = assertExists(preparedStates[patchIndex]);

                for (const update of createApiTaskMovePatchUpdates(taskId, preparedState, clock)) {
                    actions.push({
                        type: "UpdateTask",
                        time: update.time,
                        actor,
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

    if (actions.length === 0) return {updatedTasks: initialTasks, updateEvent: result.updateEvent};

    // The update event we loaded above only backfills the task's references from
    // before the patch. Load any parent task, collections, or assignee account the
    // patch newly references so the API response can include their data.
    const newParentTaskIds = filterMapArray(actions, (action): TaskId | undefined => {
        if (action.type !== "UpdateTask") return;
        if (action.taskAction.type !== "UpdateParentTaskId") return;
        if (action.taskAction.parentTaskId === null) return;
        return action.taskAction.parentTaskId;
    });

    const newCollectionIds = filterMapArray(actions, (action): TaskCollectionId | undefined => {
        if (action.type !== "UpdateTask") return;
        if (action.taskAction.type !== "AddCollection") return;
        return action.taskAction.collectionId;
    });

    const newAssigneeIds = new Set<AccountId>();
    for (const initialTask of initialTasks) {
        const initialAssigneeId = initialTask.getAssignee()?.assignee.accountId ?? null;
        const assigneeId = assertExists(stateByTaskId.get(initialTask.id)).assigneeId;

        if (assigneeId !== null && assigneeId !== initialAssigneeId) {
            newAssigneeIds.add(assigneeId);
        }
    }

    const [, taskSortableAccountById, newReferencesResult, newAssigneeAccounts] =
        await runAllPromises([
            commitTaskActionTransaction(context, spaceId, actions, {
                consistency: "StrongWithinCache",
                // Very important! For the API to have read-after-write consistency we need to wait
                // until our actions have been sent to every `TaskRealtimeService`. Then future
                // reads against `TaskRealtimeService` will return the data we wrote.
                waitForProcessing: true,
            }),
            // We're loading references so eventual consistency is ok.
            loadTaskSortableAccountsForActions(context.dynamo.unexpectStrongReadConsistency(), {
                spaceId,
                initialTasks,
                actions,
            }),
            newParentTaskIds.length > 0 || newCollectionIds.length > 0
                ? context.tasks.loadQueries(
                      spaceId,
                      {
                          queries: [],
                          taskIds: Array.from(new Set(newParentTaskIds)),
                          collectionIds: Array.from(new Set(newCollectionIds)),
                      },
                      {consistency: "StrongWithinCache"},
                  )
                : null,
            runAllPromises(
                Array.from(newAssigneeIds, assigneeId =>
                    getAccount(context.dynamo.unexpectStrongReadConsistency(), spaceId, assigneeId),
                ),
            ),
        ]);

    // Move patches may also update other tasks that share a position. Apply every
    // action targeting a requested task to that task's response model.
    const updatedTasks = initialTasks.map(initialTask =>
        applyActionsToTaskModel(
            initialTask,
            actions.filter(action => action.taskId === initialTask.id),
            taskSortableAccountById,
        ),
    );

    let updateEvent = result.updateEvent;

    updateEvent = {
        ...updateEvent,

        backfillTasks: [
            ...updateEvent.backfillTasks,
            ...(newReferencesResult?.updateEvent.backfillTasks ?? []),
            ...updatedTasks.map(task => ({type: "Authorized" as const, task})),
        ],

        backfillCollections:
            newReferencesResult === null
                ? updateEvent.backfillCollections
                : [
                      ...updateEvent.backfillCollections,
                      ...newReferencesResult.updateEvent.backfillCollections,
                  ],

        referencedAccounts:
            newReferencesResult === null && newAssigneeAccounts.length === 0
                ? updateEvent.referencedAccounts
                : [
                      ...updateEvent.referencedAccounts,
                      ...(newReferencesResult?.updateEvent.referencedAccounts ?? []),
                      ...newAssigneeAccounts,
                  ],
    };

    return {
        updatedTasks,
        updateEvent,
    };
}

/**
 * Applies the generated actions to the loaded task model so the route can build a
 * response without refetching the task.
 */
function applyActionsToTaskModel(
    initialTask: TaskModel,
    actions: ReadonlyArray<TaskUpdateTaskAction>,
    taskSortableAccountById: ReadonlyMap<AccountId, TaskSortableAccount>,
): TaskModel {
    let updatedTask = initialTask;
    for (const action of actions) {
        updatedTask = updatedTask.applyAction(action, accountId =>
            assertExists(taskSortableAccountById.get(accountId)),
        );
    }
    return updatedTask;
}

/**
 * Load the sortable account payloads needed to apply the generated actions to the
 * in-memory `TaskModel`.
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
