import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {deregisterWebPushSubscriptionWithoutAuthorization} from "~/server/notifications/data/internal/push/deregister_web_push_subscription_without_authorization.js";
import {BrowserId} from "~/shared/id/types/id_types.js";

/**
 * Deregisters a web push subscription for a given account and browser.
 * If the subscription item doesn't exist or the subscription attribute is already null,
 * this function does nothing.
 *
 * Removing a web push subscription removes it for all spaces on that browser, meaning they will not
 * receive push notifications from that browser until they re-subscribe. If you want to opt out of
 * notifications for a specific space, you should use `optOutOfWebPushForSpace()` instead.
 */
export async function deregisterOurAccountWebPushSubscription(
    context: ServerSessionActionContext,
    {browserId}: {browserId: BrowserId},
) {
    const authorizedContext = context.actor.authorizeSession();

    await deregisterWebPushSubscriptionWithoutAuthorization(authorizedContext, {
        accountId: authorizedContext.actor.getAccountId(),
        browserId,
    });
}
