import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeChannelAccess} from "~/server/forum/data/authorize_channel_access.js";
import {ForumTable} from "~/server/forum/data/internal/forum_table.js";
import {emptyObject} from "~/shared/helpers/object/empty_object.js";
import {ChannelId} from "~/shared/id/types/id_types.js";

/**
 * Returns true if the actor is subscribed to the channel.
 */
export async function isSubscribedToChannel(
    context: ServerSessionActionContext,
    channelId: ChannelId,
    {consistency}: {consistency?: DynamoReadConsistency} = emptyObject,
): Promise<boolean> {
    await authorizeChannelAccess(context, channelId, "View");

    const item = await ForumTable.getItemIfExists(
        context,
        {
            partitionType: "Channel",
            sortRangeType: "Subscription",
            channelId,
            accountId: context.actor.getAccountId(),
        },
        {consistency},
    );

    return !!item;
}
