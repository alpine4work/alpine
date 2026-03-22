import {
    AccountItem,
    AccountItemWithoutAvatar,
    AccountsTable,
} from "~/server/accounts/internal/accounts_table.js";
import {AccountItemAndSettingsItemContextCache} from "~/server/accounts/internal/get_account_item_and_settings_item.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {
    DynamoCacheReadConsistency,
    DynamoReadConsistency,
} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {unknownAccountId} from "~/shared/accounts/account_model_without_space.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {NotFoundError} from "~/shared/error/error.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {AccountId} from "~/shared/id/types/id_types.js";

const AccountItemWithoutAvatarContextCache = new DynamoContextCache<
    AccountId,
    AccountItemWithoutAvatar | null
>({
    // Allow sharing this cache because the results do not depend on who the actor is.
    whenActorChanges: "DangerouslyShare",
});

export async function getAccountItemWithoutAvatarIfExists(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    accountId: AccountId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<AccountItemWithoutAvatar | null> {
    // Pretend like the unknown account doesn't exist. We do have an unknown account
    // record in our database as a safety precaution to make sure we don't accidentally
    // create an account with the unknown `AccountId`. But we should never return that
    // data. Instead if you want data for an unknown account call
    // `AccountModel.getUnknown()`.
    //
    // Calling `getAccount(unknownAccountId)` should always fail with a not found
    // error.
    if (accountId === unknownAccountId) return null;

    {
        // If we've already loaded the account item with its avatar then we don't need to
        // load the attributes item separately.
        const item = await AccountItemAndSettingsItemContextCache.getIfExists(
            context,
            consistency,
            accountId,
        );
        if (item) return item.accountItem;
    }

    {
        // If we've already loaded the account item with its avatar then we don't need to
        // load the attributes item separately.
        const item = await AccountItemContextCache.getIfExists(context, consistency, accountId);
        if (item) return item;
    }

    return AccountItemWithoutAvatarContextCache.get(
        context,
        consistency,
        accountId,
        consistency => {
            return AccountsTable.getItemIfExists(
                context,
                {
                    partitionType: "Account",
                    sortRangeType: "Attributes",
                    accountId,
                },
                {consistency},
            );
        },
    );
}

export async function getAccountItemWithoutAvatar(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    accountId: AccountId,
    options?: {consistency?: DynamoReadConsistency},
): Promise<AccountItemWithoutAvatar> {
    const item = await getAccountItemWithoutAvatarIfExists(context, accountId, options);
    if (!item) throw new NotFoundError("Account not found");
    return item;
}

const AccountItemContextCache = new DynamoContextCache<AccountId, AccountItem | null>({
    // Allow sharing this cache because the results do not depend on who the actor is.
    whenActorChanges: "DangerouslyShare",
});

// NOTE(ifitzsimmons, 2025-08-10): DynamoDB cost optimization: We query both
// Attributes and Avatar items in a single operation to consume only 1 RCU. Since
// avatars are <3KB, the combined size stays within DynamoDB's 4KB item limit,
// making this more cost-effective than separate requests while maintaining the
// flexibility to fetch account metadata independently.
export async function getAccountItemIfExists(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    accountId: AccountId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<AccountItem | null> {
    // Pretend like the unknown account doesn't exist. We do have an unknown account
    // record in our database as a safety precaution to make sure we don't accidentally
    // create an account with the unknown `AccountId`. But we should never return that
    // data. Instead if you want data for an unknown account call
    // `AccountModel.getUnknown()`.
    //
    // Calling `getAccount(unknownAccountId)` should always fail with a not found
    // error.
    if (accountId === unknownAccountId) return null;

    return AccountItemContextCache.get(context, consistency, accountId, async consistency => {
        const items = await arrayFromAsyncIterable(
            AccountsTable.query(context, {
                limit: 2,
                partitionKey: {
                    partitionType: "Account",
                    accountId,
                },
                startSortKey: {sortRangeType: "Attributes"},
                endSortKey: {sortRangeType: "Avatar"},
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

        return {
            avatar: avatarItem ?? null,
            ...attributesItem,
        };
    });
}

export async function getAccountItem(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    accountId: AccountId,
    options?: {consistency?: DynamoReadConsistency},
): Promise<AccountItem> {
    const item = await getAccountItemIfExists(context, accountId, options);
    if (!item) throw new NotFoundError("Account not found");
    return item;
}

export async function getAccountItemWithoutAvatarWithEventualThenStrongConsistency(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    accountId: AccountId,
): Promise<AccountItemWithoutAvatar> {
    const item = await getAccountItemWithoutAvatarIfExists(context, accountId, {
        consistency: "Eventual",
    });
    if (item) return item;

    return getAccountItemWithoutAvatar(context, accountId, {
        consistency: "Strong",
    });
}
