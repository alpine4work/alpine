import {getAccountSettingsItem} from "~/server/accounts/internal/get_account_settings_item.js";
import {authorizeOwnSpaceAccountAccess} from "~/server/spaces/authorize_own_space_account_access.js";
import {AuthorizeSpaceAccessContext} from "~/server/spaces/authorize_space_access.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {AccountId} from "~/shared/id/types/id_types.js";

/**
 * Get the observed time zone for the provided account. System actors are allowed
 * to get the time zone for any account in their space, but session actors and bots
 * are only allowed to get the time zone for their own account.
 */
export async function getAccountTimeZoneIfExists(
    context: AuthorizeSpaceAccessContext,
    accountId: AccountId,
): Promise<TimeZone | null> {
    await authorizeOwnSpaceAccountAccess(context, accountId);
    const accountSettingsItem = await getAccountSettingsItem(context, accountId);
    return accountSettingsItem.observedTimeZone;
}
