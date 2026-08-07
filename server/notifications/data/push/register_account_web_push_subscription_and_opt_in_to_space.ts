import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {createOrUpdateAccountWebPushSubscriptionWithoutAuthorization} from "~/server/notifications/data/internal/push/create_or_update_web_push_subscription_without_authorization.js";
import {authorizeNotBotSpaceAccount} from "~/server/spaces/authorize_not_bot_space_account.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {BrowserId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {WebPushSubscription} from "~/shared/notifications/web_push_subscription.js";

/**
 * Opts in to web push notifications for a space with a given browser.
 *
 * Must provide a web push subscription to register for this browser, which will
 * update the existing subscription if it exists or create a new one if it doesn't.
 * If you know an account has already registered a subscription for this browser
 * and not previously opted out of web push notifications for this space, it's not
 * necessary to opt in, as all spaces begin opted in by default when a new
 * subscription is registered.
 *
 * The actor must the authorized to access the provided `spaceId`.
 */
export async function registerAccountWebPushSubscriptionAndOptInToSpace(
    context: ServerSessionActionContext,
    {
        browserId,
        spaceId,
        subscription,
    }: {
        browserId: BrowserId;
        spaceId: SpaceId;
        subscription: WebPushSubscription;
    },
) {
    const accountId = context.actor.getAccountId();
    await runAllPromises([
        authorizeSpaceAccess(context, spaceId),
        authorizeNotBotSpaceAccount(context, spaceId, accountId),
    ]);

    await createOrUpdateAccountWebPushSubscriptionWithoutAuthorization(context, {
        accountId,
        browserId,
        subscription,
        spaceIdToOptIn: spaceId,
    });
}
