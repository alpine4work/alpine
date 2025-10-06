import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {updateChannelAccessPolicyBase} from "~/server/forum/data/internal/update_channel_access_policy_base.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {DynamoGeneralRealtimeEvent} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {ChannelContributorsModel, ChannelModel} from "~/shared/forum/channel_model.js";
import {ChannelId} from "~/shared/id/types/id_types.js";

/**
 * Updates the channel's `AccessPolicy`. The session actor must be a manager on
 * the channel to update the channel's access policy.
 */
export async function updateChannelAccessPolicy(
    context: ServerSessionActionContext,
    {
        channelId,
        accessPolicy,
        notification,
    }: {
        channelId: ChannelId;
        accessPolicy: AccessPolicy;
        notification: ShareNotification | null;
    },
): Promise<{
    getDynamoGeneralRealtimeEventTransaction: (context: ServerActionContext) => Promise<{
        readTime: Date;
        eventTransaction: ReadonlyArray<
            DynamoGeneralRealtimeEvent<ChannelModel | ChannelContributorsModel>
        >;
    }>;
}> {
    return updateChannelAccessPolicyBase(context, {
        channelId,
        updateAccessPolicy: () => accessPolicy,
        notification,
    });
}
