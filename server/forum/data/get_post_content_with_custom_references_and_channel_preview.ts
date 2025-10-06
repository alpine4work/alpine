import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getChannelPreview} from "~/server/forum/data/get_channel_preview.js";
import {getPostItemWithContentForAuthorization} from "~/server/forum/data/internal/get_post_item_for_authorization.js";
import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
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
    const postItem = await getPostItemWithContentForAuthorization(context, postId, {consistency});

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
