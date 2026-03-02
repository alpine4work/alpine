import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskDisplayStatusIntegerMapping} from "~/shared/tasks/task_display_status.js";
import {TaskLayoutIntegerMapping} from "~/shared/tasks/task_layout.js";
import {TaskPosition} from "~/shared/tasks/task_position.js";
import {TaskPriorityIntegerMapping} from "~/shared/tasks/task_priority.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskQuerySortCursor,
    TaskQuerySortCursorValue,
} from "~/shared/tasks/task_query_sort_cursor.js";

export function getTaskQueryNormalizedSortCursorForModel(
    sorts: ReadonlyArray<TaskQueryNormalizedSort>,
    task: TaskModel,
): TaskQuerySortCursor {
    const cursor: Array<TaskQuerySortCursorValue> = [];

    for (const sort of sorts) {
        cursor.push(getTaskQueryNormalizedSortCursorValueForModel(sort, task));
    }

    cursor.push(task.id);

    return cursor as TaskQuerySortCursor;
}

function getTaskQueryNormalizedSortCursorValueForModel(
    sort: TaskQueryNormalizedSort,
    task: TaskModel,
): TaskQuerySortCursorValue {
    switch (sort.type) {
        case "DisplayStatus": {
            return TaskDisplayStatusIntegerMapping.into(task.getDisplayStatus());
        }
        case "Priority": {
            const priority = task.getPriority();
            return priority !== null ? TaskPriorityIntegerMapping.into(priority) : null;
        }
        case "Layout": {
            const layout = task.getLayout();
            return layout !== null ? TaskLayoutIntegerMapping.into(layout) : null;
        }
        case "Assignee": {
            return task.getAssignee()?.assignee.workingAccountName ?? null;
        }
        case "Creator": {
            return task.getCreator().workingAccountName;
        }
        case "Assigner": {
            return task.getAssignee()?.assigner.workingAccountName ?? null;
        }
        case "DueDate": {
            return task.getDueDate()?.toDate("UTC").getTime() ?? null;
        }
        case "CreatedTime": {
            return task.getCreatedTime().absoluteTime;
        }
        case "AssignedTime": {
            const assignee = task.getAssignee();
            return assignee ? assignee.assignedTime.absoluteTime : null;
        }
        case "ClosedTime": {
            const status = task.getStatus();
            return status.type === "Closed" ? status.closedTime.absoluteTime : null;
        }
        case "ActivatedTime": {
            const status = task.getStatus();
            const assignee = task.getAssignee();
            const assigneeStatus = task.getAssigneeStatus();

            return status.type === "Open" && assignee && assigneeStatus.type === "Active"
                ? assigneeStatus.activatedTime.absoluteTime
                : null;
        }
        case "ParentPosition": {
            const parent = task.getParent();

            if (parent === null) return null;

            return [
                parent.position.orderTime[0],
                parent.position.orderTime[1],
                parent.position.orderKey,
            ];
        }
        case "CollectionPosition": {
            const position = task.rawData.positionByCollectionId.get(sort.collectionId);
            const version = task.getCollections().getVersion(sort.collectionId);
            if (!version) {
                return null;
            } else if (position) {
                return [position.orderTime[0], position.orderTime[1], position.orderKey];
            } else {
                return [version[0], version[1], initialOrderKey];
            }
        }
        case "AssigneePosition": {
            const assignee = task.getAssignee();

            if (!assignee) {
                return null;
            } else {
                let assigneePosition: TaskPosition;
                if (
                    task.rawData.assigneePosition.value?.accountId === assignee.assignee.accountId
                ) {
                    assigneePosition = task.rawData.assigneePosition.value.position;
                } else {
                    assigneePosition = {
                        orderTime: task.rawData.assignee.version,
                        orderKey: initialOrderKey,
                    };
                }

                return [
                    assigneePosition.orderTime[0],
                    assigneePosition.orderTime[1],
                    assigneePosition.orderKey,
                ];
            }
        }
        default:
            throw exhaustive(sort);
    }
}
