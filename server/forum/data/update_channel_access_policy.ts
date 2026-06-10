import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {updateChannelAccessPolicyBase} from "~/server/forum/data/internal/update_channel_access_policy_base.js";
import {CreateOrUpdateAccessPolicy} from "~/shared/access/model/create_or_update_access_policy_schema.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {ChannelContributorsModel, ChannelModel} from "~/shared/forum/channel_model.js";
import {ChannelId} from "~/shared/id/types/id_types.js";
import {SiteEntryModel, SitePreviewModel} from "~/shared/sites/site_model.js";

/**
 * Updates the channel's `AccessPolicy`. The session actor must be a manager on the
 * channel to update the channel's access policy.
 */
export async function updateChannelAccessPolicy(
    context: ServerSessionActionContext,
    {
        channelId,
        accessPolicy,
        notification,
    }: {
        channelId: ChannelId;
        accessPolicy: CreateOrUpdateAccessPolicy;
        notification: ShareNotification | null;
    },
): Promise<{
    getRynamoEvents: (
        context: ServerActionContext,
    ) => Promise<ReadonlyArray<RynamoEvent<ChannelModel | ChannelContributorsModel>>>;
    getRynamoEventsForSite: (
        context: ServerActionContext,
    ) => Promise<ReadonlyArray<RynamoEvent<SitePreviewModel | SiteEntryModel>>>;
}> {
    return await updateChannelAccessPolicyBase(context, {
        channelId,
        updateAccessPolicy: () => accessPolicy,
        notification,
    });
}
