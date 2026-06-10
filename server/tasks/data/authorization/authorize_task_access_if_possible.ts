import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {
    authorizeTaskItemAccessIfPossible,
    getTaskCollectionItemForAuthorization,
    getTaskItemForAuthorization,
    getTaskItemForAuthorizationIfExists,
} from "~/server/tasks/data/internal/authorize_task_item_access.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {TaskRealtimeActionContext} from "~/server/tasks/data/task_realtime_context.js";
import {AccessLevel} from "~/shared/access/access_policy.js";
import {ErrorBase} from "~/shared/error/error.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {Result} from "~/shared/helpers/control/result.js";
import {SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";

export async function authorizeTaskAccessIfPossible(
    context: TaskRealtimeActionContext,
    taskId: TaskId,
    expectedAccessLevel: AccessLevel,
    loaders: {
        getTaskIndexDocIfExists: (taskId: TaskId) => TaskIndexDoc | undefined;
        getCollectionIndexDocIfExists: (
            collectionId: TaskCollectionId,
        ) => TaskCollectionIndexDoc | undefined;
    } | null = null,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<{spaceId: SpaceId; createdTime: HybridLogicalTime}, ErrorBase> | null> {
    const taskItem = await getTaskItemForAuthorizationIfExists(context, taskId, loaders, options);
    if (!taskItem) return null;

    const result = await authorizeTaskItemAccessIfPossible(
        context,
        taskItem,
        expectedAccessLevel,
        {
            getTaskItem: taskId => getTaskItemForAuthorization(context, taskId, loaders, options),
            getCollectionItem: collectionId =>
                getTaskCollectionItemForAuthorization(context, collectionId, loaders, options),
        },
        options,
    );
    if (!result.ok) return result;

    return {ok: true, value: {spaceId: taskItem.spaceId, createdTime: taskItem.createdTime}};
}
