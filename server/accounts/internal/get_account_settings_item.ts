import {AccountSettingsItem, AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {getInitialAccountSettingsItem} from "~/server/accounts/internal/get_initial_account_settings_item.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {unknownAccountId} from "~/shared/accounts/account_model_without_space.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {AccountId} from "~/shared/id/types/id_types.js";

const AccountSettingsItemContextCache = new DynamoContextCache<AccountId, AccountSettingsItem>({
    // Allow sharing this cache because the results do not depend on who the actor is.
    whenActorChanges: "DangerouslyShare",
});

/**
 * Get the settings for the provided account.
 *
 * If the `AccountId` doesn't exist, we return initial settings.
 */
export async function getAccountSettingsItem(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    accountId: AccountId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<AccountSettingsItem> {
    // Pretend like the unknown account doesn't exist. We do have an unknown account
    // record in our database as a safety precaution to make sure we don't accidentally
    // create an account with the unknown `AccountId`. But we should never return that
    // data. Instead if you want data for an unknown account call
    // `AccountModel.getUnknown()`.
    //
    // Calling `getAccount(unknownAccountId)` should always fail with a not found
    // error.
    if (accountId === unknownAccountId) return getInitialAccountSettingsItem(accountId);

    return AccountSettingsItemContextCache.get(
        context,
        consistency,
        accountId,
        async consistency => {
            const accountSettingsItem = await AccountsTable.getItemIfExists(context, {
                partitionType: "Account",
                sortRangeType: "Settings",
                accountId,
                consistency,
            });

            return accountSettingsItem ?? getInitialAccountSettingsItem(accountId);
        },
    );
}
