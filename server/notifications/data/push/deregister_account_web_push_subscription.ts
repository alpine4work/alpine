import {ServerActionContext} from "~/server/context/server_action_context.js";
import {permissionDeniedBotError} from "~/server/helpers/permission_denied_bot_error.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {deregisterWebPushSubscriptionWithoutAuthorization} from "~/server/notifications/data/internal/push/deregister_web_push_subscription_without_authorization.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId, BrowserId} from "~/shared/id/types/id_types.js";

/**
 * Deregisters a web push subscription for a given account and browser.
 * If the subscription item doesn't exist or the subscription attribute is already null,
 * this function does nothing.
 *
 * Deregistering a web push subscription removes it for all spaces on that browser, meaning the user
 * will not receive any push notifications from that browser until they re-register. If you want to
 * opt out of notifications only for a specific space, you should use `optOutOfWebPushForSpace()`
 * instead.
 */
export async function deregisterAccountWebPushSubscription(
    context: ServerActionContext,
    {accountId, browserId}: {accountId: AccountId; browserId: BrowserId},
) {
    switch (context.actor.type) {
        case "Session":
        case "ImpersonatedAccount": {
            if (context.actor.getAccountId() !== accountId) {
                throw new PermissionDeniedError(
                    "Can\u2019t deregister web push subscription for a different account",
                );
            }
            break;
        }
        case "System": {
            // System actor can deregister web push subscriptions for any account.
            break;
        }
        case "Anonymous": {
            throw unauthenticatedSessionError();
        }
        case "Bot": {
            throw permissionDeniedBotError();
        }
        default:
            throw exhaustive(context.actor);
    }
    await deregisterWebPushSubscriptionWithoutAuthorization(context, {
        accountId,
        browserId,
    });
}
