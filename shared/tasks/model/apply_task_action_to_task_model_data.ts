import {FailedPreconditionError} from "~/shared/error/error.js";
import {
    HybridLogicalTime,
    maxHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {TaskTaskActionMaybeModel} from "~/shared/tasks/actions/task_action_model.js";
import {TaskModelData} from "~/shared/tasks/model/task_model.js";
import {TaskAssigneeWithSortableAccount} from "~/shared/tasks/task_assignee.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {
    TaskSortableAccount,
    mergeTaskSortableAccounts,
} from "~/shared/tasks/task_sortable_account.js";
import {TaskStatusWithSortableAccount} from "~/shared/tasks/task_status.js";

/**
 * Applies a `TaskTaskAction` to a `TaskIndexDoc`. `TaskTaskAction`s are
 * commutative and idempotent. This means they can be applied in any order or
 * multiple times and we'll converge to the same result every time.
 *
 * We inline the account name and version into our client model data so we can
 * sort by them. In theory there's a `TaskAccountName` object in our CRDT task
 * system similar to the `Task` and `TaskCollection` CRDT objects but instead
 * of being stored in its own map in `TaskClientStore` it needs to be inlined
 * into our tasks so we can sort by it.
 *
 * Inlining task account names means different tasks with the same referenced
 * `AccountId` may have different account names. But eventually all tasks
 * should converge on the right account name. Sorting may be weird in the
 * meantime. The client may choose to update all tasks with the latest account
 * name to avoid exposing our account name eventual consistency to the end user
 * which looks like a glitch (this isn't implemented as of 2023-09-26).
 */
export function applyTaskActionToTaskModelData(
    task: TaskModelData,
    actionTime: HybridLogicalTime,
    action: TaskTaskActionMaybeModel,
    getActionReferencedSortableAccount: (accountId: AccountId) => TaskSortableAccount,
): TaskModelData {
    switch (action.type) {
        case "Create": {
            const isCompatible =
                task.creator.accountId === action.creatorId &&
                task.createdTime.isEqual(
                    new TaskFilterableTime({
                        absoluteTime: actionTime,
                        setterTimeZone: action.creatorTimeZone,
                    }),
                );

            if (!isCompatible) {
                throw new FailedPreconditionError("Incompatible create action");
            }

            const creator = mergeTaskSortableAccounts(
                task.creator,
                getActionReferencedSortableAccount(action.creatorId),
            );

            if (task.creator === creator) return task;
            return {...task, creator};
        }
        case "Delete": {
            const newDeletedTime =
                task.deletedTime !== null
                    ? maxHybridLogicalTime(task.deletedTime, actionTime)
                    : actionTime;

            if (newDeletedTime === task.deletedTime) return task;
            return {...task, deletedTime: newDeletedTime};
        }
        case "Undelete": {
            const newUndeletedTime =
                task.undeletedTime !== null
                    ? maxHybridLogicalTime(task.undeletedTime, actionTime)
                    : actionTime;

            if (newUndeletedTime === task.undeletedTime) return task;
            return {...task, undeletedTime: newUndeletedTime};
        }
        case "UpdateParentTaskId": {
            const newParentTaskId = task.parent.taskId.apply({
                value: action.parentTaskId,
                version: actionTime,
            });

            const newParentPosition = task.parent.position.apply({
                value: action.parentPosition ?? {orderTime: actionTime, orderKey: initialOrderKey},
                version: actionTime,
            });

            if (
                newParentTaskId === task.parent.taskId &&
                newParentPosition === task.parent.position
            ) {
                return task;
            }

            return {
                ...task,
                parent: {
                    taskId: newParentTaskId,
                    position: newParentPosition,
                },
            };
        }
        case "UpdateParentPosition": {
            const newParentPosition = task.parent.position.apply({
                value: action.parentPosition,
                version: actionTime,
            });

            if (newParentPosition === task.parent.position) return task;

            return {
                ...task,
                parent: {
                    taskId: task.parent.taskId,
                    position: newParentPosition,
                },
            };
        }
        case "UpdateChildrenCounts": {
            const newAddedChildTaskCount = Math.max(
                task.addedChildTaskCount,
                action.addedChildTaskCount,
            );
            const newRemovedChildTaskCount = Math.max(
                task.removedChildTaskCount,
                action.removedChildTaskCount,
            );
            const newAddedClosedChildTaskCount = Math.max(
                task.addedClosedChildTaskCount,
                action.addedClosedChildTaskCount,
            );
            const newRemovedClosedChildTaskCount = Math.max(
                task.removedClosedChildTaskCount,
                action.removedClosedChildTaskCount,
            );

            if (
                task.addedChildTaskCount === newAddedChildTaskCount &&
                task.removedChildTaskCount === newRemovedChildTaskCount &&
                task.addedClosedChildTaskCount === newAddedClosedChildTaskCount &&
                task.removedClosedChildTaskCount === newRemovedClosedChildTaskCount
            ) {
                return task;
            }

            return {
                ...task,
                addedChildTaskCount: newAddedChildTaskCount,
                removedChildTaskCount: newRemovedChildTaskCount,
                addedClosedChildTaskCount: newAddedClosedChildTaskCount,
                removedClosedChildTaskCount: newRemovedClosedChildTaskCount,
            };
        }
        case "AddCollection": {
            const newCollections = task.collections.apply({
                type: "Set",
                key: action.collectionId,
                value: action.orderKey,
                version: actionTime,
            });

            if (newCollections === task.collections) return task;

            return {
                ...task,
                collections: newCollections,
            };
        }
        case "RemoveCollection": {
            const newCollections = task.collections.apply({
                type: "Delete",
                key: action.collectionId,
                version: actionTime,
            });

            if (newCollections === task.collections) return task;

            return {
                ...task,
                collections: newCollections,
            };
        }
        case "UpdateCollectionPosition": {
            const newPositionByCollectionId = task.positionByCollectionId.apply({
                type: "Set",
                key: action.collectionId,
                value: action.position,
                version: actionTime,
            });

            if (newPositionByCollectionId === task.positionByCollectionId) return task;

            return {
                ...task,
                positionByCollectionId: newPositionByCollectionId,
            };
        }
        case "UpdateNotepadPagePosition": {
            const newPositionByAccountIdAndNotepadPageId =
                action.position !== null
                    ? task.positionByAccountIdAndNotepadPageId.apply({
                          type: "Set",
                          key: `${action.accountId}-${action.notepadPageId}`,
                          value: action.position,
                          version: actionTime,
                      })
                    : task.positionByAccountIdAndNotepadPageId.apply({
                          type: "Delete",
                          key: `${action.accountId}-${action.notepadPageId}`,
                          version: actionTime,
                      });

            if (newPositionByAccountIdAndNotepadPageId === task.positionByAccountIdAndNotepadPageId)
                return task;

            return {
                ...task,
                positionByAccountIdAndNotepadPageId: newPositionByAccountIdAndNotepadPageId,
            };
        }
        case "UpdateStatus": {
            let status: TaskStatusWithSortableAccount;
            if (action.status.type !== "Closed") {
                status = action.status;
            } else {
                status = {
                    type: "Closed",
                    closer: getActionReferencedSortableAccount(action.status.closerId),
                    closedTime: action.status.closedTime,
                };
            }

            const newStatus = task.status.apply({
                value: status,
                version: actionTime,
            });

            const newAssigneeStatus = task.assigneeStatus.apply({
                value: action.assigneeStatus ?? {type: "Inactive"},
                version: actionTime,
            });

            const newAssigneeActivePosition = task.assigneeActivePosition.apply({
                value: null,
                version: actionTime,
            });

            if (
                newStatus === task.status &&
                newAssigneeStatus === task.assigneeStatus &&
                newAssigneeActivePosition === task.assigneeActivePosition
            ) {
                return task;
            }

            return {
                ...task,
                status: newStatus,
                assigneeStatus: newAssigneeStatus,
                assigneeActivePosition: newAssigneeActivePosition,
            };
        }
        case "UpdateAssignee": {
            let assignee: TaskAssigneeWithSortableAccount | null;
            if (action.assignee === null) {
                assignee = null;
            } else {
                assignee = {
                    assignee: getActionReferencedSortableAccount(action.assignee.assigneeId),
                    assigner: getActionReferencedSortableAccount(action.assignee.assignerId),
                    assignedTime: action.assignee.assignedTime,
                };
            }

            const newAssignee = task.assignee.apply({
                value: assignee,
                version: actionTime,
            });

            const newAssigneeStatus = task.assigneeStatus.apply({
                value: action.assigneeStatus ?? {type: "Inactive"},
                version: actionTime,
            });

            const newAssigneePosition = task.assigneePosition.apply({
                value: null,
                version: actionTime,
            });

            const newAssigneeActivePosition = task.assigneeActivePosition.apply({
                value: null,
                version: actionTime,
            });

            if (
                newAssignee === task.assignee &&
                newAssigneeStatus === task.assigneeStatus &&
                newAssigneePosition === task.assigneePosition &&
                newAssigneeActivePosition === task.assigneeActivePosition
            ) {
                return task;
            }

            return {
                ...task,
                assignee: newAssignee,
                assigneeStatus: newAssigneeStatus,
                assigneePosition: newAssigneePosition,
                assigneeActivePosition: newAssigneeActivePosition,
            };
        }
        case "UpdateAssigneeStatus": {
            const newAssigneeStatus = task.assigneeStatus.apply({
                value: action.assigneeStatus,
                version: actionTime,
            });

            const newAssigneeActivePosition = task.assigneeActivePosition.apply({
                value: null,
                version: actionTime,
            });

            if (
                newAssigneeStatus === task.assigneeStatus &&
                newAssigneeActivePosition === task.assigneeActivePosition
            ) {
                return task;
            }

            return {
                ...task,
                assigneeStatus: newAssigneeStatus,
                assigneeActivePosition: newAssigneeActivePosition,
            };
        }
        case "UpdateAssigneePosition": {
            const newAssigneePosition = task.assigneePosition.apply({
                value: {
                    accountId: action.accountId,
                    position: action.position,
                },
                version: actionTime,
            });

            if (newAssigneePosition === task.assigneePosition) {
                return task;
            }

            return {
                ...task,
                assigneePosition: newAssigneePosition,
            };
        }
        case "UpdateAssigneeActivePosition": {
            const newAssigneeActivePosition = task.assigneeActivePosition.apply({
                value: {
                    accountId: action.accountId,
                    position: action.position,
                },
                version: actionTime,
            });

            if (newAssigneeActivePosition === task.assigneeActivePosition) {
                return task;
            }

            return {
                ...task,
                assigneeActivePosition: newAssigneeActivePosition,
            };
        }
        case "UpdateTitle": {
            const newTitle = task.title.apply(action.titleUpdate);

            if (task.title === newTitle) return task;

            return {
                ...task,
                title: newTitle,
            };
        }
        case "UpdateDueDate": {
            const newDueDate = task.dueDate.apply({
                value: action.dueDate,
                version: actionTime,
            });

            if (newDueDate === task.dueDate) return task;

            return {
                ...task,
                dueDate: newDueDate,
            };
        }
        case "UpdatePriority": {
            const newPriority = task.priority.apply({
                value: action.priority,
                version: actionTime,
            });

            if (newPriority === task.priority) return task;

            return {
                ...task,
                priority: newPriority,
            };
        }
        default:
            throw exhaustive(action);
    }
}
