import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {getWebPushSubscriptionItemIfExistsWithoutAuthorization} from "~/server/notifications/data/internal/push/get_web_push_subscription_item_if_exists_without_authorization.js";
import {authorizeNotBotSpaceAccount} from "~/server/spaces/authorize_not_bot_space_account.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {BrowserId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Gets the web push opt-out status for the provided `browserId`, and `spaceId` with the current
 * session actor's account.
 */
export async function isOptedOutOfWebPushForSpace(
    context: ServerSessionActionContext,
    {browserId, spaceId}: {browserId: BrowserId; spaceId: SpaceId},
) {
    const accountId = context.actor.getAccountId();
    await runAllPromises([
        authorizeSpaceAccess(context, spaceId),
        authorizeNotBotSpaceAccount(context, spaceId, accountId),
    ]);

    const subscription = await getWebPushSubscriptionItemIfExistsWithoutAuthorization(context, {
        accountId: context.actor.getAccountId(),
        browserId,
    });

    if (subscription && subscription.optedOutSpaceIds.has(spaceId)) {
        return true;
    }

    return false;
}
