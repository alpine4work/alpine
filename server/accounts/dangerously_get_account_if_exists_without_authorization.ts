import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {
    createAccountModelDataWithoutSpaceAndWithoutAvatarFromItem,
    createAccountModelWithoutSpaceFromItem,
} from "~/server/accounts/internal/create_account_model_without_space_from_item.js";
import {
    getAccountItemIfExists,
    getAccountItemWithoutAvatarIfExists,
} from "~/server/accounts/internal/get_account_item.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {
    AccountModelWithoutSpace,
    AccountModelWithoutSpaceData,
} from "~/shared/accounts/account_model_without_space.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {AccountId} from "~/shared/id/types/id_types.js";

/**
 * Get an account without authorizing whether the current context has access or
 * not.
 *
 * You should not call this function! It does not authorize that you are allowed to
 * access the account and does not cache accounts. Instead use
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

/**
 * Get an account (without avatar) without authorizing whether the current context
 * has access or not.
 *
 * You should not call this function! It does not authorize that you are allowed to
 * access the account and does not cache accounts. Instead use
 * `getAccountIfExists()` in `server/spaces/spaces_table.ts`.
 */
export async function dangerouslyGetAccountWithoutAvatarIfExistsWithoutAuthorization(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    accountId: AccountId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Omit<AccountModelWithoutSpaceData, "avatar"> | null> {
    const accountItem = await getAccountItemWithoutAvatarIfExists(context, accountId, options);
    if (!accountItem) return null;
    return createAccountModelDataWithoutSpaceAndWithoutAvatarFromItem(accountItem);
}

/**
 * Same as `dangerouslyGetAccountIfExistsWithoutAuthorization()` but we also return
 * `finishSignUpTransactionEntry` which when non-null means the account hasn't
 * finished signing up yet. Committing this transaction entry will mark the account
 * as finished signing up.
 */
export async function dangerouslyGetAccountAndWithFinishSignUpTransactionEntryIfExistsWithoutAuthorization(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    accountId: AccountId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<{
    account: AccountModelWithoutSpace;
    finishSignUpTransactionEntry: DynamoTransactionEntry | null;
} | null> {
    const accountItem = await getAccountItemIfExists(context, accountId, options);
    if (!accountItem) return null;

    return {
        account: createAccountModelWithoutSpaceFromItem(accountItem),
        finishSignUpTransactionEntry: accountItem.hasNotSignedUp
            ? AccountsTable.transactionDirectlyUpdateItem(
                  omitObject(accountItem, ["hasNotSignedUp"]),
              )
            : null,
    };
}
