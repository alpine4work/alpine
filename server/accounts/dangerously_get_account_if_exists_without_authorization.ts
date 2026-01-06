import {createAccountModelWithoutSpaceFromItem} from "~/server/accounts/internal/create_account_model_without_space_from_item.js";
import {getAccountItemIfExists} from "~/server/accounts/internal/get_account_item.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {AccountModelWithoutSpace} from "~/shared/accounts/account_model_without_space.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {AccountId} from "~/shared/id/types/id_types.js";

/**
 * Get an account without authorizing whether the current context has
 * access or not.
 *
 * You should not call this function! It does not authorize that you are
 * allowed to access the account and does not cache accounts. Instead use
 * `getAccountIfExists()` in `server/spaces/spaces_table.ts`.
 */
export async function dangerouslyGetAccountIfExistsWithoutAuthorization(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    accountId: AccountId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<AccountModelWithoutSpace | null> {
    const accountItem = await getAccountItemIfExists(context, accountId, options);
    if (!accountItem) return null;
    return createAccountModelWithoutSpaceFromItem(accountItem);
}
