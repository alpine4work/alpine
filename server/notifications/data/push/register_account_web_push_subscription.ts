import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {createOrUpdateAccountWebPushSubscriptionWithoutAuthorization} from "~/server/notifications/data/internal/push/create_or_update_web_push_subscription_without_authorization.js";
import {authorizeNotBotSpaceAccount, authorizeSpaceAccess} from "~/server/spaces/spaces_actions.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {BrowserId, SpaceId} from "~/shared/id/types/id_types.js";
import {WebPushSubscription} from "~/shared/notifications/web_push_subscription.js";

/**
 * Registers a web push subscription for an account to the database.
 * Actor must be authorized to access the space.
 */
export async function registerAccountWebPushSubscription(
    context: ServerSessionActionContext,
    {
        subscription,
        spaceId,
        browserId,
    }: {subscription: WebPushSubscription; spaceId: SpaceId; browserId: BrowserId},
) {
    const accountId = context.actor.getAccountId();
    await runAllPromises([
        authorizeSpaceAccess(context, spaceId),
        authorizeNotBotSpaceAccount(context, spaceId, accountId),
    ]);

    await createOrUpdateAccountWebPushSubscriptionWithoutAuthorization(context, {
        accountId,
        browserId,
        spaceId,
        subscription,
    });
}
