import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {authorizeTaskCollectionItemAccessIfPossible} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {isTaskCollectionItemDeleted} from "~/server/tasks/data/internal/is_task_collection_item_deleted.js";
import {TaskTable} from "~/server/tasks/data/internal/task_table.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.open_source.js";
import {printTaskCollectionSearchResultBodyTextSnippet} from "~/shared/tasks/print_task_collection_search_result_body_text_snippet.js";

export async function getTaskCollectionSearchResultBodyTextSnippetIfPossible(
    context: ServerAccountActionContext,
    collectionId: TaskCollectionId,
    timeZone: TimeZone,
    currentTime: Date,
): Promise<string | null> {
    const collectionItem = await TaskTable.getItem(context, {
        partitionType: "TaskCollection",
        sortRangeType: "EssentialAttributes",
        collectionId,
    });

    // Deleted collections get no snippet.
    if (isTaskCollectionItemDeleted(collectionItem)) return null;

    const expectedAccessLevel = "View";

    // We need to double check that we have access to this collection. Since the
    // collection search index might be out of date.
    const result = await authorizeTaskCollectionItemAccessIfPossible(
        context,
        collectionItem,
        expectedAccessLevel,
    );
    if (!result.ok) return null;

    return printTaskCollectionSearchResultBodyTextSnippet({
        timeZone,
        currentTime,
        createdTime: new Date(collectionItem.createdTime[0]),
        lastTaskAddedTime: collectionItem.lastTaskAddedTime
            ? new Date(collectionItem.lastTaskAddedTime[0])
            : null,
        openTaskCount: collectionItem.openTaskCount,
    });
}
