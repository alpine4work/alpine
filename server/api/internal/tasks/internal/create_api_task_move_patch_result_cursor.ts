import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {ApiTaskQueryCursor} from "~/shared/id/types/api_task_query_cursor.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {encodeApiTaskQueryCursor} from "~/shared/tasks/model/api_task_query_cursor_encoder.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskPosition} from "~/shared/tasks/task_position.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskQuerySortCursor} from "~/shared/tasks/task_query_sort_cursor.js";

export function createApiTaskMovePatchResultCursor({
    task,
    position,
    scope,
}: {
    task: TaskModel;
    position: TaskPosition;
    scope: {type: "Parent"} | {type: "Collection"; collectionId: TaskCollectionId};
}): ApiTaskQueryCursor {
    let positionSort: TaskQueryNormalizedSort;

    switch (scope.type) {
        case "Parent": {
            positionSort = {
                type: "ParentPosition",
                direction: "Ascending",
                missing: "Last",
            };
            break;
        }
        case "Collection": {
            positionSort = {
                type: "CollectionPosition",
                direction: "Ascending",
                missing: "Last",
                collectionId: scope.collectionId,
            };
            break;
        }
        default:
            throw exhaustive(scope);
    }

    const sorts: ReadonlyArray<TaskQueryNormalizedSort> = [
        positionSort,
        {
            type: "CreatedTime",
            direction: "Ascending",
            missing: "Last",
        },
    ];

    const cursor: TaskQuerySortCursor = [
        [position.orderTime[0], position.orderTime[1], position.orderKey],
        task.getCreatedTime().absoluteTime,
        task.id,
    ];

    return encodeApiTaskQueryCursor(sorts, cursor);
}
