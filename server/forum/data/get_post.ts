import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeChannelAccessIfPossible} from "~/server/forum/data/authorize_channel_access.js";
import {ForumRealtimeTable} from "~/server/forum/data/internal/forum_realtime_table.js";
import {getPostItemWithContentForAuthorization} from "~/server/forum/data/internal/get_post_item_for_authorization.js";
import {RynamoItem} from "~/shared/dynamo/rynamo_types.js";
import {ErrorBase} from "~/shared/error/error.open_source.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.open_source.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {Result} from "~/shared/helpers/control/result.open_source.js";
import {PostId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Gets the post with the provided `PostId`.
 */
export async function getPost(
    context: ServerActionContext,
    postId: PostId,
    options?: {consistency?: DynamoReadConsistency},
): Promise<RynamoItem<PostModel>> {
    return unwrapResult(await getPostIfPossible(context, postId, options));
}

/**
 * Gets the post with the provided `PostId`. If you don't have access to the post
 * we return a result with an error instead of throwing. Throws an error if the
 * post doesn't exist in the database.
 */
export async function getPostIfPossible(
    context: ServerActionContext,
    postId: PostId,
    {consistency = "Eventual"}: {consistency?: DynamoReadConsistency} = {},
): Promise<Result<RynamoItem<PostModel>, ErrorBase>> {
    const postItem = await getPostItemWithContentForAuthorization(context, postId, {consistency});

    // Optimization: Don't wait until the channel loads (and so we call
    // `evaluateAccessPolicy()`) to report the post's `SpaceId` as discovered.
    context.discovery?.discoverSpaceId(postItem.spaceId, "AuthorizeAccess");

    const [authorizationResult, postResult] = await runAllPromises([
        authorizeChannelAccessIfPossible(context, postItem.channelId, "View"),
        captureResultPromise(ForumRealtimeTable.buildRealtimeItem(context, postItem)),
    ]);
    if (!authorizationResult.ok) return authorizationResult;

    // Ignore errors from `postResult` if authorization fails (since it's probably the
    // same error). Otherwise, if authorization passed and building the post item
    // failed treat that as an exception.
    const post = unwrapResult(postResult);

    return {ok: true, value: post};
}
