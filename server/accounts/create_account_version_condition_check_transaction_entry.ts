import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {AccountModelWithoutSpace} from "~/shared/accounts/account_model_without_space.js";

/**
 * Transaction entry that checks to make sure an account email address does not
 * already exist.
 */
export function createAccountVersionConditionCheckTransactionEntry(
    account: AccountModelWithoutSpace,
): DynamoTransactionEntry {
    return AccountsTable.transactionUpdateLockVersionConditionCheck(
        {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: account.id,
        },
        // `AccountModel.initialData.version` is the same as `updateLockVersion`.
        account.initialData.version,
    );
}
