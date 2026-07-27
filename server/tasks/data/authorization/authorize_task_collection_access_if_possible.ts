import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {
    authorizeTaskCollectionItemAccessIfPossible,
    getTaskCollectionItemForAuthorizationIfExists,
} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskRealtimeActionContext} from "~/server/tasks/data/task_realtime_context.js";
import {AccessLevel} from "~/shared/access/access_policy.js";
import {ErrorBase} from "~/shared/error/error.js";
import {Result} from "~/shared/helpers/control/result.js";
import {SiteId, SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.js";

export async function authorizeTaskCollectionAccessIfPossible(
    context: TaskRealtimeActionContext,
    collectionId: TaskCollectionId,
    expectedAccessLevel: AccessLevel,
    loaders: {
        getCollectionIndexDocIfExists: (
            taskId: TaskCollectionId,
        ) => TaskCollectionIndexDoc | undefined;
    } | null = null,
    options?: {
        consistency?: DynamoCacheReadConsistency;
        dangerouslyAllowDeleted?: boolean;
        onSiteId?: (siteId: SiteId) => void;
    },
): Promise<Result<{spaceId: SpaceId}, ErrorBase> | null> {
    const collectionItem = await getTaskCollectionItemForAuthorizationIfExists(
        context,
        collectionId,
        loaders,
        options,
    );
    if (!collectionItem) return null;

    const result = await authorizeTaskCollectionItemAccessIfPossible(
        context,
        collectionItem,
        expectedAccessLevel,
        options,
    );
    if (!result.ok) return result;

    return {ok: true, value: {spaceId: collectionItem.spaceId}};
}
