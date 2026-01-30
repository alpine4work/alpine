import {dangerouslyGetAccountIfExistsWithoutAuthorization} from "~/server/accounts/dangerously_get_account_if_exists_without_authorization.js";
import {dangerouslyGetAccountWithoutAvatarIfExistsWithoutAuthorization} from "~/server/accounts/dangerously_get_account_without_avatar_if_exists_without_authorization.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {
    createAccountModelDataWithoutAvatarFromItem,
    createAccountModelFromItem,
} from "~/server/spaces/internal/create_account_model_from_item.js";
import {getSpaceAccountItemIfExists} from "~/server/spaces/internal/get_space_account_item.js";
import {spaceAccountsCache} from "~/server/spaces/internal/space_accounts_cache.js";
import {
    SpaceAccountAvatarOverrideItem,
    SpacesTable,
} from "~/server/spaces/internal/spaces_table.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {DataLossError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";

export const SpaceAccountAvatarOverrideItemContextCache = new DynamoContextCache<
    `${SpaceId}:${AccountId}`,
    SpaceAccountAvatarOverrideItem | null
>({
    // Allow sharing this cache because the results do not depend on who the
    // actor is.
    whenActorChanges: "DangerouslyShare",
});

export async function getAccountIfExistsWithoutAuthorization(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        actor: ActorContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<AccountModel | null> {
    // If we have cached account data and we're loading with eventual consistency
    // then we can use the cached data.
    if (consistency === "Eventual") {
        // We can't use `getDataIfExistsWithoutLoading()` because it calls
        // `authorizeSpaceAccess()` which might get us stuck in a deadlock. Since
        // `authorizeSpaceAccess()` looks at the cache result of this function.
        //
        // It's safe to skip authorization for this function, though, because we
        // authorize space access above.
        const accountsCacheData =
            await spaceAccountsCache.dangerouslyGetDataIfExistsWithoutLoadingOrAuthorizing(
                context,
                spaceId,
            );
        if (accountsCacheData) {
            return accountsCacheData.accountById.get(accountId) ?? null;
        }
    }

    // Otherwise load account data and space account data. If this is the current
    // account, we may have already cached the account item.
    const [account, spaceAccountItem] = await runAllPromises([
        dangerouslyGetAccountIfExistsWithoutAuthorization(context, accountId, {consistency}),
        getSpaceAccountItemIfExists(context, spaceId, accountId, {
            consistency,
        }),
    ]);

    if (!spaceAccountItem) return null;

    if (spaceAccountItem.state.type !== "Active") {
        // NOTE(ifitzsimmons, #account-override-avatar-consistency):
        // "We know there's a potential eventual consistency race condition here where
        // Space#Account has a non-Active state but we don't find a
        // Space#AccountAvatarOverride item due to eventual consistency lag. We're not
        // fixing this since we expect it to be quite rare in practice and the impact to be
        // a pretty minor glitch (removed account appears as if they didn't have an avatar
        // set).
        const spaceAccountAvatarOverride = await SpaceAccountAvatarOverrideItemContextCache.get(
            context,
            consistency,
            `${spaceId}:${accountId}`,
            consistency =>
                SpacesTable.getItemIfExists(
                    context,
                    {
                        partitionType: "Space",
                        sortRangeType: "AccountAvatarOverride",
                        spaceId,
                        accountId,
                    },
                    {consistency},
                ),
        );

        return createAccountModelFromItem(
            {
                ...spaceAccountItem,
                accountAvatarOverride: spaceAccountAvatarOverride ?? null,
            },
            null,
        );
    } else {
        // If we have a `SpaceAccountItem` then we must also have an `AccountItem` in
        // our account table.
        if (!account) {
            throw new DataLossError("Space account item exists but account item doesn\u2019t");
        }

        return createAccountModelFromItem(
            {
                ...spaceAccountItem,
                // Active accounts should not have an avatar override
                accountAvatarOverride: null,
            },
            account,
        );
    }
}

export async function getAccountWithoutAvatarIfExistsWithoutAuthorization(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        actor: ActorContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<Omit<AccountModelData, "avatar"> | null> {
    // If we have cached account data and we're loading with eventual consistency
    // then we can use the cached data.
    if (consistency === "Eventual") {
        // We can't use `getDataIfExistsWithoutLoading()` because it calls
        // `authorizeSpaceAccess()` which might get us stuck in a deadlock. Since
        // `authorizeSpaceAccess()` looks at the cache result of this function.
        //
        // It's safe to skip authorization for this function, though, because we
        // authorize space access above.
        const accountsCacheData =
            await spaceAccountsCache.dangerouslyGetDataIfExistsWithoutLoadingOrAuthorizing(
                context,
                spaceId,
            );
        if (accountsCacheData) {
            return accountsCacheData.accountById.get(accountId)?.initialData ?? null;
        }
    }

    // Otherwise load account data and space account data. If this is the current
    // account, we may have already cached the account item.
    const [account, spaceAccountItem] = await runAllPromises([
        dangerouslyGetAccountWithoutAvatarIfExistsWithoutAuthorization(context, accountId, {
            consistency,
        }),
        getSpaceAccountItemIfExists(context, spaceId, accountId, {
            consistency,
        }),
    ]);

    if (!spaceAccountItem) return null;

    if (spaceAccountItem.state.type !== "Active") {
        return createAccountModelDataWithoutAvatarFromItem(spaceAccountItem, null);
    } else {
        // If we have a `SpaceAccountItem` then we must also have an `AccountItem` in
        // our account table.
        if (!account) {
            throw new DataLossError("Space account item exists but account item doesn\u2019t");
        }

        return createAccountModelDataWithoutAvatarFromItem(spaceAccountItem, account);
    }
}
