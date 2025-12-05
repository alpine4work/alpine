import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {createOrUpdateAccountWebPushSubscriptionWithoutAuthorization} from "~/server/notifications/data/internal/push/create_or_update_web_push_subscription_without_authorization.js";
import {authorizeNotBotSpaceAccount, authorizeSpaceAccess} from "~/server/spaces/spaces_actions.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {BrowserId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Removes a web push subscription for an account and `browserId` pair across all spaces.
 *
 * Removing a web push subscription removes it for all spaces on that browser, meaning they will not
 * receive push notifications from that browser until they re-subscribe. If you want to opt out of
 * notifications for a specific space, you should use `optOutOfWebPushForSpace()` instead.
 */
export async function deregisterAccountWebPushSubscription(
    context: ServerSessionActionContext,
    {browserId, spaceId}: {browserId: BrowserId; spaceId: SpaceId},
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
        subscription: null,
    });
}
