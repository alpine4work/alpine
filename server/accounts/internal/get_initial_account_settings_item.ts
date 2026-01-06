import {AccountSettingsItem} from "~/server/accounts/internal/accounts_table.js";
import {AccountId} from "~/shared/id/types/id_types.js";

export function getInitialAccountSettingsItem(accountId: AccountId): AccountSettingsItem {
    return {
        partitionType: "Account",
        sortRangeType: "Settings",
        accountId,
        observedTimeZone: null,
    };
}
