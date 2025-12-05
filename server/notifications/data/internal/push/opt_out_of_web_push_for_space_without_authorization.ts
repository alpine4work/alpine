import {ServerActionContext} from "~/server/context/server_action_context.js";
import {NotificationsTable} from "~/server/notifications/data/internal/notifications_table.js";
import {getInitialWebPushSubscriptionItem} from "~/server/notifications/data/internal/push/get_initial_web_push_subscription_item.js";
import {AccountId, BrowserId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Opts out of web push for a space without authorization.
 *
 * Will create a new web push subscription item if one does not exist with a null subscription and
 * endpoint. This means that if a user subscribes to web push later with the same browser but a
 * different space, they will remain opted out of notifications for previously opted out spaces.
 *
 * Performs no authorization, you should use `optOutOfWebPushForSpace()` or ensure you check
 * authorization before calling this function.
 */
export async function optOutOfWebPushForSpaceWithoutAuthorization(
    context: ServerActionContext,
    {accountId, browserId, spaceId}: {accountId: AccountId; browserId: BrowserId; spaceId: SpaceId},
) {
    const currentTime = new Date();
    await NotificationsTable.updateItem(
        context,
        {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId,
            browserId,
        },
        item => {
            item ??= getInitialWebPushSubscriptionItem(browserId, accountId, currentTime);
            if (item.optedOutSpaceIds.has(spaceId)) return item;
            return {
                ...item,
                lastUpdatedTime: currentTime,
                optedOutSpaceIds: new Set([...item.optedOutSpaceIds, spaceId]),
            };
        },
    );
}
