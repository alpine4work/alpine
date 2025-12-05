import {ServerActionContext} from "~/server/context/server_action_context.js";
import {
    NotificationsTable,
    WebPushSubscriptionItem,
} from "~/server/notifications/data/internal/notifications_table.js";
import {AccountId, BrowserId} from "~/shared/id/types/id_types.js";

/**
 * Get a web push subscription item if it exists for the provided `accountId` and `browserId`.
 *
 * Performs no authorization, you should use `getWebPushSubscription()` or ensure you check
 * authorization before calling this function.
 */
export function getWebPushSubscriptionItemIfExistsWithoutAuthorization(
    context: ServerActionContext,
    {accountId, browserId}: {accountId: AccountId; browserId: BrowserId},
    {consistency}: {consistency: "Strong" | "Eventual"} = {consistency: "Eventual"},
): Promise<WebPushSubscriptionItem | null> {
    return NotificationsTable.getItemIfExists(
        context,
        {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId,
            browserId,
        },
        {consistency},
    );
}
