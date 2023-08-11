import {
    TaskDisplayStatusIntegerMapping,
    TaskIndexDoc,
    TaskPriorityIntegerMapping,
    getTaskIndexDocDisplayStatus,
} from "~/server/tasks/index/task_index_doc.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskQuerySortCursor,
    TaskQuerySortCursorValue,
} from "~/shared/tasks/task_query_sort_cursor.js";

export function getTaskQueryNormalizedSortCursorFromIndexDoc(
    sorts: ReadonlyArray<TaskQueryNormalizedSort>,
    taskId: TaskId,
    task: TaskIndexDoc,
): TaskQuerySortCursor {
    const cursor: Array<TaskQuerySortCursorValue> = [];

    for (const sort of sorts) {
        cursor.push(getTaskQueryNormalizedSortCursorValueFromIndexDoc(sort, task));
    }

    cursor.push(taskId);

    return cursor as TaskQuerySortCursor;
}

function getTaskQueryNormalizedSortCursorValueFromIndexDoc(
    sort: TaskQueryNormalizedSort,
    task: TaskIndexDoc,
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
        case "NotepadPagePosition": {
            const position = task.notepadPages.raw.positionById.get(
                `${sort.accountId}-${sort.notepadPageId}`,
            );
            if (!position) {
                return null;
            } else {
                return [position.orderTime[0], position.orderTime[1], position.orderKey];
            }
        }
        case "AssigneeStatusActivePosition": {
            if (
                task.status.value.type !== "Open" ||
                !task.assignee.value ||
                task.rawAssigneeStatus.value.type !== "Active"
            ) {
                return null;
            } else {
                return [
                    task.rawAssigneeStatus.value.position.orderTime[0],
                    task.rawAssigneeStatus.value.position.orderTime[1],
                    task.rawAssigneeStatus.value.position.orderKey,
                ];
            }
        }
        default:
            throw exhaustive(sort);
    }
}
