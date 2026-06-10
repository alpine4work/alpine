import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {AccountId} from "~/shared/id/types/id_types.js";

/**
 * Create a DynamoDB transaction entry that checks the account's `nameVersion` is
 * equal to the provided value.
 */
export function createAccountNameVersionConditionCheckTransactionEntry(
    accountId: AccountId,
    nameVersion: number,
): DynamoTransactionEntry {
    return AccountsTable.transactionConditionCheck(
        {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId,
        },
        {
            nameVersion,
        },
    );
}
