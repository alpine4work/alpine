import {AccountItem, AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {Context} from "~/shared/context/context.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {AccountId} from "~/shared/id/types/id_types.js";

/**
 * You should not call this function! It does not authorize that you are
 * allowed to update the account's plan. This function bypasses normal
 * authorization checks and should only be used in administrative or
 * system-level operations where you have already verified the operation
 * is permitted.
 *
 * This function accepts AppServiceProcessContext but the type is relaxed
 * to avoid circular dependencies in tests.
 */
export async function dangerouslyUpdateAccountPlan(
    context: Context<DynamoContextModules>,
    accountId: AccountId,
    plan: AccountItem["plan"],
): Promise<void> {
    await AccountsTable.updateItem(
        context,
        {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId,
        },
        item => {
            // The item should already exist if we're updating the plan
            assert(item);

            if (item.plan === plan) {
                return item;
            }

            return {
                ...item,
                plan,
            };
        },
    );
}
