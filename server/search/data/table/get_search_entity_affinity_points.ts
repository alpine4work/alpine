import {ServerActionContext} from "~/server/context/server_action_context.js";
import {SearchEntityTable} from "~/server/search/data/table/internal/search_entity_table.js";
import {getCurrentSearchAffinityEntityPoints} from "~/server/search/data/table/search_entity_actions.js";
import {authorizeOwnSpaceAccountAccess} from "~/server/spaces/authorize_own_space_account_access.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {mapAsyncIterableIterator} from "~/shared/helpers/iterable/map_async_iterable_iterator.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {SearchAffinityEntityId} from "~/shared/search/search_entity_id.js";

/**
 * Get the affinity score and its order key in an account's favorites list if it's a favorite for
 * the accounts in the given sort range
 */
export async function getAccountSearchAffinityEntitiesInRange(
    context: ServerActionContext,
    {
        spaceId,
        accountId,
        startAccountId,
        endAccountId,
    }: {spaceId: SpaceId; accountId: AccountId; startAccountId: AccountId; endAccountId: AccountId},
) {
    await runAllPromises([
        authorizeSpaceAccess(context, spaceId),
        authorizeOwnSpaceAccountAccess(context, accountId),
    ]);

    const currentTime = Date.now();

    return mapAsyncIterableIterator(
        SearchEntityTable.query(context, {
            partitionKey: {
                partitionType: "Account",
                spaceId,
                accountId,
            },
            startSortKey: {
                sortRangeType: "SearchEntityAffinity",
                entityId: `Account:${startAccountId}` as SearchAffinityEntityId,
            },
            endSortKey: {
                sortRangeType: "SearchEntityAffinity",
                entityId: `Account:${endAccountId}` as SearchAffinityEntityId,
            },
            limit: "All",
        }),
        item => ({
            accountId: item.entityId.split(":")[1] as AccountId,
            points: getCurrentSearchAffinityEntityPoints(currentTime, item),
            favoriteOrderKey: item.favoriteOrderKey,
        }),
    );
}
