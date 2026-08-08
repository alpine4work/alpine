import {AccountBillingItem} from "~/server/accounts/internal/accounts_table.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

export function getInitialAccountBillingItem(
    accountId: AccountId,
    stripeCustomerId: string,
): AccountBillingItem {
    return {
        partitionType: "Account",
        sortRangeType: "Billing",
        accountId,
        stripeCustomerId,
        stripePurchases: [],
        createdTime: new Date(),
    };
}
