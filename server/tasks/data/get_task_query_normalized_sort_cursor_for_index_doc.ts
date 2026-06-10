import {TaskIndexDoc, getTaskIndexDocDisplayStatus} from "~/server/tasks/data/task_index_doc.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {TaskDisplayStatusIntegerMapping} from "~/shared/tasks/task_display_status.js";
import {TaskLayoutIntegerMapping} from "~/shared/tasks/task_layout.js";
import {TaskPosition} from "~/shared/tasks/task_position.js";
import {TaskPriorityIntegerMapping} from "~/shared/tasks/task_priority.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskQuerySortCursor,
    TaskQuerySortCursorValue,
} from "~/shared/tasks/task_query_sort_cursor.js";

export function getTaskQueryNormalizedSortCursorForIndexDoc(
    sorts: ReadonlyArray<TaskQueryNormalizedSort>,
    task: Omit<TaskIndexDoc, "lastIndexSearchEntityJob" | "approximateActionCountByAccountId">,
): TaskQuerySortCursor {
    const cursor: Array<TaskQuerySortCursorValue> = [];

    for (const sort of sorts) {
        cursor.push(getTaskQueryNormalizedSortCursorValueForIndexDoc(sort, task));
    }

    cursor.push(task.id);

    return cursor as TaskQuerySortCursor;
}

function getTaskQueryNormalizedSortCursorValueForIndexDoc(
    sort: TaskQueryNormalizedSort,
    task: Omit<TaskIndexDoc, "lastIndexSearchEntityJob" | "approximateActionCountByAccountId">,
): TaskQuerySortCursorValue {
    switch (sort.type) {
        case "DisplayStatus": {
            return TaskDisplayStatusIntegerMapping.into(getTaskIndexDocDisplayStatus(task));
        }
        case "Priority": {
            return task.priority.value !== null
                ? TaskPriorityIntegerMapping.into(task.priority.value)
                : null;
        }
        case "Layout": {
            const layout = task.layout?.value ?? null;
            return layout !== null ? TaskLayoutIntegerMapping.into(layout) : null;
        }
        case "Assignee": {
            return task.assignee.value?.assignee.workingAccountName ?? null;
        }
        case "Creator": {
            return task.creator.workingAccountName;
        }
        case "Assigner": {
            return task.assignee.value?.assigner.workingAccountName ?? null;
        }
        case "DueDate": {
            return task.dueDate.value?.toDate("UTC").getTime() ?? null;
        }
        case "CreatedTime": {
            return task.createdTime.absoluteTime;
        }
        case "AssignedTime": {
            return task.assignee.value ? task.assignee.value.assignedTime.absoluteTime : null;
        }
        case "ClosedTime": {
            return task.status.value.type === "Closed"
                ? task.status.value.closedTime.absoluteTime
                : null;
        }
        case "ActivatedTime": {
            return task.status.value.type === "Open" &&
                task.assignee.value &&
                task.rawAssigneeStatus.value.type === "Active"
                ? task.rawAssigneeStatus.value.activatedTime.absoluteTime
                : null;
        }
        case "ParentPosition": {
            if (task.parent.taskId.value === null) return null;

            const position = task.parent.rawPosition.value;
            return [position.orderTime[0], position.orderTime[1], position.orderKey];
        }
        case "CollectionPosition": {
            const position = task.collections.raw.positionById.get(sort.collectionId);
            const version = task.collections.raw.collections.getVersion(sort.collectionId);
            if (!version) {
                return null;
            } else if (position) {
                return [position.orderTime[0], position.orderTime[1], position.orderKey];
            } else {
                return [version[0], version[1], initialOrderKey];
            }
        }
        case "AssigneePosition": {
            if (!task.assignee.value) {
                return null;
            } else {
                let assigneePosition: TaskPosition;
                if (
                    task.rawAssigneePosition.value?.accountId ===
                    task.assignee.value.assignee.accountId
                ) {
                    assigneePosition = task.rawAssigneePosition.value.position;
                } else {
                    assigneePosition = {
                        orderTime: task.rawAssigneeStatus.version,
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
