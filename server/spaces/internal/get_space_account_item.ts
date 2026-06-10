import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {createSpaceAccountNotFoundError} from "~/server/spaces/get_account.js";
import {SpaceAccountItem, SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

export const SpaceAccountItemContextCache = new DynamoContextCache<
    `${SpaceId}:${AccountId}`,
    SpaceAccountItem | null
>({
    // Allow sharing this cache because the results do not depend on who the actor is.
    whenActorChanges: "DangerouslyShare",
});

/**
 * Internal function to get a `SpaceAccountItem`. Caches the result in a context
 * cache.
 *
 * Does not authorize the actor has access! You must do that yourself.
 */
export async function getSpaceAccountItemIfExists(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    spaceId: SpaceId,
    accountId: AccountId,
    {
        consistency = "Eventual",
        allowsEventualReadConsistency = false,
    }: {
        consistency?: DynamoCacheReadConsistency;
        allowsEventualReadConsistency?: boolean;
    } = {},
): Promise<SpaceAccountItem | null> {
    return await SpaceAccountItemContextCache.get(
        context,
        allowsEventualReadConsistency ? {consistency, allowsEventualReadConsistency} : consistency,
        `${spaceId}:${accountId}`,
        consistency =>
            SpacesTable.getItemIfExists(
                context,
                {partitionType: "Space", sortRangeType: "Account", spaceId, accountId},
                {consistency, allowsEventualReadConsistency},
            ),
    );
}

/**
 * Internal function to get a `SpaceAccountItem`. Caches the result in a context
 * cache.
 *
 * Does not authorize the actor has access! You must do that yourself.
 *
 * Throws an error if the `SpaceAccountItem` does not exist.
 */
export async function getSpaceAccountItem(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    spaceId: SpaceId,
    accountId: AccountId,
    options?: {
        consistency?: DynamoCacheReadConsistency;
        allowsEventualReadConsistency?: boolean;
    },
): Promise<SpaceAccountItem> {
    const spaceAccountItem = await getSpaceAccountItemIfExists(
        context,
        spaceId,
        accountId,
        options,
    );
    if (!spaceAccountItem) throw createSpaceAccountNotFoundError();
    return spaceAccountItem;
}

/**
 * Internal function to get a `SpaceAccountItem`. Caches the result in a context
 * cache.
 *
 * Does not authorize the actor has access! You must do that yourself.
 *
 * Throws an error if the `SpaceAccountItem` does not exist.
 */
export async function getSpaceAccountItemWithEventualThenStrongConsistency(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    spaceId: SpaceId,
    accountId: AccountId,
): Promise<SpaceAccountItem> {
    const spaceAccountItem = await getSpaceAccountItemIfExists(context, spaceId, accountId, {
        consistency: "Eventual",
    });
    if (spaceAccountItem) return spaceAccountItem;

    return await getSpaceAccountItem(context, spaceId, accountId, {
        consistency: "StrongWithinCache",
    });
}
