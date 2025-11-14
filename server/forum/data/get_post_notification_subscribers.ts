import {ServerSystemActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeChannelAccess} from "~/server/forum/data/authorize_channel_access.js";
import {getPostItemForAuthorizationIfExists} from "~/server/forum/data/internal/get_post_item_for_authorization.js";
import {createPostNotFoundError} from "~/shared/forum/forum_error_messages.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {AccountId, PostId} from "~/shared/id/types/id_types.js";

/**
 * Get accounts subscribed to notifications for the provided `PostId`.
 */
export async function getPostNotificationSubscribers(
    context: ServerSystemActionContext,
    postId: PostId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<{
    accountIds: ReadonlySet<AccountId>;
    postCreatedTime: Date;
}> {
    const postItem = await getPostItemForAuthorizationIfExists(context, postId, {consistency});
    if (!postItem) throw createPostNotFoundError(postId);

    await authorizeChannelAccess(context, postItem.channelId, "View", {consistency});

    const accountIds = new Set(
        concatIterables(
            [postItem.authorId],
            postItem.commentsSummary.commentCountByAuthorId.keys(),
            postItem.commentsSummary.mentionCountByAccountId.keys(),
        ),
    );

    return {
        accountIds,
        postCreatedTime: postItem.createdTime,
    };
}
