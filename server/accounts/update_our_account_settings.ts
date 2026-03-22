import {AccountSettingsItem, AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {getInitialAccountSettingsItem} from "~/server/accounts/internal/get_initial_account_settings_item.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {
    AccountSettingsAction,
    applyAccountSettingsAction,
} from "~/shared/accounts/accounts_settings.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Updates the session actor's settings.
 */
export async function updateOurAccountSettings(
    context: ServerSessionActionContext,
    action: AccountSettingsAction | ReadonlyArray<AccountSettingsAction>,
): Promise<void> {
    const actions = isReadonlyArray(action) ? action : [action];

    let oldAccountSettingsItem: AccountSettingsItem | undefined;

    const newAccountSettingsItem = await AccountsTable.updateItem(
        context,
        {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId: context.actor.getAccountId(),
        },
        item => {
            item ??= getInitialAccountSettingsItem(context.actor.getAccountId());
            oldAccountSettingsItem = item;

            const newItem = actions.reduce(applyAccountSettingsAction, item);
            if (newItem === item) return item;

            return {
                ...newItem,
                partitionType: "Account",
                sortRangeType: "Settings",
                accountId: context.actor.getAccountId(),
                updateLockVersion: item.updateLockVersion,
            };
        },
    );

    assert(oldAccountSettingsItem);
    assert(newAccountSettingsItem);

    if (
        newAccountSettingsItem.observedTimeZone !== null &&
        oldAccountSettingsItem.observedTimeZone !== newAccountSettingsItem.observedTimeZone
    ) {
        // This ensures notifications related to the inbox are in the correct time zone.
        await context.notificationsInjection.notifyInboxOfTimeZoneChange(
            newAccountSettingsItem.observedTimeZone,
        );
    }
}
