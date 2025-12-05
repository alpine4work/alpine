import {ServerActionContext} from "~/server/context/server_action_context.js";
import {NotificationsTable} from "~/server/notifications/data/internal/notifications_table.js";
import {DataLossError} from "~/shared/error/error.js";
import {AccountId, BrowserId} from "~/shared/id/types/id_types.js";

/**
 * Sets a web push subscription to null. Retains opted-out spaces when removing the subscription in
 * case the user re-subscribes to web push notifications later in the same browser.
 */
export async function removeWebPushSubscriptionWithoutAuthorization(
    context: ServerActionContext,
    {accountId, browserId}: {accountId: AccountId; browserId: BrowserId},
) {
    await NotificationsTable.updateItem(
        context,
        {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId,
            browserId,
        },
        item => {
            if (!item)
                throw new DataLossError("Can’t update web push subscription that doesn’t exist");
            return {
                ...item,
                lastUpdatedTime: new Date(),
                subscription: null,
            };
        },
    );
}
