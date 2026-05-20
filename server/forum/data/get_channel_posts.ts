import {ServerActionContext} from "~/server/context/server_action_context.js";
import {authorizeChannelAccess} from "~/server/forum/data/authorize_channel_access.js";
import {ChannelPostsIndex} from "~/server/forum/data/internal/forum_realtime_table.js";
import {DynamoIndexCursor, DynamoIndexPartitionKey} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {RynamoBackfillResult, RynamoIndexQueryResult} from "~/shared/dynamo/rynamo_types.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {ChannelId} from "~/shared/id/types/id_types.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";

export function getChannelPostsIndexName(): string {
    return ChannelPostsIndex.name;
}

export function getChannelPostsPartitionKey(channelId: ChannelId): DynamoIndexPartitionKey {
    return ChannelPostsIndex.getRealtimeQueryPartitionKey({channelId});
}

/**
 * Get the latest posts in a channel in reverse chronological order. The newest
 * post will be the first in the array.
 */
export async function getChannelPosts(
    context: ServerActionContext,
    {
        channelId,
        limit,
        beforeCursor,
    }: {
        channelId: ChannelId;
        limit: number;
        beforeCursor: DynamoIndexCursor | null;
    },
): Promise<RynamoIndexQueryResult<PostModel>> {
    const [, result] = await runAllPromises([
        authorizeChannelAccess(context, channelId, "View"),
        ChannelPostsIndex.realtimeQuery(context, {
            partitionKey: {channelId},
            limit,
            paginate: {type: "FromEnd", beforeCursor},
        }),
    ]);

    return result;
}

/**
 * Backfill any realtime updates to catch up our client after it's been
 * disconnected from realtime.
 */
export async function backfillChannelPosts(
    context: ServerActionContext,
    {channelId, checkpoint}: {channelId: ChannelId; checkpoint: ServerSynchronizationCheckpoint},
): Promise<RynamoBackfillResult<PostModel>> {
    const [, result] = await runAllPromises([
        authorizeChannelAccess(context, channelId, "View"),
        ChannelPostsIndex.backfillRealtimeQuery(context, {
            partitionKey: {channelId},
            checkpoint,
        }),
    ]);

    return result;
}
