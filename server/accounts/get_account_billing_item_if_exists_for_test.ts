import {AccountBillingItem} from "~/server/accounts/internal/accounts_table.js";
import {getAccountBillingItemIfExists} from "~/server/accounts/internal/get_account_billing_item_if_exists.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {Context} from "~/shared/context/context.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

export async function getAccountBillingItemIfExistsForTest(
    context: Context<DynamoContextModules>,
    accountId: AccountId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<AccountBillingItem | null> {
    assert(process.env.NODE_ENV === "test");
    return await getAccountBillingItemIfExists(context, accountId, {consistency});
}
