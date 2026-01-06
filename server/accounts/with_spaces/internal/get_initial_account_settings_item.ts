import {AccountSettingsItem} from "~/server/accounts/internal/accounts_table.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {AccountId} from "~/shared/id/types/id_types.js";

export function getInitialAccountSettingsItem(accountId: AccountId): AccountSettingsItem {
    return {
        partitionType: "Account",
        sortRangeType: "Settings",
        accountId,
        observedTimeZone: defaultTimeZone,
    };
}
