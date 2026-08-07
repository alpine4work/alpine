import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {authorizeTaskCollectionItemAccessIfPossible} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {createTaskCollectionModelSearchResultFromItem} from "~/server/tasks/data/internal/create_task_collection_model_search_result_from_item.js";
import {isTaskCollectionItemDeleted} from "~/server/tasks/data/internal/is_task_collection_item_deleted.js";
import {TaskTable} from "~/server/tasks/data/internal/task_table.js";
import {ErrorBase} from "~/shared/error/error.open_source.js";
import {Result} from "~/shared/helpers/control/result.open_source.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.open_source.js";
import {TaskCollectionModelSearchResult} from "~/shared/tasks/model/task_collection_model_search_result.js";

export async function getTaskCollectionSearchResultIfPossible(
    context: ServerSessionActionContext,
    collectionId: TaskCollectionId,
): Promise<Result<TaskCollectionModelSearchResult, ErrorBase> | null> {
    const collectionItem = await TaskTable.getItem(context, {
        partitionType: "TaskCollection",
        sortRangeType: "EssentialAttributes",
        collectionId,
    });

    // Don't include deleted collections in results.
    if (isTaskCollectionItemDeleted(collectionItem)) return null;

    const expectedAccessLevel = "View";

    // We need to double check that we have access to this collection. Since the
    // collection search index might be out of date.
    const result = await authorizeTaskCollectionItemAccessIfPossible(
        context,
        collectionItem,
        expectedAccessLevel,
    );
    if (!result.ok) return result;

    return {
        ok: true,
        value: await createTaskCollectionModelSearchResultFromItem(context, collectionItem),
    };
}
