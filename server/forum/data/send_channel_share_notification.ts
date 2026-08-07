import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {authorizeChannelAccess} from "~/server/forum/data/authorize_channel_access.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {ChannelId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Send a `ShareNotification` for the channel without updating the channel's
 * `AccessPolicy`.
 */
export async function sendChannelShareNotification(
    context: ServerSessionActionContext,
    channelId: ChannelId,
    notification: ShareNotification,
) {
    const {spaceId} = await authorizeChannelAccess(context, channelId, "View");

    await context.jobs.sendAndWait({
        type: "SendShareNotification",
        jobId: generateId(),
        spaceId,
        actorAccountId: context.actor.getAccountId(),
        entityId: `Channel:${channelId}`,
        notification,
    });
}
