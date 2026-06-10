import {ServerActionContext} from "~/server/context/server_action_context.js";
import {NotificationsTable} from "~/server/notifications/data/internal/notifications_table.js";
import {getWebPushSubscriptionItemIfExistsWithoutAuthorization} from "~/server/notifications/data/internal/push/get_web_push_subscription_item_if_exists_without_authorization.js";
import {AccountId, BrowserId} from "~/shared/id/types/id_types.js";

/**
 * Sets a web push subscription attribute to null. Retains opted-out spaces when
 * removing the subscription item in case the user re-subscribes to web push
 * notifications later in the same browser.
 *
 * Performs no authorization, you should use `deregisterWebPushSubscription()` or
 * ensure you check authorization before calling this function.
 */
export async function deregisterWebPushSubscriptionWithoutAuthorization(
    context: ServerActionContext,
    {accountId, browserId}: {accountId: AccountId; browserId: BrowserId},
) {
    const existingSubscriptionItem = await getWebPushSubscriptionItemIfExistsWithoutAuthorization(
        context,
        {accountId, browserId},
        // NOTE (rmtobin): we use strong consistency here to ensure the subscription item
        // truly doesn't exist for the if below so we don't accidentally skip removing a
        // subscription due to eventual consistency lag, which could result in a user
        // receiving notifications for a signed out account.
        {consistency: "Strong"},
    );

    if (!existingSubscriptionItem) {
        return;
    }

    await NotificationsTable.updateItem(
        context,
        {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId,
            browserId,
        },
        item => {
            if (item.subscription === null) return item;
            return {
                ...item,
                lastUpdatedTime: new Date(),
                subscription: null,
            };
        },
        {initialItem: existingSubscriptionItem},
    );
}
