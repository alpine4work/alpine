import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskDisplayStatusIntegerMapping} from "~/shared/tasks/task_display_status.js";
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
        case "NotepadPagePosition": {
            const position = task.rawData.positionByAccountIdAndNotepadPageId.get(
                `${sort.accountId}-${sort.notepadPageId}`,
            );
            if (!position) {
                return null;
            } else {
                return [position.orderTime[0], position.orderTime[1], position.orderKey];
            }
        }
        case "AssigneeActivePosition": {
            const status = task.getStatus();
            const assignee = task.getAssignee();

            if (status.type !== "Open" || !assignee || task.getAssigneeStatus().type !== "Active") {
                return null;
            } else {
                const assigneeActivePosition = (task.rawData.assigneeActivePosition.value
                    ?.accountId === assignee.assignee.accountId
                    ? task.rawData.assigneeActivePosition.value.position
                    : null) ?? {
                    orderTime: task.rawData.assigneeStatus.version,
                    orderKey: initialOrderKey,
                };

                return [
                    assigneeActivePosition.orderTime[0],
                    assigneeActivePosition.orderTime[1],
                    assigneeActivePosition.orderKey,
                ];
            }
        }
        default:
            throw exhaustive(sort);
    }
}
