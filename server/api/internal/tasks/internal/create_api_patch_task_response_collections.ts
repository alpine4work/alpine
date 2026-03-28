import {ApiPatchTaskResponseCollection} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {encodeApiTaskQueryCursor} from "~/shared/tasks/model/api_task_query_cursor_encoder.js";
import {getTaskQueryNormalizedSortCursorForModel} from "~/shared/tasks/model/get_task_query_normalized_sort_cursor_for_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

/**
 * Creates the collection cursor results for a task's collection move patches.
 */
export function createApiPatchTaskResponseCollections(
    task: TaskModel,
    movedCollectionIds: Iterable<TaskCollectionId>,
): Array<ApiPatchTaskResponseCollection> {
    return Array.from(new Set(movedCollectionIds), collectionId => {
        const collection = {id: collectionId};
        if (!task.getCollections().has(collectionId)) return {collection};

        const sorts: Array<TaskQueryNormalizedSort> = [
            {
                type: "CollectionPosition",
                direction: "Ascending",
                missing: "Last",
                collectionId,
            },
            {
                type: "CreatedTime",
                direction: "Ascending",
                missing: "Last",
            },
        ];

        return {
            movedCursor: encodeApiTaskQueryCursor(
                sorts,
                getTaskQueryNormalizedSortCursorForModel(sorts, task),
            ),
            collection,
        };
    });
}
