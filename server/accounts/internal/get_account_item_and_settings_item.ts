import {
    AccountItem,
    AccountSettingsItem,
    AccountsTable,
} from "~/server/accounts/internal/accounts_table.js";
import {getInitialAccountSettingsItem} from "~/server/accounts/internal/get_initial_account_settings_item.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {unknownAccountId} from "~/shared/accounts/account_model_without_space.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {NotFoundError} from "~/shared/error/error.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {AccountId} from "~/shared/id/types/id_types.js";

export const AccountItemAndSettingsItemContextCache = new DynamoContextCache<
    AccountId,
    {readonly accountItem: AccountItem; readonly settingsItem: AccountSettingsItem} | null
>({
    // Allow sharing this cache because the results do not depend on who the actor is.
    whenActorChanges: "DangerouslyShare",
});

export async function getAccountItemAndSettingsItemIfExists(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    accountId: AccountId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<{readonly accountItem: AccountItem; readonly settingsItem: AccountSettingsItem} | null> {
    // Pretend like the unknown account doesn't exist. We do have an unknown account
    // record in our database as a safety precaution to make sure we don't accidentally
    // create an account with the unknown `AccountId`. But we should never return that
    // data. Instead if you want data for an unknown account call
    // `AccountModel.getUnknown()`.
    //
    // Calling `getAccount(unknownAccountId)` should always fail with a not found
    // error.
    if (accountId === unknownAccountId) return null;

    return await AccountItemAndSettingsItemContextCache.get(
        context,
        consistency,
        accountId,
        async consistency => {
            const items = await arrayFromAsyncIterable(
                AccountsTable.query(context, {
                    limit: 3,
                    partitionKey: {
                        partitionType: "Account",
                        accountId,
                    },
                    startSortKey: {sortRangeType: "Attributes"},
                    endSortKey: {sortRangeType: "Settings"},
                    consistency,
                }),
            );

            const attributesItem = findMapIterable(items, item =>
                item.sortRangeType === "Attributes" ? item : undefined,
            );
            if (!attributesItem) return null;

            const avatarItem = findMapIterable(items, item =>
                item.sortRangeType === "Avatar" ? item : undefined,
            );

            const settingsItem = findMapIterable(items, item =>
                item.sortRangeType === "Settings" ? item : undefined,
            );

            return {
                accountItem: {
                    avatar: avatarItem ?? null,
                    ...attributesItem,
                },
                settingsItem: settingsItem ?? getInitialAccountSettingsItem(accountId),
            };
        },
    );
}

export async function getAccountItemAndSettingsItem(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    accountId: AccountId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<{readonly accountItem: AccountItem; readonly settingsItem: AccountSettingsItem}> {
    const item = await getAccountItemAndSettingsItemIfExists(context, accountId, options);
    if (!item) throw new NotFoundError("Account not found");
    return item;
}
