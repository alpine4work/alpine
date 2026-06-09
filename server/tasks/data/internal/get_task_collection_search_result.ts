import {ServerActionContext} from "~/server/context/server_action_context.js";
import {authorizeTaskCollectionItemAccess} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {createTaskCollectionModelSearchResultFromItem} from "~/server/tasks/data/internal/create_task_collection_model_search_result_from_item.js";
import {TaskTable} from "~/server/tasks/data/internal/task_table.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {TaskCollectionModelSearchResult} from "~/shared/tasks/model/task_collection_model_search_result.js";

export async function getTaskCollectionSearchResult(
    context: ServerActionContext,
    collectionId: TaskCollectionId,
): Promise<TaskCollectionModelSearchResult> {
    const collectionItem = await TaskTable.getItem(context, {
        partitionType: "TaskCollection",
        sortRangeType: "EssentialAttributes",
        collectionId,
    });

    const expectedAccessLevel = "View";

    // We need to double check that we have access to this collection. Since the
    // collection search index might be out of date.
    await authorizeTaskCollectionItemAccess(context, collectionItem, expectedAccessLevel);

    return await createTaskCollectionModelSearchResultFromItem(context, collectionItem);
}
