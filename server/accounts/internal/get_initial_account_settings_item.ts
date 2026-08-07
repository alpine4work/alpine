import {AccountSettingsItem} from "~/server/accounts/internal/accounts_table.js";
import {initialAccountSettings} from "~/shared/accounts/accounts_settings.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

export function getInitialAccountSettingsItem(accountId: AccountId): AccountSettingsItem {
    return {
        ...initialAccountSettings,
        partitionType: "Account",
        sortRangeType: "Settings",
        accountId,
    };
}
