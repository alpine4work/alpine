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
            return {
                ...task,
                rawDeletedTime:
                    task.rawDeletedTime !== null
                        ? maxDate([task.rawDeletedTime, action.deletedTime])
                        : action.deletedTime,
            };
        }
        case "Undelete": {
            return {
                ...task,
                rawUndeletedTime:
                    task.rawUndeletedTime !== null
                        ? maxDate([task.rawUndeletedTime, action.undeletedTime])
                        : action.undeletedTime,
            };
        }
        case "UpdateParentTaskId": {
            return {
                ...task,
                parent: {
                    taskId: task.parent.taskId.apply(action.parentTaskIdAction),
                    position: task.parent.position.apply({
                        updatedTime: action.parentTaskIdAction.updatedTime,
                        value: {
                            orderTime: action.parentTaskIdAction.updatedTime,
                            orderKey: initialOrderKey,
                        },
                    }),
                },
            };
        }
        case "UpdateParentPosition": {
            return {
                ...task,
                parent: {
                    taskId: task.parent.taskId,
                    position: task.parent.position.apply(action.parentPositionAction),
                },
            };
        }
        case "UpdateCollections": {
            return {
                ...task,
                collections: {
                    raw: {
                        collections: task.collections.raw.collections.apply(
                            action.collectionsAction,
                        ),
                        positionById: task.collections.raw.positionById,
                    },
                },
            };
        }
        case "UpdateStatus": {
            return {
                ...task,
                status: task.status.apply(action.statusAction),
                rawAssigneeStatus: task.rawAssigneeStatus.apply({
                    updatedTime: action.statusAction.updatedTime,
                    value: {type: "Inactive"},
                }),
            };
        }
        case "UpdateAssignee": {
            return {
                ...task,
                assignee: task.assignee.apply(action.assigneeAction),
                rawAssigneeStatus: task.rawAssigneeStatus.apply({
                    updatedTime: action.assigneeAction.updatedTime,
                    value: {type: "Inactive"},
                }),
            };
        }
        case "UpdateAssigneeStatus": {
            return {
                ...task,
                rawAssigneeStatus: task.rawAssigneeStatus.apply(action.assigneeStatusAction),
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
            return {
                ...task,
                dueDate: task.dueDate.apply(action.dueDateAction),
            };
        }
        case "UpdatePriority": {
            return {
                ...task,
                priority: task.priority.apply(action.priorityAction),
            };
        }
        default:
            throw exhaustive(action);
    }
}
