import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {updateChannelAccessPolicyBase} from "~/server/forum/data/internal/update_channel_access_policy_base.js";
import {CreateOrUpdateAccessPolicy} from "~/shared/access/model/create_or_update_access_policy_schema.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {DynamoGeneralRealtimeEvent} from "~/shared/dynamo/dynamo_general_realtime_types.js";
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
    getDynamoGeneralRealtimeEventTransaction: (
        context: ServerActionContext,
    ) => Promise<
        ReadonlyArray<DynamoGeneralRealtimeEvent<ChannelModel | ChannelContributorsModel>>
    >;
    getDynamoGeneralRealtimeEventTransactionForSite: (
        context: ServerActionContext,
    ) => Promise<ReadonlyArray<DynamoGeneralRealtimeEvent<SitePreviewModel | SiteEntryModel>>>;
}> {
    return updateChannelAccessPolicyBase(context, {
        channelId,
        updateAccessPolicy: () => accessPolicy,
        notification,
    });
}
