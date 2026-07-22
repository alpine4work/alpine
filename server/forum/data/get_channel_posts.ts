import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeChannelAccess} from "~/server/forum/data/authorize_channel_access.js";
import {ChannelPostsIndex} from "~/server/forum/data/internal/forum_realtime_table.js";
import {DynamoIndexCursor, DynamoIndexPartitionKey} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {RynamoBackfillResult, RynamoIndexQueryResult} from "~/shared/dynamo/rynamo_types.js";
import {PostContent} from "~/shared/forum/post_content_schema.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {sumIterable} from "~/shared/helpers/iterable/sum_iterable.js";
import {getMinId} from "~/shared/id/id.js";
import {AccountId, ChannelId, PostId, SpaceId} from "~/shared/id/types/id_types.js";
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
        consistency,
    }: {
        channelId: ChannelId;
        limit: number;
        beforeCursor: DynamoIndexCursor | null;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<RynamoIndexQueryResult<PostModel>> {
    const [, result] = await runAllPromises([
        authorizeChannelAccess(context, channelId, "View", {consistency}),
        ChannelPostsIndex.realtimeQuery(context, {
            partitionKey: {channelId},
            limit,
            paginate: {type: "FromEnd", beforeCursor},
            consistency,
        }),
    ]);

    return result;
}

export async function getChannelPostContents(
    context: ServerActionContext,
    {
        channelId,
        limit,
        beforeCreatedTime,
        consistency,
    }: {
        channelId: ChannelId;
        limit: number;
        beforeCreatedTime: Date | null;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    channelName: string;
    posts: ReadonlyArray<{
        postId: PostId;
        authorId: AccountId;
        createdTime: Date;
        createdTimeZone: TimeZone;
        contentVersion: number;
        content: PostContent;
        commentCount: number;
    }>;
    hasNextPage: boolean;
}> {
    const [channel, items] = await runAllPromises([
        authorizeChannelAccess(context, channelId, "View", {consistency}),
        ChannelPostsIndex.query(context, {
            partitionKey: {channelId},
            isEndSortKeyExclusive: true,
            endSortKey:
                // Post `createdTime` values are monotonically increasing and unique within a
                // channel, so the public cursor only needs the timestamp. `postId` is still part
                // of the DynamoDB sort key, so we use a dummy `Id` value since it doesn't matter.
                beforeCreatedTime !== null
                    ? {createdTime: beforeCreatedTime, postId: getMinId<PostId>()}
                    : undefined,
            limit: limit + 1,
            descending: true,
            consistency,
        }),
    ]);

    return {
        spaceId: channel.spaceId,
        channelName: channel.channelName,
        posts: items.slice(0, limit).map(item => ({
            postId: item.postId,
            authorId: item.author.accountId,
            createdTime: item.createdTime,
            createdTimeZone: item.createdTimeZone,
            contentVersion: item.contentUpdate?.mappings.length ?? 0,
            content: item.content,
            commentCount: sumIterable(item.commentsSummary.commentCountByAuthorId.values()),
        })),
        hasNextPage: items.length > limit,
    };
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
