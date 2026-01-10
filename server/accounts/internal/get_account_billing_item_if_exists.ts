import {AccountBillingItem, AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {unknownAccountId} from "~/shared/accounts/account_model_without_space.js";
import {Context} from "~/shared/context/context.js";
import {AccountId} from "~/shared/id/types/id_types.js";

export async function getAccountBillingItemIfExists(
    context: Context<DynamoContextModules>,
    accountId: AccountId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<AccountBillingItem | null> {
    // Pretend like the unknown account doesn't exist. We do have an unknown
    // account record in our database as a safety precaution to make sure we
    // don't accidentally create an account with the unknown `AccountId`. But we
    // should never return that data. Instead if you want data for an unknown
    // account call `AccountModel.getUnknown()`.
    //
    // Calling `getAccount(unknownAccountId)` should always fail with a not
    // found error.
    if (accountId === unknownAccountId) return null;

    const accountBillingItem = await AccountsTable.getItemIfExists(context, {
        partitionType: "Account",
        sortRangeType: "Billing",
        accountId,
        consistency,
    });
    return accountBillingItem;
}
