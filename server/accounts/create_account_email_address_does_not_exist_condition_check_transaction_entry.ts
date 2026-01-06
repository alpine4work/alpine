import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {EmailAddress} from "~/server/emails/email_address.js";

/**
 * Transaction entry that checks to make sure an account email address does not
 * already exist.
 */
export function createAccountEmailAddressDoesNotExistConditionCheckTransactionEntry(
    emailAddress: EmailAddress,
): DynamoTransactionEntry {
    return AccountsTable.transactionDoesNotExistConditionCheck({
        partitionType: "AccountEmailAddress",
        sortRangeType: "Attributes",
        emailAddress,
    });
}
