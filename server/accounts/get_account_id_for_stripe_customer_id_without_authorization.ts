import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {Context} from "~/shared/context/context.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Get the account ID for a given Stripe customer ID.
 */
export async function getAccountIdForStripeCustomerIdWithoutAuthorization(
    context: Context<DynamoContextModules>,
    stripeCustomerId: string,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<AccountId | null> {
    const customer = await AccountsTable.getItemIfExists(context, {
        partitionType: "StripeCustomer",
        sortRangeType: "Attributes",
        stripeCustomerId,
        consistency,
    });

    return customer?.accountId || null;
}
