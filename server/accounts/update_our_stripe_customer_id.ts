import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {getInitialAccountBillingItem} from "~/server/accounts/internal/get_initial_account_billing_item.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";

/**
 * Update our account's Stripe customer ID.
 *
 * If the customer ID already exists in the database, this will update both
 * the Customer item and the Account Billing item to ensure consistency.
 *
 * If the customer ID does not exist, this will create both items.
 */
export async function updateOurStripeCustomerId(
    context: ServerSessionActionContext,
    stripeCustomerId: string,
): Promise<void> {
    const authorizedContext = context.actor.authorizeSession();

    const [customerItem, accountBillingItem] = await runAllPromises([
        AccountsTable.getItemIfExists(authorizedContext, {
            partitionType: "StripeCustomer",
            sortRangeType: "Attributes",
            stripeCustomerId,
            consistency: "Strong",
        }),
        AccountsTable.getItemIfExists(authorizedContext, {
            partitionType: "Account",
            sortRangeType: "Billing",
            accountId: authorizedContext.actor.getAccountId(),
            consistency: "Strong",
        }),
    ]);

    await DynamoTableSchema.executeTransaction(context, [
        customerItem
            ? AccountsTable.transactionDirectlyUpdateItem({
                  ...customerItem,
                  stripeCustomerId,
              })
            : AccountsTable.transactionCreateItem({
                  partitionType: "StripeCustomer",
                  sortRangeType: "Attributes",
                  accountId: authorizedContext.actor.getAccountId(),
                  stripeCustomerId,
              }),
        accountBillingItem
            ? AccountsTable.transactionDirectlyUpdateItem({
                  ...accountBillingItem,
                  stripeCustomerId,
              })
            : AccountsTable.transactionCreateItem(
                  getInitialAccountBillingItem(
                      authorizedContext.actor.getAccountId(),
                      stripeCustomerId,
                  ),
              ),
    ]);
}
