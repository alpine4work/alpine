import {Mapping} from "prosemirror-transform";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getChannelPreviewIfPossible} from "~/server/forum/data/get_channel_preview.js";
import {getPostItemWithContentForAuthorizationIfExists} from "~/server/forum/data/internal/get_post_item_for_authorization.js";
import {ErrorBase} from "~/shared/error/error.open_source.js";
import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {createPostNotFoundError} from "~/shared/forum/forum_error_messages.js";
import {PostContent} from "~/shared/forum/post_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.open_source.js";
import {Result} from "~/shared/helpers/control/result.open_source.js";
import {AccountId, PostId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

// Designed for `server/search/data/index/internal/get_search_entity.ts`.
export async function getPostContentAndChannelPreview(
    context: ServerActionContext,
    postId: PostId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<{
    spaceId: SpaceId;
    version: number;
    createdTime: Date;
    authorId: AccountId;
    content: PostContent;
    contentUpdate: {time: Date; mappings: ReadonlyArray<Mapping>} | null;
    channel: ChannelPreviewModel;
}> {
    const postResult = await getPostContentAndChannelPreviewIfPossible(context, postId, options);
    if (!postResult) throw createPostNotFoundError(postId);
    return unwrapResult(postResult);
}

// Designed for `server/search/data/index/internal/get_search_entity.ts`.
export async function getPostContentAndChannelPreviewIfExists(
    context: ServerActionContext,
    postId: PostId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<{
    spaceId: SpaceId;
    version: number;
    createdTime: Date;
    authorId: AccountId;
    content: PostContent;
    contentUpdate: {time: Date; mappings: ReadonlyArray<Mapping>} | null;
    channel: ChannelPreviewModel;
} | null> {
    const postResult = await getPostContentAndChannelPreviewIfPossible(context, postId, options);
    if (!postResult) return null;
    return unwrapResult(postResult);
}

// Designed for `server/search/data/index/internal/get_search_entity.ts`.
export async function getPostContentAndChannelPreviewIfPossible(
    context: ServerActionContext,
    postId: PostId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<Result<
    {
        spaceId: SpaceId;
        version: number;
        createdTime: Date;
        authorId: AccountId;
        content: PostContent;
        contentUpdate: {time: Date; mappings: ReadonlyArray<Mapping>} | null;
        channel: ChannelPreviewModel;
    },
    ErrorBase
> | null> {
    const postItem = await getPostItemWithContentForAuthorizationIfExists(context, postId, {
        consistency,
    });
    if (!postItem) return null;

    const channelResult = await getChannelPreviewIfPossible(context, postItem.channelId, {
        consistency,
    });
    assert(channelResult);
    if (!channelResult.ok) return channelResult;

    return {
        ok: true,
        value: {
            spaceId: postItem.spaceId,
            version: postItem.updateLockVersion ?? 0,
            createdTime: postItem.createdTime,
            authorId: postItem.author.accountId,
            content: postItem.content,
            contentUpdate: postItem.contentUpdate,
            channel: channelResult.value,
        },
    };
}
