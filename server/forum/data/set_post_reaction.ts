import {ServerSessionActionContextWithApns} from "~/server/context/server_session_action_context_with_apns.js";
import {authorizeChannelAccess} from "~/server/forum/data/authorize_channel_access.js";
import {ForumRealtimeTable} from "~/server/forum/data/internal/forum_realtime_table.js";
import {getPostItemWithContentForAuthorization} from "~/server/forum/data/internal/get_post_item_for_authorization.js";
import {sumIterable} from "~/shared/helpers/iterable/sum_iterable.js";
import {PostId} from "~/shared/id/types/id_types.js";
import {Reaction} from "~/shared/reactions/reaction.js";
import {ReactionSet} from "~/shared/reactions/reaction_set.js";

/**
 * Sets a reaction for the actor on a post. If `null` then the reaction is the
 * default heart.
 *
 * If the account hasn't reacted before then they'll be added to the end of the
 * chronological reaction order. If the account has reacted before and we're
 * changing their reaction then the position stays the same.
 */
export async function setPostReaction(
    context: ServerSessionActionContextWithApns,
    postId: PostId,
    reaction: Reaction | "GenericLike",
) {
    const item = await getPostItemWithContentForAuthorization(context, postId);

    await authorizeChannelAccess(context, item.channelId, "Comment");

    const {getEvent} = await ForumRealtimeTable.updateItem(
        context,
        {partitionType: "Post", sortRangeType: "Attributes", postId},
        item => {
            const newReactions = new Map(item.reactions.get());

            newReactions.set(context.actor.getAccountId(), reaction);

            return item.update({reactions: new ReactionSet(newReactions)});
        },
        {initialItem: item},
    );

    context.process.waitUntil(
        context.notificationsInjection.archiveInboxPostCommentsEntryAfterSetPostCommentReaction({
            spaceId: item.spaceId,
            postId,
            commentCount: sumIterable(item.commentsSummary.commentCountByAuthorId.values()),
            commentIndex: null,
        }),
    );

    return {getDynamoGeneralRealtimeEvent: getEvent};
}
