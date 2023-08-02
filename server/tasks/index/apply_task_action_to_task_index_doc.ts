import {max as maxDate} from "date-fns";
import {TaskIndexDoc} from "~/server/tasks/index/task_index_doc.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {applyTaskTitleUpdate} from "~/shared/tasks/task_title.js";

/**
 * Applies a `TaskAction` to a `TaskIndexDoc`. `TaskAction`s are commutative
 * and idempotent. This means they can be applied in any order or multiple
 * times and we'll converge to the same result every time.
 */
export function applyTaskActionToTaskIndexDoc(
    task: TaskIndexDoc,
    action: TaskAction,
): TaskIndexDoc {
    switch (action.type) {
        case "Create": {
            if (
                !task.creator.isEqual(action.creator) ||
                !task.createdTime.isEqual(action.createdTime)
            ) {
                throw new FailedPreconditionError("Incompatible create action");
            }
            return task;
        }
        case "Delete": {
            const newRawDeletedTime =
                task.rawDeletedTime !== null
                    ? maxDate([task.rawDeletedTime, action.deletedTime])
                    : action.deletedTime;

            if (newRawDeletedTime.toISOString() === task.rawDeletedTime?.toISOString()) return task;

            return {...task, rawDeletedTime: newRawDeletedTime};
        }
        case "Undelete": {
            const newRawUndeletedTime =
                task.rawUndeletedTime !== null
                    ? maxDate([task.rawUndeletedTime, action.undeletedTime])
                    : action.undeletedTime;

            if (newRawUndeletedTime.toISOString() === task.rawUndeletedTime?.toISOString())
                return task;

            return {...task, rawUndeletedTime: newRawUndeletedTime};
        }
        case "UpdateParentTaskId": {
            const newParentTaskId = task.parent.taskId.apply(action.parentTaskIdAction);
            const newParentPosition = task.parent.position.apply({
                updatedTime: action.parentTaskIdAction.updatedTime,
                value: {
                    orderTime: action.parentTaskIdAction.updatedTime,
                    orderKey: initialOrderKey,
                },
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
            const newParentPosition = task.parent.position.apply(action.parentPositionAction);

            if (newParentPosition === task.parent.position) return task;

            return {
                ...task,
                parent: {
                    taskId: task.parent.taskId,
                    position: newParentPosition,
                },
            };
        }
        case "UpdateCollections": {
            const newCollections = task.collections.raw.collections.apply(action.collectionsAction);

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
        case "UpdateStatus": {
            const newStatus = task.status.apply(action.statusAction);
            const newRawAssigneeStatus = task.rawAssigneeStatus.apply({
                updatedTime: action.statusAction.updatedTime,
                value: {type: "Inactive"},
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
            const newAssignee = task.assignee.apply(action.assigneeAction);
            const newRawAssigneeStatus = task.rawAssigneeStatus.apply({
                updatedTime: action.assigneeAction.updatedTime,
                value: {type: "Inactive"},
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
            const newRawAssigneeStatus = task.rawAssigneeStatus.apply(action.assigneeStatusAction);

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
            const newDueDate = task.dueDate.apply(action.dueDateAction);

            if (newDueDate === task.dueDate) return task;

            return {
                ...task,
                dueDate: newDueDate,
            };
        }
        case "UpdatePriority": {
            const newPriority = task.priority.apply(action.priorityAction);

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
