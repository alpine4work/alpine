import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeTaskCollectionItemAccessIfPossible} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {convertTaskCollectionIndexDocToItem} from "~/server/tasks/data/internal/convert_task_index_doc_to_item.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskRealtimeActionContext} from "~/server/tasks/data/task_realtime_context.js";
import {AccessLevel} from "~/shared/access/access_policy.js";
import {ErrorBase} from "~/shared/error/error.js";
import {Result} from "~/shared/helpers/control/result.js";

export function authorizeTaskCollectionIndexDocAccessIfPossible(
    context: TaskRealtimeActionContext,
    collectionIndexDoc: TaskCollectionIndexDoc,
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<void, ErrorBase>> {
    return authorizeTaskCollectionItemAccessIfPossible(
        context,
        convertTaskCollectionIndexDocToItem(collectionIndexDoc),
        expectedAccessLevel,
        options,
    );
}
