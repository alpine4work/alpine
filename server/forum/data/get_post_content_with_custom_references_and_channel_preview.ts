import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getChannelPreview} from "~/server/forum/data/get_channel_preview.js";
import {ForumRealtimeTable} from "~/server/forum/data/internal/forum_realtime_table.js";
import {PostItemAuthorizationCache} from "~/server/forum/data/internal/get_post_item_for_authorization.js";
import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {createPostNotFoundError} from "~/shared/forum/forum_error_messages.js";
import {PostContent} from "~/shared/forum/post_content_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {AccountId, PostId, SpaceId} from "~/shared/id/types/id_types.js";

// Designed for `server/api/internal/forum/api_forum_paths.ts`.
export async function getPostContentWithCustomReferencesAndChannelPreview<Content>(
    context: ServerAccountActionContext,
    postId: PostId,
    buildContent: (
        context: ServerAccountActionContext,
        spaceId: SpaceId,
        post: {authorId: AccountId; content: PostContent},
    ) => Promise<Content>,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<{
    spaceId: SpaceId;
    version: number;
    createdTime: Date;
    channel: ChannelPreviewModel;
    content: Content;
}> {
    const postItemPromise = ForumRealtimeTable.getItemIfExists(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId,
        },
        {consistency},
    );

    // After we've loaded a post, save it to the authorization cache so if we need
    // to authorize later in the action it's available.
    PostItemAuthorizationCache.set(context, consistency, postId, postItemPromise);

    const postItem = await postItemPromise;
    if (!postItem) throw createPostNotFoundError(postId);

    const [channel, content] = await runAllPromises([
        getChannelPreview(context, postItem.channelId, {consistency}),
        buildContent(context, postItem.spaceId, postItem),
    ]);

    return {
        spaceId: postItem.spaceId,
        version: postItem.updateLockVersion ?? 0,
        createdTime: postItem.createdTime,
        channel,
        content,
    };
}
