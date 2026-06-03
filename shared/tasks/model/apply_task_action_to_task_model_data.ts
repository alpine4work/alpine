import {AccessPolicyRegister} from "~/shared/access/access_policy.js";
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
import {TaskLayoutRegister} from "~/shared/tasks/task_layout.js";
import {
    TaskSortableAccount,
    mergeTaskSortableAccounts,
} from "~/shared/tasks/task_sortable_account.js";
import {TaskStatusWithSortableAccount} from "~/shared/tasks/task_status.js";

/**
 * Applies a `TaskTaskAction` to a `TaskModel`. `TaskTaskAction`s are commutative
 * and idempotent. This means they can be applied in any order or multiple times
 * and we'll converge to the same result every time.
 *
 * We inline the account name and version into our client model data so we can sort
 * by them. In theory there's a `TaskAccountName` object in our CRDT task system
 * similar to the `Task` and `TaskCollection` CRDT objects but instead of being
 * stored in its own map in `TaskClientStore` it needs to be inlined into our tasks
 * so we can sort by it.
 *
 * Inlining task account names means different tasks with the same referenced
 * `AccountId` may have different account names. But eventually all tasks should
 * converge on the right account name. Sorting may be weird in the meantime. The
 * client may choose to update all tasks with the latest account name to avoid
 * exposing our account name eventual consistency to the end user which looks like
 * a glitch (this isn't implemented as of 2023-09-26).
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
                task.creator.accountId === action.creator.accountId &&
                areTaskCreatorFromsEqual(task.creator.from, action.creator.from) &&
                task.createdTime.isEqual(
                    new TaskFilterableTime({
                        absoluteTime: actionTime,
                        setterTimeZone: action.creatorTimeZone,
                    }),
                );

            if (!isCompatible) {
                throw new FailedPreconditionError("Incompatible create action");
            }

            const mergedCreator = mergeTaskSortableAccounts(
                {
                    accountId: task.creator.accountId,
                    workingAccountName: task.creator.workingAccountName,
                    workingAccountNameVersion: task.creator.workingAccountNameVersion,
                },
                getActionReferencedSortableAccount(action.creator.accountId),
            );

            if (task.creator === mergedCreator) return task;
            return {...task, creator: {...mergedCreator, from: action.creator.from}};
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

            if (newStatus === task.status && newAssigneeStatus === task.assigneeStatus) {
                return task;
            }

            return {
                ...task,
                status: newStatus,
                assigneeStatus: newAssigneeStatus,
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

            if (newAssignee === task.assignee && newAssigneeStatus === task.assigneeStatus) {
                return task;
            }

            return {
                ...task,
                assignee: newAssignee,
                assigneeStatus: newAssigneeStatus,

                // NOTE(calebmer): We intentionally don't update `assigneePosition` during an
                // `UpdateAssignee` action. That way if the user changes the task's assignee and
                // undoes the change, then the task will be placed back in the old assignee
                // position.
                //
                // Whenever we use the `assigneePosition` we always check that
                // `assigneePosition.accountId` matches the assigned account before using the
                // position.
            };
        }
        case "UpdateAssigneeStatus": {
            const newAssigneeStatus = task.assigneeStatus.apply({
                value: action.assigneeStatus,
                version: actionTime,
            });

            if (newAssigneeStatus === task.assigneeStatus) {
                return task;
            }

            return {
                ...task,
                assigneeStatus: newAssigneeStatus,
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
        case "UpdateLayout": {
            const newLayout = task.layout
                ? task.layout.apply({
                      value: action.layout,
                      version: actionTime,
                  })
                : new TaskLayoutRegister(action.layout, actionTime);

            if (newLayout === task.layout) return task;

            return {
                ...task,
                layout: newLayout,
            };
        }
        case "UpdateAccessPolicy": {
            const newAccessPolicy = task.accessPolicy
                ? task.accessPolicy.apply({
                      value: action.accessPolicy,
                      version: actionTime,
                  })
                : new AccessPolicyRegister(action.accessPolicy, actionTime);

            if (newAccessPolicy === task.accessPolicy) return task;

            return {
                ...task,
                accessPolicy: newAccessPolicy,
            };
        }
        case "UpdateNotepadPagePosition":
        case "UpdateAssigneeActivePosition": {
            return task;
        }
        default:
            throw exhaustive(action);
    }
}

function areTaskCreatorFromsEqual(
    from1: TaskModelData["creator"]["from"],
    from2: TaskModelData["creator"]["from"],
) {
    if (from1 === from2) return true;
    if (from1 === null || from2 === null) return false;
    return from1.type === from2.type && from1.accountId === from2.accountId;
}
