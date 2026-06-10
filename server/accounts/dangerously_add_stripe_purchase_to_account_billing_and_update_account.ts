import {AccountItem, AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {Context} from "~/shared/context/context.js";
import {DataLossError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {AccountId} from "~/shared/id/types/id_types.js";

/**
 * Add a Stripe purchase to the account's billing history and update relevant
 * account data.
 */
export async function dangerouslyAddStripePurchaseToAccountBillingAndUpdateAccount(
    context: Context<DynamoContextModules>,
    accountId: AccountId,
    {
        priceId,
        price,
        createdTime,
        accountPlan,
    }: {priceId: string; price: number; createdTime: Date; accountPlan: AccountItem["plan"]},
): Promise<void> {
    const [account, accountBillingItem] = await runAllPromises([
        AccountsTable.getItem(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId,
        }),
        AccountsTable.getItemIfExists(context, {
            partitionType: "Account",
            sortRangeType: "Billing",
            accountId,
            consistency: "Strong",
        }),
    ]);

    if (!accountBillingItem) {
        throw new DataLossError("No account billing item found when adding Stripe purchase");
    }

    const existingPurchase = accountBillingItem.stripePurchases.find(
        purchase =>
            purchase.priceId === priceId &&
            purchase.price === price &&
            purchase.createdTime.getTime() === createdTime.getTime(),
    );

    if (existingPurchase) {
        return;
    }

    await DynamoTableSchema.executeTransaction(context, [
        // Add the purchase
        AccountsTable.transactionDirectlyUpdateItem({
            ...accountBillingItem,
            stripePurchases: [...accountBillingItem.stripePurchases, {priceId, price, createdTime}],
        }),
        AccountsTable.transactionDirectlyUpdateItem({
            ...account,
            plan: accountPlan,
        }),
    ]);
}
