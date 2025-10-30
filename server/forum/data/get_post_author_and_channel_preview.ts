import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getChannelPreviewIfPossible} from "~/server/forum/data/get_channel_preview.js";
import {getPostItemForAuthorizationIfExists} from "~/server/forum/data/internal/get_post_item_for_authorization.js";
import {getAccount} from "~/server/spaces/spaces_actions.js";
import {ErrorBase} from "~/shared/error/error.js";
import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {createPostNotFoundError} from "~/shared/forum/forum_error_messages.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {Result} from "~/shared/helpers/control/result.js";
import {PostId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

/**
 * Get the `ChannelPreviewModel` for a post and the `AccountModel` who authored
 * the post.
 *
 * The result is cached. If you call this for the same `PostId` multiple
 * times in the same action you'll get the same result without issuing a
 * network request.
 */
// Designed for `server/notifications/data/notifications_table.ts`.
export async function getPostAuthorAndChannelPreviewIfPossible(
    context: ServerActionContext,
    postId: PostId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<{author: AccountModel; channel: ChannelPreviewModel}, ErrorBase> | null> {
    const postItem = await getPostItemForAuthorizationIfExists(context, postId, options);
    if (!postItem) return null;

    const authorPromise = getAccount(context, postItem.spaceId, postItem.authorId, options);
    const channelResultPromise = getChannelPreviewIfPossible(context, postItem.channelId, options);

    const [, channelResult] = await runAllPromises([
        authorPromise.catch(() => {
            // Ignore errors but wait for `authorPromise` to resolve. If
            // `channelResultPromise` returns an `ok: false` result then we're going to
            // ignore any errors from `getAccount()`.
        }),
        channelResultPromise,
    ]);

    // The channel referenced by `postItem` must always exist.
    assert(channelResult);

    if (!channelResult.ok) return channelResult;

    const author = await authorPromise;

    return {ok: true, value: {author, channel: channelResult.value}};
}

/**
 * Get the `ChannelPreviewModel` for a post and the `AccountModel` who authored
 * the post.
 *
 * The result is cached. If you call this for the same `PostId` multiple
 * times in the same action you'll get the same result without issuing a
 * network request.
 */
export async function getPostAuthorAndChannelPreview(
    context: ServerActionContext,
    postId: PostId,
    options?: {consistency?: DynamoCacheReadConsistency},
) {
    const result = await getPostAuthorAndChannelPreviewIfPossible(context, postId, options);
    if (!result) throw createPostNotFoundError(postId);
    return unwrapResult(result);
}
