import {ServerActionContext} from "~/server/context/server_action_context.js";
import {authorizeChannelAccess} from "~/server/forum/data/authorize_channel_access.js";
import {ForumRealtimeTable} from "~/server/forum/data/internal/forum_realtime_table.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {NotFoundError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable.js";
import {PostId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

/**
 * Get all the authors on a post to a certain limit.
 */
export async function getPostCommentAuthors(
    context: ServerActionContext,
    {postId, limit}: {postId: PostId; limit: number},
): Promise<Array<AccountModel>> {
    const postItem = await ForumRealtimeTable.getPartialItemIfExists(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId,
        },
        {
            attributes: ["spaceId", "channelId", "commentsSummary"],
        },
    );
    if (!postItem) throw new NotFoundError("Post not found");

    await authorizeChannelAccess(context, postItem.channelId, "View");

    return runAllPromises(
        Array.from(
            sliceIterable(postItem.commentsSummary.commentCountByAuthorId.keys(), 0, limit),
            accountId => getAccount(context, postItem.spaceId, accountId),
        ),
    );
}
