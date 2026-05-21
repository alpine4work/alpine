import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {updateChannelAccessPolicyBase} from "~/server/forum/data/internal/update_channel_access_policy_base.js";
import {AccessLevel} from "~/shared/access/access_policy.js";
import {reduceAccessPolicy} from "~/shared/access/access_policy_action.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {ChannelContributorsModel, ChannelModel} from "~/shared/forum/channel_model.js";
import {AccountId, ChannelId} from "~/shared/id/types/id_types.js";
import {SiteEntryModel, SitePreviewModel} from "~/shared/sites/site_model.js";

/**
 * Updates the channel's `AccessPolicy` by adding account grants. This allows you
 * to avoid conflicting update race conditions since you're not replacing the
 * entire access policy.
 */
export async function addAccountGrantsToChannelAccessPolicy(
    context: ServerSessionActionContext,
    {
        channelId,
        accountGrantById,
        notification,
    }: {
        channelId: ChannelId;
        accountGrantById: ReadonlyMap<AccountId, {readonly level: AccessLevel}>;
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
    return updateChannelAccessPolicyBase(context, {
        channelId,
        updateAccessPolicy: accessPolicy => {
            if (accessPolicy.type === "Site") {
                throw new FailedPreconditionError(
                    "Can\u2019t modify site access policy through one of its entities",
                );
            }
            return reduceAccessPolicy(context.actor.getAccountId(), accessPolicy, {
                type: "AddAccountGrants",
                accountGrantById,
            });
        },
        notification,
    });
}
