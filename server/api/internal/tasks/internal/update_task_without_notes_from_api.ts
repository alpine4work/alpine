import {parseDate} from "@internationalized/date";
import {findSpans} from "unicode-default-word-boundary";
import {ApiServiceBotActionContext} from "~/server/api/internal/shared/api_service_context.js";
import {fromApiTaskLayout} from "~/server/api/internal/tasks/internal/from_api_task_layout.js";
import {
    ApiTaskMoveInCollectionPreparedPosition,
    prepareApiTaskMoveInCollectionPatch,
} from "~/server/api/internal/tasks/internal/prepare_api_task_move_in_collection_patch.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {commitTaskActionTransaction} from "~/server/tasks/data/commit_task_action_transaction.js";
import {ApiTaskPatch} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {diff} from "~/shared/helpers/diff/diff.js";
import {TimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {
    OrderKey,
    generateOrderKeyBetween,
    generateOrderKeysBetween,
    initialOrderKey,
} from "~/shared/helpers/sort/order_key.js";
import {MaybeReadonlyArray} from "~/shared/helpers/types/maybe_array.js";
import {AccountId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {collectReferencedIdsFromTaskAction} from "~/shared/tasks/actions/collect_referenced_ids_from_task_action.js";
import {TaskAction, TaskUpdateTaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskActor} from "~/shared/tasks/task_creator.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskRealtimeUpdateEvent} from "~/shared/tasks/task_realtime_protocol.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {
    TaskTitleModel,
    randomlyGenerateTaskTitleClientId,
} from "~/shared/tasks/title/task_title.js";

/**
 * The task state we track while turning API patches into task actions one-by-one.
 * Each patch generates actions against the state left behind by the patches before
 * it (starting from the loaded task) so patches in one request compose the same
 * way they would across many requests.
 */
type TaskPatchState = {
    title: TaskTitleModel;
    assigneeId: AccountId | null;
    lastCollectionOrderKey: OrderKey | null;
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
    const botAccountId = context.actor.getBotAccountId();
    const clock = new HybridLogicalClock(unsynchronizedSystemClock);
    const timeZone = defaultTimeZone;

    const actor: TaskActor = {
        accountId: actorId ?? botAccountId,
        from: {type: "Bot", accountId: botAccountId},
    };

    // TODO(calebmer): An optimization that would be pretty nice here is if we move
    // notes loading into `TaskRealtimeService`. Currently we have to load the data for
    // bot authorization twice. Once here in `ApiService` and again in
    // `TaskRealtimeService`. If we pushed task notes loading into
    // `TaskRealtimeService` then we could leverage `ContextCache` to only load the bot
    // authorization data once.
    //
    // Load the task we're patching and prepare any `MoveInCollection` patches at the
    // same time. Moves may need query data (like the first task in a collection) that
    // doesn't depend on the task we're patching, so all of this loading can happen in
    // parallel.
    const [result, preparedMovePositions] = await runAllPromises([
        context.tasks.loadQueries(
            // NOCOMMIT: What happens if task exists but in a different space? We should throw
            // some kind of error.
            spaceId,
            {
                queries: [],
                taskIds: [taskId],
                collectionIds: [],
            },
            {consistency: "StrongWithinCache"},
        ),
        runAllPromises(
            patches.map(patch =>
                patch.type === "MoveInCollection"
                    ? prepareApiTaskMoveInCollectionPatch(context, spaceId, patch)
                    : null,
            ),
        ),
    ]);

    // If the task is not found or you don't have permission to access the task then
    // `loadQueries()` will throw an error.
    //
    // NOCOMMIT: Test not found and permission denied errors from the task update
    // endpoint
    const initialTask = assertExists(
        findMapIterable(result.updateEvent.backfillTasks, backfillTask =>
            backfillTask.type === "Authorized" && backfillTask.task.id === taskId
                ? backfillTask.task
                : undefined,
        ),
    );

    // Make sure all times we generate are higher than the times in the tasks we're
    // updating. That includes tasks sharing a position with a move destination since
    // we update their positions too.
    initialTask.tick(clock);
    for (const preparedMovePosition of preparedMovePositions) {
        if (preparedMovePosition?.type !== "BetweenTied") continue;

        for (const tiedTask of preparedMovePosition.tiedTasksToUpdate) {
            tiedTask.tick(clock);
        }
    }

    const {actions, state} = createTaskActionsFromApiTaskPatches({
        initialTask,
        patches,
        preparedMovePositions,
        clock,
        botAccountId,
        actor,
        timeZone,
    });

    if (actions.length === 0) return {updatedTask: initialTask, updateEvent: result.updateEvent};

    // The update event we loaded above only backfills the task's references from
    // before the patch. Load any parent task, collections, or assignee account the
    // patch newly references so the API response can include their data.
    const initialAssigneeId = initialTask.getAssignee()?.assignee.accountId ?? null;

    const newParentTaskIds = actions.flatMap((action): MaybeReadonlyArray<TaskId> => {
        if (action.type !== "UpdateTask") return emptyArray;
        if (action.taskAction.type !== "UpdateParentTaskId") return emptyArray;
        if (action.taskAction.parentTaskId === null) return emptyArray;
        return action.taskAction.parentTaskId;
    });

    const newCollectionIds = actions.flatMap((action): MaybeReadonlyArray<TaskCollectionId> => {
        if (action.type !== "UpdateTask") return emptyArray;
        if (action.taskAction.type !== "AddCollection") return emptyArray;
        return action.taskAction.collectionId;
    });

    const [, taskSortableAccountById, newReferencesResult, newAssigneeAccount] =
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
                initialTask,
                actions,
            }),
            newParentTaskIds.length > 0 || newCollectionIds.length > 0
                ? context.tasks.loadQueries(
                      spaceId,
                      {queries: [], taskIds: newParentTaskIds, collectionIds: newCollectionIds},
                      {consistency: "StrongWithinCache"},
                  )
                : null,
            state.assigneeId !== null && state.assigneeId !== initialAssigneeId
                ? getAccount(
                      context.dynamo.unexpectStrongReadConsistency(),
                      spaceId,
                      state.assigneeId,
                  )
                : null,
        ]);

    // Move patches may also update the positions of other tasks that share a position,
    // only apply this task's actions to this task's model.
    const updatedTask = applyActionsToTaskModel(
        initialTask,
        actions.filter(action => action.taskId === taskId),
        taskSortableAccountById,
    );

    let updateEvent = result.updateEvent;

    updateEvent = {
        ...updateEvent,

        backfillTasks: [
            ...updateEvent.backfillTasks,
            ...(newReferencesResult?.updateEvent.backfillTasks ?? []),
            {type: "Authorized", task: updatedTask},
        ],

        backfillCollections:
            newReferencesResult === null
                ? updateEvent.backfillCollections
                : [
                      ...updateEvent.backfillCollections,
                      ...newReferencesResult.updateEvent.backfillCollections,
                  ],

        referencedAccounts:
            newReferencesResult === null && newAssigneeAccount === null
                ? updateEvent.referencedAccounts
                : [
                      ...updateEvent.referencedAccounts,
                      ...(newReferencesResult?.updateEvent.referencedAccounts ?? []),
                      ...(newAssigneeAccount !== null ? [newAssigneeAccount] : []),
                  ],
    };

    return {
        updatedTask,
        updateEvent,
    };
}

/**
 * Turns the API patch list into task actions, one patch at a time in request
 * order. Returns the actions along with the final task state which the caller uses
 * to load newly referenced data for the API response.
 *
 * Patches that don't change anything (like setting the title to its current value)
 * generate no actions.
 */
function createTaskActionsFromApiTaskPatches({
    initialTask,
    patches,
    preparedMovePositions,
    clock,
    botAccountId,
    actor,
    timeZone,
}: {
    initialTask: TaskModel;
    patches: ReadonlyArray<ApiTaskPatch>;
    preparedMovePositions: ReadonlyArray<ApiTaskMoveInCollectionPreparedPosition | null>;
    clock: HybridLogicalClock;
    botAccountId: AccountId;
    actor: TaskActor;
    timeZone: TimeZone;
}): {actions: Array<TaskUpdateTaskAction>; state: TaskPatchState} {
    const taskId = initialTask.id;
    const actions: Array<TaskUpdateTaskAction> = [];

    const state: TaskPatchState = {
        title: initialTask.getTitle(),
        assigneeId: initialTask.getAssignee()?.assignee.accountId ?? null,
        lastCollectionOrderKey: initialTask.getCollections().getLastOrderKey(),
    };

    for (let patchIndex = 0; patchIndex < patches.length; patchIndex++) {
        const patch = patches[patchIndex]!;

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

                // NOCOMMIT: Test and make sure this works
                //
                // NOCOMMIT: Noop task title update should work? And we should still commit an
                // action?
                //
                // NOCOMMIT: Try updating title multiple times in the same patch request. Should
                // diff multiple times.
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
                const time = clock.now();

                switch (patch.status.type) {
                    case "Closed": {
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
                            // NOCOMMIT: Test that this clears the active status.
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
                                actions.push({
                                    type: "UpdateTask",
                                    time,
                                    actor,
                                    taskId,
                                    taskAction: {
                                        type: "UpdateAssignee",
                                        assignee: {
                                            assigneeId: botAccountId,
                                            assignerId: botAccountId,
                                            assignedTime: new TaskFilterableTime({
                                                absoluteTime: time,
                                                setterTimeZone: timeZone,
                                            }),
                                        },
                                    },
                                });

                                state.assigneeId = botAccountId;
                            }

                            actions.push({
                                type: "UpdateTask",
                                time,
                                actor,
                                taskId,
                                taskAction: {
                                    type: "UpdateStatus",
                                    status: {type: "Open"},
                                    assigneeStatus: {
                                        type: "Active",
                                        activatedTime: new TaskFilterableTime({
                                            absoluteTime: time,
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
                break;
            }
            case "MoveInCollection": {
                const {collectionId} = patch;

                const preparedMovePosition = assertExists(preparedMovePositions[patchIndex]);

                switch (preparedMovePosition.type) {
                    case "End": {
                        const time = clock.now();

                        actions.push({
                            type: "UpdateTask",
                            time,
                            actor,
                            taskId,
                            taskAction: {
                                type: "UpdateCollectionPosition",
                                collectionId,
                                position: {orderTime: time, orderKey: initialOrderKey},
                            },
                        });
                        break;
                    }
                    case "Start": {
                        const time = clock.now();
                        const {firstTaskPosition} = preparedMovePosition;

                        actions.push({
                            type: "UpdateTask",
                            time,
                            actor,
                            taskId,
                            taskAction: {
                                type: "UpdateCollectionPosition",
                                collectionId,
                                position:
                                    firstTaskPosition === null
                                        ? // The collection is empty so the start is also the end.
                                          {orderTime: time, orderKey: initialOrderKey}
                                        : {
                                              orderTime: firstTaskPosition.orderTime,
                                              orderKey: generateOrderKeyBetween(
                                                  null,
                                                  firstTaskPosition.orderKey,
                                              ),
                                          },
                            },
                        });
                        break;
                    }
                    case "Between": {
                        const {afterPosition, beforeOrderKey} = preparedMovePosition;

                        actions.push({
                            type: "UpdateTask",
                            time: clock.now(),
                            actor,
                            taskId,
                            taskAction: {
                                type: "UpdateCollectionPosition",
                                collectionId,
                                position: {
                                    orderTime: afterPosition.orderTime,
                                    orderKey: generateOrderKeyBetween(
                                        afterPosition.orderKey,
                                        beforeOrderKey,
                                    ),
                                },
                            },
                        });
                        break;
                    }
                    case "BetweenTied": {
                        // The two cursor tasks share the exact same position so there's no space between
                        // them. Give the moved task the first new order key and re-key the tasks sharing
                        // the position so their order is preserved after the moved task.
                        const {tiedPosition, tiedTasksToUpdate, upperOrderKey} =
                            preparedMovePosition;

                        const orderKeys = generateOrderKeysBetween(
                            tiedPosition.orderKey,
                            upperOrderKey,
                            tiedTasksToUpdate.length + 1,
                        );

                        actions.push({
                            type: "UpdateTask",
                            time: clock.now(),
                            actor,
                            taskId,
                            taskAction: {
                                type: "UpdateCollectionPosition",
                                collectionId,
                                position: {
                                    orderTime: tiedPosition.orderTime,
                                    orderKey: assertExists(orderKeys[0]),
                                },
                            },
                        });

                        for (let tiedIndex = 0; tiedIndex < tiedTasksToUpdate.length; tiedIndex++) {
                            actions.push({
                                type: "UpdateTask",
                                time: clock.now(),
                                actor,
                                taskId: tiedTasksToUpdate[tiedIndex]!.id,
                                taskAction: {
                                    type: "UpdateCollectionPosition",
                                    collectionId,
                                    position: {
                                        orderTime: tiedPosition.orderTime,
                                        orderKey: assertExists(orderKeys[tiedIndex + 1]),
                                    },
                                },
                            });
                        }
                        break;
                    }
                    default:
                        throw exhaustive(preparedMovePosition);
                }
                break;
            }
            default:
                throw exhaustive(patch);
        }
    }

    return {actions, state};
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
        initialTask,
        actions,
    }: {
        spaceId: SpaceId;
        initialTask: TaskModel;
        actions: ReadonlyArray<TaskAction>;
    },
): Promise<Map<AccountId, TaskSortableAccount>> {
    const accountIds = new Set<AccountId>();
    for (const action of actions) {
        collectReferencedIdsFromTaskAction(accountIds, new Set(), action);
    }

    // Seed the lookup from the task's embedded sortable accounts so we only fetch
    // accounts newly introduced by this patch batch.
    const taskSortableAccountById = new Map<AccountId, TaskSortableAccount>();
    for (const taskSortableAccount of getTaskSortableAccountsFromTask(initialTask)) {
        taskSortableAccountById.set(taskSortableAccount.accountId, taskSortableAccount);
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
