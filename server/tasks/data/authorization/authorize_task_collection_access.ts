import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {
    authorizeTaskCollectionItemAccess,
    getTaskCollectionItemForAuthorization,
} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskRealtimeActionContext} from "~/server/tasks/data/task_realtime_context.js";
import {AccessLevel} from "~/shared/access/access_policy.js";
import {SiteId, SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.js";

export async function authorizeTaskCollectionAccess(
    context: TaskRealtimeActionContext,
    collectionId: TaskCollectionId,
    expectedAccessLevel: AccessLevel,
    loaders: {
        getCollectionIndexDocIfExists: (
            taskId: TaskCollectionId,
        ) => TaskCollectionIndexDoc | undefined;
    } | null = null,
    options?: {consistency?: DynamoCacheReadConsistency; onSiteId?: (siteId: SiteId) => void},
): Promise<{spaceId: SpaceId}> {
    const collectionItem = await getTaskCollectionItemForAuthorization(
        context,
        collectionId,
        loaders,
        options,
    );

    await authorizeTaskCollectionItemAccess(context, collectionItem, expectedAccessLevel);

    return {spaceId: collectionItem.spaceId};
}
