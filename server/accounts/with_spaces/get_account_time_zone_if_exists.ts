import {getAccountSettingsItemIfExists} from "~/server/accounts/with_spaces/internal/get_account_settings_item_if_exists.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {authorizeOwnSpaceAccountAccess} from "~/server/spaces/authorize_own_space_account_access.js";
import {TimeZone, assertTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {AccountId} from "~/shared/id/types/id_types.js";

/**
 * Get the observed time zone for the provided account.
 * System actors are allowed to get the time zone for any account in their space, but session actors
 * and bots are only allowed to get the time zone for their own account.
 */
export async function getAccountTimeZoneIfExists(
    context: ServerActionContext,
    accountId: AccountId,
): Promise<TimeZone | null> {
    await authorizeOwnSpaceAccountAccess(context, accountId);
    const accountSettingsItem = await getAccountSettingsItemIfExists(context, accountId);

    return accountSettingsItem?.observedTimeZone
        ? assertTimeZone(accountSettingsItem.observedTimeZone)
        : null;
}
