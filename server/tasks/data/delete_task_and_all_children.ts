import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {
    afterCommitTaskActionTransaction,
    taskCollectionAtomicallyUpdateItemTaskCountAttributesExpression,
} from "~/server/tasks/data/commit_task_action_transaction.js";
import {deleteTaskAndAllChildrenBeforeExecuteTestCheckpoint} from "~/server/tasks/data/delete_task_and_all_children_before_execute_test_checkpoint.js";
import {
    TaskItemAuthorizationCache,
    authorizeTaskItemAccess,
    getTaskCollectionItemForAuthorization,
    getTaskItemForAuthorization,
} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {
    TaskActionTable,
    TaskActionTransactionItem,
    TaskTable,
} from "~/server/tasks/data/internal/task_table.js";
import type {TaskEssentialAttributesItem} from "~/server/tasks/data/internal/task_table.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {pickObject} from "~/shared/helpers/object/pick_object.js";
import {generateId} from "~/shared/id/id.js";
import {
    SpaceId,
    TaskActionTransactionId,
    TaskCollectionId,
    TaskId,
    TaskRealtimeClientId,
} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";

/**
 * Delete the provided `TaskId` and all children of that task in a single
 * transaction. Returns the actions we committed from this function call.
 *
 * On the client we may not know all the transitive children of a task. So this
 * functionality needs to be implemented on the server.
 */
export function deleteTaskAndAllChildren(
    context: ServerSessionActionContext,
    taskId: TaskId,
    actionTime: HybridLogicalTime,
    options?: {clientId?: TaskRealtimeClientId},
): Promise<{
    spaceId: SpaceId;
    actions: ReadonlyArray<TaskAction>;
}> {
    let hasAlreadyAttempted = false;

    return context.dynamo.retryTransaction(async context => {
        const isInitialAttempt = !hasAlreadyAttempted;
        hasAlreadyAttempted = true;

        const taskItem = await TaskTable.getItem(context, {
            partitionType: "Task",
            sortRangeType: "EssentialAttributes",
            taskId,
        });

        await authorizeTaskItemAccess(context, taskItem, "Edit", {
            getTaskItem: taskId => getTaskItemForAuthorization(context, taskId, null),
            getCollectionItem: collectionId =>
                getTaskCollectionItemForAuthorization(context, collectionId, null),
        });

        let rootParentTaskItem: TaskEssentialAttributesItem = taskItem;
        let parentTaskItem: TaskEssentialAttributesItem | null = null;
        while (rootParentTaskItem.parentTaskId.value) {
            const parentTaskId = rootParentTaskItem.parentTaskId.value;

            rootParentTaskItem =
                (isInitialAttempt
                    ? await TaskItemAuthorizationCache.getIfExists(
                          context,
                          "Eventual",
                          parentTaskId,
                      )
                    : null) ??
                (await TaskTable.getItem(context, {
                    partitionType: "Task",
                    sortRangeType: "EssentialAttributes",
                    taskId: parentTaskId,
                }));

            // We want to keep track of both the root parent task and the first parent task.
            if (parentTaskItem === null) {
                parentTaskItem = rootParentTaskItem;
            }
        }

        const seenTaskIds = new Set([taskItem.taskId]);
        const updatedTaskItems: Array<{
            oldTaskItem: TaskEssentialAttributesItem;
            newTaskItem: TaskEssentialAttributesItem;
        }> = [];

        const updatedCollectionById = new Map<
            TaskCollectionId,
            {taskCountDelta: number; openTaskCountDelta: number}
        >();

        // Note that child tasks inherit the parent task's authorization.
        const addTaskItem = async (taskItem: TaskEssentialAttributesItem) => {
            const childTaskCount = taskItem.childTaskIds.size;
            let closedChildTaskCount = 0;

            await runAllPromises(
                Array.from(taskItem.childTaskIds, async childTaskId => {
                    const childTaskItem = await TaskTable.getItem(context, {
                        partitionType: "Task",
                        sortRangeType: "EssentialAttributes",
                        taskId: childTaskId,
                    });

                    if (childTaskItem.statusType.value === "Closed") {
                        closedChildTaskCount++;
                    }

                    // Keep track of `seenTaskIds` since while child tasks child be an acyclic tree
                    // where each node is unique, there may be concurrent task updates which cause us
                    // to observe something different.
                    if (seenTaskIds.has(childTaskItem.taskId)) return;

                    await addTaskItem(childTaskItem);
                }),
            );

            updatedTaskItems.push({
                oldTaskItem: taskItem,
                newTaskItem: {
                    ...taskItem,
                    deletedTime: actionTime,
                    removedChildTaskCount: taskItem.removedChildTaskCount + childTaskCount,
                    removedClosedChildTaskCount:
                        taskItem.removedClosedChildTaskCount + closedChildTaskCount,
                    // Invalidate any leases on this task now that another user has updated it.
                    validLeaseId: null,
                },
            });

            for (const {collectionId} of taskItem.collections.getArray()) {
                const updatedCollection = getOrSetDefaultMapValue(
                    updatedCollectionById,
                    collectionId,
                    () => ({taskCountDelta: 0, openTaskCountDelta: 0}),
                );

                updatedCollection.taskCountDelta -= 1;

                if (taskItem.statusType.value !== "Closed") {
                    updatedCollection.openTaskCountDelta -= 1;
                }
            }
        };

        await addTaskItem(taskItem);

        const transactionEntries: Array<DynamoTransactionEntry> = [];

        // Whenever we update a task's parent, we increment the `updateLockVersion` of the
        // root parent task. This way we can force updates to the child tree structure to
        // happen in sequence so we can validate there are no cycles.
        //
        // Force our recursive task deletion to be a part of this update sequence.
        if (
            rootParentTaskItem.taskId !== taskItem.taskId &&
            // We'll update `parentTaskItem` below so if it's the same as `rootParentTaskItem`
            // then we don't need to update `rootParentTaskItem`.
            rootParentTaskItem.taskId !== parentTaskItem?.taskId
        ) {
            transactionEntries.push(
                TaskTable.transactionDirectlyUpdateItemLockVersion(
                    rootParentTaskItem,
                    rootParentTaskItem.updateLockVersion,
                ),
            );
        }

        if (parentTaskItem) {
            transactionEntries.push(
                TaskTable.transactionDirectlyUpdateItem({
                    ...parentTaskItem,
                    addedChildTaskCount: parentTaskItem.addedChildTaskCount,
                    removedChildTaskCount: parentTaskItem.removedChildTaskCount + 1,
                    addedClosedChildTaskCount: parentTaskItem.addedClosedChildTaskCount,
                    removedClosedChildTaskCount:
                        parentTaskItem.removedClosedChildTaskCount +
                        (taskItem.statusType.value === "Closed" ? 1 : 0),
                }),
            );
        }

        for (const {newTaskItem} of updatedTaskItems) {
            transactionEntries.push(TaskTable.transactionDirectlyUpdateItem(newTaskItem));
        }

        for (const [collectionId, updatedCollection] of updatedCollectionById) {
            transactionEntries.push(
                TaskTable.dangerousTransactionUpdateItemWithCustomUpdateExpression(
                    {
                        partitionType: "TaskCollection",
                        sortRangeType: "EssentialAttributes",
                        collectionId,
                    },
                    {
                        updateExpression:
                            taskCollectionAtomicallyUpdateItemTaskCountAttributesExpression,
                        expressionAttributeValues: {
                            ":zero": 0,
                            ":one": 1,
                            ":taskCountDelta": updatedCollection.taskCountDelta,
                            ":openTaskCountDelta": updatedCollection.openTaskCountDelta,
                        },
                    },
                ),
            );
        }

        const actor = {
            accountId: context.actor.getAccountId(),
            from: null,
        };

        const actionTransactionItem: TaskActionTransactionItem = {
            partitionType: "TaskActions",
            sortRangeType: "ActionTransaction",
            spaceId: taskItem.spaceId,
            committedTime: new Date(),
            actionTransactionId: generateId<TaskActionTransactionId>(),
            actions: [
                ...updatedTaskItems.map(
                    ({newTaskItem}): TaskAction => ({
                        type: "UpdateTask",
                        time: actionTime,
                        actor,
                        taskId: newTaskItem.taskId,
                        taskAction: {type: "Delete"},
                    }),
                ),
                ...filterMapArray(
                    updatedTaskItems,
                    ({oldTaskItem, newTaskItem}): TaskAction | undefined => {
                        const countKeys = [
                            "addedChildTaskCount",
                            "removedChildTaskCount",
                            "addedClosedChildTaskCount",
                            "removedClosedChildTaskCount",
                        ] as const;

                        const oldTaskCounts = pickObject(oldTaskItem, countKeys);
                        const newTaskCounts = pickObject(newTaskItem, countKeys);

                        if (isDeepEqual(oldTaskCounts, newTaskCounts)) return;

                        return {
                            type: "UpdateTask",
                            // Match `commitTaskActionTransaction()`. Each extra action has +1 tick above the
                            // action time.
                            time: [actionTime[0], actionTime[1] + 1],
                            actor,
                            taskId: newTaskItem.taskId,
                            taskAction: {
                                type: "UpdateChildrenCounts",
                                ...newTaskCounts,
                            },
                        };
                    },
                ),
                ...(parentTaskItem
                    ? cast<Array<TaskAction>>([
                          {
                              type: "UpdateTask",
                              // Match `commitTaskActionTransaction()`. Each extra action has +1 tick above the
                              // action time.
                              time: [actionTime[0], actionTime[1] + 1],
                              actor,
                              taskId: parentTaskItem.taskId,
                              taskAction: {
                                  type: "UpdateChildrenCounts",
                                  addedChildTaskCount: parentTaskItem.addedChildTaskCount,
                                  removedChildTaskCount: parentTaskItem.removedChildTaskCount + 1,
                                  addedClosedChildTaskCount:
                                      parentTaskItem.addedClosedChildTaskCount,
                                  removedClosedChildTaskCount:
                                      parentTaskItem.removedClosedChildTaskCount +
                                      (taskItem.statusType.value === "Closed" ? 1 : 0),
                              },
                          },
                      ])
                    : []),
            ],
            wasProcessed: false,
            actorId: context.actor.getAccountId(),
            clientId: options?.clientId ?? null,
        };

        transactionEntries.push(
            TaskActionTable.transactionCreateOrReplaceItem(actionTransactionItem),
        );

        await deleteTaskAndAllChildrenBeforeExecuteTestCheckpoint.waitForTest(
            context.actor.getAccountId(),
        );

        await DynamoTableSchema.executeTransaction(context, transactionEntries);

        await afterCommitTaskActionTransaction(context, actionTransactionItem);

        return {
            spaceId: actionTransactionItem.spaceId,
            actions: actionTransactionItem.actions,
        };
    });
}
