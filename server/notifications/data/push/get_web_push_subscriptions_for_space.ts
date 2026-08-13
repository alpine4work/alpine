import {ServerActionContext} from "~/server/context/server_action_context.js";
import {getWebPushSubscriptionItemsWithoutAuthorization} from "~/server/notifications/data/internal/push/get_web_push_subscription_items_without_authorization.js";
import {authorizeNotBotSpaceAccount} from "~/server/spaces/authorize_not_bot_space_account.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {BrowserId} from "~/shared/id/types/id_types.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {WebPushSubscription} from "~/shared/notifications/web_push_subscription.js";

/**
 * Get all web push subscriptions registered for the provided `AccountId` and
 * `SpaceId`.
 *
 * System actors can see the web push subscriptions for any account since we need
 * to send push notifications to the account's web push subscriptions as the system
 * actor.
 */
export async function getAccountWebPushSubscriptionsForSpace(
    context: ServerActionContext,
    accountId: AccountId,
    spaceId: SpaceId,
): Promise<Array<{browserId: BrowserId; subscription: WebPushSubscription}>> {
    await runAllPromises([
        authorizeSpaceAccess(context, spaceId),
        authorizeNotBotSpaceAccount(context, spaceId, accountId),
    ]);

    const subscriptionItems = await getWebPushSubscriptionItemsWithoutAuthorization(context, {
        accountId,
    });

    return filterMapArray(subscriptionItems, item => {
        if (item.subscription === null || item.optedOutSpaceIds.has(spaceId)) return;
        return {
            browserId: item.browserId,
            subscription: item.subscription,
        };
    });
}
