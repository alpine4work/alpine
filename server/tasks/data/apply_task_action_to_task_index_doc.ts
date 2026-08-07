import {TaskIndexDocBase} from "~/server/tasks/data/task_index_doc.js";
import {AccessPolicyRegister} from "~/shared/access/access_policy.js";
import {FailedPreconditionError} from "~/shared/error/error.open_source.js";
import {areUint8ArraysEqual} from "~/shared/helpers/binary/are_uint8_arrays_equal.js";
import {
    HybridLogicalTime,
    maxHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {TaskTaskAction} from "~/shared/tasks/actions/task_task_action.js";
import {TaskAssigneeWithSortableAccount} from "~/shared/tasks/task_assignee.js";
import {TaskActorFrom} from "~/shared/tasks/task_creator.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskLayoutRegister} from "~/shared/tasks/task_layout.js";
import {
    TaskSortableAccount,
    mergeTaskSortableAccounts,
} from "~/shared/tasks/task_sortable_account.js";
import {TaskStatusWithSortableAccount} from "~/shared/tasks/task_status.js";
import {applyTaskTitleUpdate} from "~/shared/tasks/title/task_title.js";

/**
 * Applies a `TaskTaskAction` to a `TaskIndexDoc`. `TaskTaskAction`s are
 * commutative and idempotent. This means they can be applied in any order or
 * multiple times and we'll converge to the same result every time.
 *
 * We inline the account name and version into our OpenSearch index so we can sort
 * by them. In theory there's a `TaskAccountName` object in our CRDT task system
 * similar to the `Task` and `TaskCollection` CRDT objects but instead of being
 * stored in its own OpenSearch index it needs to be inlined into our tasks so we
 * can sort by it.
 *
 * Inlining task account names means different tasks with the same referenced
 * `AccountId` may have different account names. But eventually all tasks should
 * converge on the right account name. Sorting may be weird in the meantime. The
 * client may choose to update all tasks with the latest account name to avoid
 * exposing our account name eventual consistency to the end user which looks like
 * a glitch (this isn't implemented as of 2023-09-26).
 */
export function applyTaskActionToTaskIndexDoc<Task extends TaskIndexDocBase>(
    task: Task,
    actionTime: HybridLogicalTime,
    action: TaskTaskAction,
    getActionReferencedSortableAccount: (accountId: AccountId) => TaskSortableAccount,
): Task {
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
                task.creator,
                getActionReferencedSortableAccount(action.creator.accountId),
            );

            let newAccessPolicy = task.accessPolicy;

            if (action.accessPolicy) {
                newAccessPolicy = newAccessPolicy
                    ? newAccessPolicy.apply({
                          value: action.accessPolicy,
                          version: actionTime,
                      })
                    : new AccessPolicyRegister(action.accessPolicy, actionTime);
            }

            if (task.creator === mergedCreator && task.accessPolicy === newAccessPolicy) {
                return task;
            }

            return {
                ...task,
                creator: {...mergedCreator, from: action.creator.from},
                accessPolicy: newAccessPolicy,
            };
        }
        case "Delete": {
            const newRawDeletedTime =
                task.rawDeletedTime !== null
                    ? maxHybridLogicalTime(task.rawDeletedTime, actionTime)
                    : actionTime;

            if (newRawDeletedTime === task.rawDeletedTime) return task;
            return {...task, rawDeletedTime: newRawDeletedTime};
        }
        case "Undelete": {
            const newRawUndeletedTime =
                task.rawUndeletedTime !== null
                    ? maxHybridLogicalTime(task.rawUndeletedTime, actionTime)
                    : actionTime;

            if (newRawUndeletedTime === task.rawUndeletedTime) return task;
            return {...task, rawUndeletedTime: newRawUndeletedTime};
        }
        case "UpdateParentTaskId": {
            const newParentTaskId = task.parent.taskId.apply({
                value: action.parentTaskId,
                version: actionTime,
            });

            const newParentRawPosition = task.parent.rawPosition.apply({
                value: action.parentPosition ?? {orderTime: actionTime, orderKey: initialOrderKey},
                version: actionTime,
            });

            if (
                newParentTaskId === task.parent.taskId &&
                newParentRawPosition === task.parent.rawPosition
            ) {
                return task;
            }

            return {
                ...task,
                parent: {
                    taskId: newParentTaskId,
                    rawPosition: newParentRawPosition,
                },
            };
        }
        case "UpdateParentPosition": {
            const newParentRawPosition = task.parent.rawPosition.apply({
                value: action.parentPosition,
                version: actionTime,
            });

            if (newParentRawPosition === task.parent.rawPosition) return task;

            return {
                ...task,
                parent: {
                    taskId: task.parent.taskId,
                    rawPosition: newParentRawPosition,
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
            const newCollections = task.collections.raw.collections.apply({
                type: "Set",
                key: action.collectionId,
                value: action.orderKey,
                version: actionTime,
            });

            if (newCollections === task.collections.raw.collections) return task;

            return {
                ...task,
                collections: {
                    raw: {
                        collections: newCollections,
                        positionById: task.collections.raw.positionById,
                    },
                },
            };
        }
        case "RemoveCollection": {
            const newCollections = task.collections.raw.collections.apply({
                type: "Delete",
                key: action.collectionId,
                version: actionTime,
            });

            if (newCollections === task.collections.raw.collections) return task;

            return {
                ...task,
                collections: {
                    raw: {
                        collections: newCollections,
                        positionById: task.collections.raw.positionById,
                    },
                },
            };
        }
        case "UpdateCollectionPosition": {
            const newPositionById = task.collections.raw.positionById.apply({
                type: "Set",
                key: action.collectionId,
                value: action.position,
                version: actionTime,
            });

            if (newPositionById === task.collections.raw.positionById) return task;

            return {
                ...task,
                collections: {
                    raw: {
                        collections: task.collections.raw.collections,
                        positionById: newPositionById,
                    },
                },
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

            const newRawAssigneeStatus = task.rawAssigneeStatus.apply({
                value: action.assigneeStatus ?? {type: "Inactive"},
                version: actionTime,
            });

            if (newStatus === task.status && newRawAssigneeStatus === task.rawAssigneeStatus) {
                return task;
            }

            return {
                ...task,
                status: newStatus,
                rawAssigneeStatus: newRawAssigneeStatus,
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

            const newRawAssigneeStatus = task.rawAssigneeStatus.apply({
                value: action.assigneeStatus ?? {type: "Inactive"},
                version: actionTime,
            });

            if (newAssignee === task.assignee && newRawAssigneeStatus === task.rawAssigneeStatus) {
                return task;
            }

            return {
                ...task,
                assignee: newAssignee,
                rawAssigneeStatus: newRawAssigneeStatus,

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
            const newRawAssigneeStatus = task.rawAssigneeStatus.apply({
                value: action.assigneeStatus,
                version: actionTime,
            });

            if (newRawAssigneeStatus === task.rawAssigneeStatus) {
                return task;
            }

            return {
                ...task,
                rawAssigneeStatus: newRawAssigneeStatus,
            };
        }
        case "UpdateAssigneePosition": {
            const newRawAssigneePosition = task.rawAssigneePosition.apply({
                value: {
                    accountId: action.accountId,
                    position: action.position,
                },
                version: actionTime,
            });

            if (newRawAssigneePosition === task.rawAssigneePosition) {
                return task;
            }

            return {
                ...task,
                rawAssigneePosition: newRawAssigneePosition,
            };
        }
        case "UpdateTitle": {
            const newTitle = applyTaskTitleUpdate(task.title.raw, action.titleUpdate);

            if (areUint8ArraysEqual(newTitle, task.title.raw)) return task;

            return {
                ...task,
                title: {raw: newTitle},
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

            if (task.accessPolicy === newAccessPolicy) return task;

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

function areTaskCreatorFromsEqual(from1: TaskActorFrom | null, from2: TaskActorFrom | null) {
    if (from1 === from2) return true;
    if (from1 === null || from2 === null) return false;

    switch (from1.type) {
        case "Bot":
            return from2.type === "Bot" && from1.accountId === from2.accountId;
        default:
            throw exhaustive(from1.type);
    }
}
