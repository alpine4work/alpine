import {
    TaskAssigneeWithSortableAccount,
    TaskAssigneeWithSortableAccountRegister,
    TaskIndexDoc,
    TaskStatusWithSortableAccount,
    TaskStatusWithSortableAccountRegister,
} from "~/server/tasks/data/task_index_doc.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {areUint8ArraysEqual} from "~/shared/helpers/binary/are_uint8_arrays_equal.js";
import {
    HybridLogicalTime,
    compareHybridLogicalTimes,
    maxHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {TaskTaskAction} from "~/shared/tasks/actions/task_task_action.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {applyTaskTitleUpdate} from "~/shared/tasks/task_title.js";

/**
 * Applies a `TaskTaskAction` to a `TaskIndexDoc`. `TaskTaskAction`s are
 * commutative and idempotent. This means they can be applied in any order or
 * multiple times and we'll converge to the same result every time.
 *
 * `workingAccountName` and `workingAccountNameVersion` don't really follow the
 * same commutativity and idempotency rules as everything else in a
 * `TaskIndexDoc`. If the returned value from
 * `getActionReferencedAccountName()` never changes then this function is fully
 * commutative and idempotent. If the returned value from
 * `getActionReferencedAccountName()` does change, not so much.
 *
 * We inline the account name and version into our OpenSearch index so we can
 * sort by them. In theory there's a `TaskAccountName` object in our CRDT task
 * system similar to the `Task` and `TaskCollection` CRDT objects but instead
 * of being stored in its own OpenSearch index it needs to be inlined into our
 * tasks so we can sort by it.
 */
export function applyTaskActionToTaskIndexDoc(
    task: TaskIndexDoc,
    actionTime: HybridLogicalTime,
    action: TaskTaskAction,
    getActionReferencedAccountName: (accountId: AccountId) => {name: string; nameVersion: number},
): TaskIndexDoc {
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

            const creatorName = getActionReferencedAccountName(action.creatorId);

            // If the task creator's name changed then update the index doc.
            if (creatorName.nameVersion > task.creator.workingAccountNameVersion) {
                return {
                    ...task,
                    creator: {
                        accountId: action.creatorId,
                        workingAccountName: creatorName.name,
                        workingAccountNameVersion: creatorName.nameVersion,
                    },
                };
            }

            return task;
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
                value: {orderTime: actionTime, orderKey: initialOrderKey},
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
        case "UpdateNotepadPagePosition": {
            const newPositionById =
                action.position !== null
                    ? task.notepadPages.raw.positionById.apply({
                          type: "Set",
                          key: `${action.accountId}-${action.notepadPageId}`,
                          value: action.position,
                          version: actionTime,
                      })
                    : task.notepadPages.raw.positionById.apply({
                          type: "Delete",
                          key: `${action.accountId}-${action.notepadPageId}`,
                          version: actionTime,
                      });

            if (newPositionById === task.notepadPages.raw.positionById) return task;

            return {
                ...task,
                notepadPages: {
                    raw: {
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
                const closerName = getActionReferencedAccountName(action.status.closerId);

                status = {
                    type: "Closed",
                    closer: {
                        accountId: action.status.closerId,
                        workingAccountName: closerName.name,
                        workingAccountNameVersion: closerName.nameVersion,
                    },
                    closedTime: action.status.closedTime,
                };
            }

            const newStatus =
                // If we have a version tie and our status's `workingAccountNameVersion` is
                // newer then it should always win.
                compareHybridLogicalTimes(task.status.version, actionTime) === 0 &&
                task.status.value.type === "Closed" &&
                status.type === "Closed" &&
                status.closer.workingAccountNameVersion >
                    task.status.value.closer.workingAccountNameVersion
                    ? new TaskStatusWithSortableAccountRegister(status, actionTime)
                    : task.status.apply({
                          value: status,
                          version: actionTime,
                      });

            const newRawAssigneeStatus = task.rawAssigneeStatus.apply({
                value: {type: "Inactive"},
                version: actionTime,
            });

            const newRawAssigneeActivePosition = task.rawAssigneeActivePosition.apply({
                value: null,
                version: actionTime,
            });

            if (
                newStatus === task.status &&
                newRawAssigneeStatus === task.rawAssigneeStatus &&
                newRawAssigneeActivePosition === task.rawAssigneeActivePosition
            ) {
                return task;
            }

            return {
                ...task,
                status: newStatus,
                rawAssigneeStatus: newRawAssigneeStatus,
                rawAssigneeActivePosition: newRawAssigneeActivePosition,
            };
        }
        case "UpdateAssignee": {
            let assignee: TaskAssigneeWithSortableAccount | null;
            if (action.assignee === null) {
                assignee = null;
            } else {
                const assigneeName = getActionReferencedAccountName(action.assignee.assigneeId);
                const assignerName = getActionReferencedAccountName(action.assignee.assignerId);

                assignee = {
                    assignee: {
                        accountId: action.assignee.assigneeId,
                        workingAccountName: assigneeName.name,
                        workingAccountNameVersion: assigneeName.nameVersion,
                    },
                    assigner: {
                        accountId: action.assignee.assignerId,
                        workingAccountName: assignerName.name,
                        workingAccountNameVersion: assignerName.nameVersion,
                    },
                    assignedTime: action.assignee.assignedTime,
                };
            }

            const newAssignee =
                // If we have a version tie and our assignee or assigner's
                // `workingAccountNameVersion` is newer then it should always win.
                compareHybridLogicalTimes(task.status.version, actionTime) === 0 &&
                task.assignee.value &&
                assignee &&
                (assignee.assignee.workingAccountNameVersion >
                    task.assignee.value.assignee.workingAccountNameVersion ||
                    assignee.assigner.workingAccountNameVersion >
                        task.assignee.value.assigner.workingAccountNameVersion)
                    ? new TaskAssigneeWithSortableAccountRegister(assignee, actionTime)
                    : task.assignee.apply({
                          value: assignee,
                          version: actionTime,
                      });

            const newRawAssigneeStatus = task.rawAssigneeStatus.apply({
                value: {type: "Inactive"},
                version: actionTime,
            });

            const newRawAssigneeActivePosition = task.rawAssigneeActivePosition.apply({
                value: null,
                version: actionTime,
            });

            if (
                newAssignee === task.assignee &&
                newRawAssigneeStatus === task.rawAssigneeStatus &&
                newRawAssigneeActivePosition === task.rawAssigneeActivePosition
            ) {
                return task;
            }

            return {
                ...task,
                assignee: newAssignee,
                rawAssigneeStatus: newRawAssigneeStatus,
                rawAssigneeActivePosition: newRawAssigneeActivePosition,
            };
        }
        case "UpdateAssigneeStatus": {
            const newRawAssigneeStatus = task.rawAssigneeStatus.apply({
                value: action.assigneeStatus,
                version: actionTime,
            });

            const newRawAssigneeActivePosition = task.rawAssigneeActivePosition.apply({
                value: null,
                version: actionTime,
            });

            if (
                newRawAssigneeStatus === task.rawAssigneeStatus &&
                newRawAssigneeActivePosition === task.rawAssigneeActivePosition
            ) {
                return task;
            }

            return {
                ...task,
                rawAssigneeStatus: newRawAssigneeStatus,
                rawAssigneeActivePosition: newRawAssigneeActivePosition,
            };
        }
        case "UpdateAssigneeActivePosition": {
            const newRawAssigneeActivePosition = task.rawAssigneeActivePosition.apply({
                value: {
                    accountId: action.accountId,
                    position: action.position,
                },
                version: actionTime,
            });

            if (newRawAssigneeActivePosition === task.rawAssigneeActivePosition) {
                return task;
            }

            return {
                ...task,
                rawAssigneeActivePosition: newRawAssigneeActivePosition,
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
        default:
            throw exhaustive(action);
    }
}
