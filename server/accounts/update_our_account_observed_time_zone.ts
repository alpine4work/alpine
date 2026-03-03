import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {getInitialAccountSettingsItem} from "~/server/accounts/internal/get_initial_account_settings_item.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {TimeZone, isTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {quote} from "~/shared/helpers/string/quote.js";

/**
 * Updates the session actor's time zone. Time zone is set at the account level and
 * is not tied to a specific space. Only session actors are allowed to update their
 * own time zone.
 */
export async function updateOurAccountObservedTimeZone(
    context: ServerSessionActionContext,
    timeZone: TimeZone,
): Promise<void> {
    const authorizedContext = context.actor.authorizeSession();

    if (!isTimeZone(timeZone)) {
        throw new InvalidArgumentError(quote`Received invalid time zone: \`${timeZone}\``);
    }

    const newAccountSettingsItem = await AccountsTable.updateItem(
        authorizedContext,
        {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId: authorizedContext.actor.getAccountId(),
        },
        item => {
            item ??= getInitialAccountSettingsItem(authorizedContext.actor.getAccountId());
            if (item.observedTimeZone === timeZone) return item;
            return {
                ...item,
                observedTimeZone: timeZone,
            };
        },
    );

    if (newAccountSettingsItem?.observedTimeZone !== timeZone) {
        // This ensures notifications related to the inbox are in the correct time zone.
        await authorizedContext.notificationsInjection.notifyInboxOfTimeZoneChange(timeZone);
    }
}
