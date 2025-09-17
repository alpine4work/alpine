import {AccountSettingsItem, AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {authorizeOwnSpaceAccountAccess} from "~/server/spaces/spaces_table.js";
import {AccountsSettingsSchema} from "~/shared/accounts/accounts_settings_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {TimeZone, assertTimeZone, isTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {quote} from "~/shared/helpers/string/quote.js";
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
    const accountSettingsItem = await AccountsTable.getItemIfExists(context, {
        partitionType: "Account",
        sortRangeType: "Settings",
        accountId,
    });

    return accountSettingsItem?.observedTimeZone
        ? assertTimeZone(accountSettingsItem.observedTimeZone)
        : null;
}

/**
 * Updates the session actor's time zone.
 * Time zone is set at the account level and is not tied to a specific space.
 * Only session actors are allowed to update their own time zone.
 */
export async function updateOurAccountObservedTimeZone(
    context: ServerSessionActionContext,
    timeZone: TimeZone,
): Promise<AccountSettingsItem | null> {
    assert(isTimeZone(timeZone), quote`Received invalid time zone: \`${timeZone}\``);
    context.actor.authorizeSession();
    const updatedAccountSettingsItem = await AccountsTable.updateItem(
        context,
        {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId: context.actor.getAccountId(),
        },
        item => {
            item ??= {
                partitionType: "Account",
                sortRangeType: "Settings",
                accountId: context.actor.getAccountId(),
                ...AccountsSettingsSchema.deserialize({}),
            };

            return {
                ...item,
                observedTimeZone: timeZone,
            };
        },
    );

    // This ensures notifications related to the inbox are in the correct time zone.
    await context.notificationsInjection.notifyInboxOfTimeZoneChange(timeZone);

    return updatedAccountSettingsItem;
}
