import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {optOutOfWebPushForSpaceWithoutAuthorization} from "~/server/notifications/data/internal/push/opt_out_of_web_push_for_space_without_authorization.js";
import {authorizeNotBotSpaceAccount} from "~/server/spaces/authorize_not_bot_space_account.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {BrowserId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Opts out of web push notifications for a space for a given browser.
 *
 * Does not remove the web push subscription for the account and `browserId` pair so the user will
 * still receive notifications from other non-opted out spaces on this browser.
 */
export async function optOutOfWebPushForSpace(
    context: ServerSessionActionContext,
    {browserId, spaceId}: {browserId: BrowserId; spaceId: SpaceId},
) {
    const accountId = context.actor.getAccountId();
    await runAllPromises([
        authorizeSpaceAccess(context, spaceId),
        authorizeNotBotSpaceAccount(context, spaceId, accountId),
    ]);

    await optOutOfWebPushForSpaceWithoutAuthorization(context, {
        accountId,
        browserId,
        spaceId,
    });
}
