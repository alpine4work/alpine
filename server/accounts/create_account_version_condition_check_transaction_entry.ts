import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Transaction entry that checks to make sure an account email address does not
 * already exist.
 */
export function createAccountVersionConditionCheckTransactionEntry(
    accountId: AccountId,
    version: number,
): DynamoTransactionEntry {
    return AccountsTable.transactionUpdateLockVersionConditionCheck(
        {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId,
        },
        version,
    );
}
