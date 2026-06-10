import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {createOrUpdateAccountWebPushSubscriptionWithoutAuthorization} from "~/server/notifications/data/internal/push/create_or_update_web_push_subscription_without_authorization.js";
import {BrowserId} from "~/shared/id/types/id_types.js";
import {WebPushSubscription} from "~/shared/notifications/web_push_subscription.js";

/**
 * Registers a web push subscription for an account to the database and does not
 * change the opt out status for any spaces. By default, all of an account's spaces
 * begin opted in.
 */
export async function registerOurAccountWebPushSubscription(
    context: ServerSessionActionContext,
    {
        subscription,
        browserId,
    }: {
        subscription: WebPushSubscription;
        browserId: BrowserId;
    },
) {
    context.actor.authorizeSession();
    const accountId = context.actor.getAccountId();

    await createOrUpdateAccountWebPushSubscriptionWithoutAuthorization(context, {
        accountId,
        browserId,
        subscription,
    });
}
