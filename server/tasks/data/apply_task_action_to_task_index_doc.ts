import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {
    HybridLogicalTime,
    maxHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {TaskTaskAction} from "~/shared/tasks/actions/task_task_action.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {applyTaskTitleUpdate} from "~/shared/tasks/task_title.js";

/**
 * Applies a `TaskTaskAction` to a `TaskIndexDoc`. `TaskTaskAction`s are
 * commutative and idempotent. This means they can be applied in any order or
 * multiple times and we'll converge to the same result every time.
 */
export function applyTaskActionToTaskIndexDoc(
    task: TaskIndexDoc,
    actionTime: HybridLogicalTime,
    action: TaskTaskAction,
): TaskIndexDoc {
    switch (action.type) {
        case "Create": {
            if (
                !task.creator.isEqual(action.creator) ||
                !task.createdTime.isEqual(
                    new TaskFilterableTime({
                        absoluteTime: actionTime,
                        setterTimeZone: action.creatorTimeZone,
                    }),
                )
            ) {
                throw new FailedPreconditionError("Incompatible create action");
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

            const newParentPosition = task.parent.position.apply({
                value: {orderTime: actionTime, orderKey: initialOrderKey},
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
            const newStatus = task.status.apply({
                value: action.status,
                version: actionTime,
            });

            const newRawAssigneeStatus = task.rawAssigneeStatus.apply({
                value: {type: "Inactive"},
                version: actionTime,
            });

            if (newStatus === task.status && newRawAssigneeStatus === task.rawAssigneeStatus)
                return task;

            return {
                ...task,
                status: newStatus,
                rawAssigneeStatus: newRawAssigneeStatus,
            };
        }
        case "UpdateAssignee": {
            const newAssignee = task.assignee.apply({
                value: action.assignee,
                version: actionTime,
            });

            const newRawAssigneeStatus = task.rawAssigneeStatus.apply({
                value: {type: "Inactive"},
                version: actionTime,
            });

            if (newAssignee === task.assignee && newRawAssigneeStatus === task.rawAssigneeStatus)
                return task;

            return {
                ...task,
                assignee: newAssignee,
                rawAssigneeStatus: newRawAssigneeStatus,
            };
        }
        case "UpdateAssigneeStatus": {
            const newRawAssigneeStatus = task.rawAssigneeStatus.apply({
                value: action.assigneeStatus,
                version: actionTime,
            });

            if (newRawAssigneeStatus === task.rawAssigneeStatus) return task;

            return {
                ...task,
                rawAssigneeStatus: newRawAssigneeStatus,
            };
        }
        case "UpdateTitle": {
            return {
                ...task,
                title: {
                    raw: applyTaskTitleUpdate(task.title.raw, action.titleUpdate),
                },
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
