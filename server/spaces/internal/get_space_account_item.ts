import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {SpaceAccountItem, SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

export const SpaceAccountItemContextCache = new DynamoContextCache<
    `${SpaceId}:${AccountId}`,
    SpaceAccountItem | null
>({
    // Allow sharing this cache because the results do not depend on who the
    // actor is.
    whenActorChanges: "DangerouslyShare",
});

/**
 * Internal function to get a `SpaceAccountItem`. Caches the result in a
 * context cache.
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
    return SpaceAccountItemContextCache.get(
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
