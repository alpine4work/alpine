import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getChannelPreviewIfPossible} from "~/server/forum/data/get_channel_preview.js";
import {getPostItemWithContentForAuthorization} from "~/server/forum/data/internal/get_post_item_for_authorization.js";
import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {createPostNotFoundError} from "~/shared/forum/forum_error_messages.js";
import {PostContent} from "~/shared/forum/post_content_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {Result} from "~/shared/helpers/control/result.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {AccountId, PostId, SpaceId} from "~/shared/id/types/id_types.js";

// Designed for `server/api/internal/forum/api_forum_paths.ts`.
export async function getPostContentWithCustomReferencesAndChannelPreview<
    Context extends ServerActionContext,
    Content,
>(
    context: Context,
    postId: PostId,
    buildContent: (
        context: Context,
        spaceId: SpaceId,
        post: {authorId: AccountId; contentVersion: number; content: PostContent},
    ) => Promise<Content>,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<{
    spaceId: SpaceId;
    version: number;
    createdTime: Date;
    createdTimeZone: TimeZone;
    channel: ChannelPreviewModel;
    content: Content;
}> {
    const result = await getPostContentWithCustomReferencesAndChannelPreviewIfPossible(
        context,
        postId,
        buildContent,
        options,
    );
    return unwrapResult(result);
}

// Designed for `server/api/internal/forum/api_forum_paths.ts`.
export async function getPostContentWithCustomReferencesAndChannelPreviewIfPossible<
    Context extends ServerActionContext,
    Content,
>(
    context: Context,
    postId: PostId,
    buildContent: (
        context: Context,
        spaceId: SpaceId,
        post: {authorId: AccountId; contentVersion: number; content: PostContent},
    ) => Promise<Content>,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<
    Result<{
        spaceId: SpaceId;
        version: number;
        createdTime: Date;
        createdTimeZone: TimeZone;
        channel: ChannelPreviewModel;
        content: Content;
    }>
> {
    const postItem = await getPostItemWithContentForAuthorization(context, postId, {consistency});

    const [channelResult, contentResult] = await runAllPromises([
        getChannelPreviewIfPossible(context, postItem.channelId, {consistency}),
        captureResultPromise(
            buildContent(context, postItem.spaceId, {
                authorId: postItem.authorId,
                contentVersion: postItem.contentUpdate?.mappings.length ?? 0,
                content: postItem.content,
            }),
        ),
    ]);

    if (!channelResult) return {ok: false, error: createPostNotFoundError(postId)};
    if (!channelResult.ok) return channelResult;

    // If `channelResult` is not ok, ignore errors from `buildContent()`. Only errors
    // from `channelResult` matter. `buildContent()` was executed optimistically in
    // parallel.
    const content = unwrapResult(contentResult);

    return {
        ok: true,
        value: {
            spaceId: postItem.spaceId,
            version: postItem.updateLockVersion ?? 0,
            createdTime: postItem.createdTime,
            createdTimeZone: postItem.createdTimeZone,
            channel: channelResult.value,
            content,
        },
    };
}
