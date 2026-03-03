import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {authorizeChannelAccess} from "~/server/forum/data/authorize_channel_access.js";
import {ForumTable} from "~/server/forum/data/internal/forum_table.js";
import {authorizeNotBotSpaceAccount} from "~/server/spaces/authorize_not_bot_space_account.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {ChannelId} from "~/shared/id/types/id_types.js";

/**
 * Subscribes the session actor to the channel. When new posts are made in the
 * channel they'll go into the session actor's inbox.
 */
export async function subscribeToChannel(
    context: ServerSessionActionContext,
    channelId: ChannelId,
) {
    const accountId = context.actor.getAccountId();
    const {spaceId} = await authorizeChannelAccess(context, channelId, "View");

    await runAllPromises([
        authorizeSpaceAccess(context, spaceId),

        // Bots aren't allowed to subscribe to channels.
        authorizeNotBotSpaceAccount(context, spaceId, accountId),
    ]);

    await ForumTable.updateItem(
        context,
        {
            partitionType: "Channel",
            sortRangeType: "Subscription",
            channelId,
            accountId,
        },
        item => {
            if (item) return item;

            return {
                partitionType: "Channel",
                sortRangeType: "Subscription",
                channelId,
                accountId,
                createdTime: new Date(),
            };
        },
    );
}

/**
 * Unsubscribes the session actor from the channel. They'll no longer see new posts
 * appear in their inbox.
 */
export async function unsubscribeFromChannel(
    context: ServerSessionActionContext,
    channelId: ChannelId,
) {
    const accountId = context.actor.getAccountId();
    const {spaceId} = await authorizeChannelAccess(context, channelId, "View");

    await runAllPromises([
        authorizeSpaceAccess(context, spaceId),

        // Bots aren't allowed to subscribe to channels.
        authorizeNotBotSpaceAccount(context, spaceId, accountId),
    ]);

    await ForumTable.updateItem(
        context,
        {
            partitionType: "Channel",
            sortRangeType: "Subscription",
            channelId,
            accountId,
        },
        item => {
            if (!item) return item;

            return null;
        },
    );
}
