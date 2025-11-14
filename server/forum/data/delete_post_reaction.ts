import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {authorizeChannelAccess} from "~/server/forum/data/authorize_channel_access.js";
import {ForumRealtimeTable} from "~/server/forum/data/internal/forum_realtime_table.js";
import {getPostItemWithContentForAuthorization} from "~/server/forum/data/internal/get_post_item_for_authorization.js";
import {PostId} from "~/shared/id/types/id_types.js";
import {ReactionSet} from "~/shared/reactions/reaction_set.js";

/**
 * Deletes a reaction for the actor on a post.
 *
 * The next time the actor tries to set a reaction it'll be in a different
 * chronological position.
 */
export async function deletePostReaction(context: ServerAccountActionContext, postId: PostId) {
    const item = await getPostItemWithContentForAuthorization(context, postId);

    await authorizeChannelAccess(context, item.channelId, "Comment");

    const {getEvent} = await ForumRealtimeTable.updateItem(
        context,
        {partitionType: "Post", sortRangeType: "Attributes", postId},
        item => {
            const newReactions = new Map(item.reactions.get());

            newReactions.delete(context.actor.getPossiblyBotAccountId());

            return item.update({reactions: new ReactionSet(newReactions)});
        },
        {initialItem: item},
    );

    return {getDynamoGeneralRealtimeEvent: getEvent};
}
