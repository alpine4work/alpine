import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {SpaceAccountItemContextCache} from "~/server/spaces/internal/get_space_account_item.js";
import {SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {mapAsyncIterableIterator} from "~/shared/helpers/iterable/map_async_iterable_iterator.js";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable.js";
import {getMaxId, getMinId} from "~/shared/id/id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Get the first 5 active `AccountId`s to be added to the space. Useful when
 * adding an account to a space to populate their suggested list.
 */
export async function dangerouslyExpensivelyGetSuggestedSpaceAccountIdsWithoutAuthorization(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    spaceId: SpaceId,
) {
    const consistency = "Eventual";

    const items = await arrayFromAsyncIterable(
        mapAsyncIterableIterator(
            SpacesTable.query(context, {
                limit: "All",
                consistency,
                partitionKey: {
                    partitionType: "Space",
                    spaceId,
                },
                startSortKey: {
                    sortRangeType: "Account",
                    accountId: getMinId<AccountId>(),
                },
                endSortKey: {
                    sortRangeType: "Account",
                    accountId: getMaxId<AccountId>(),
                },
            }),
            item => {
                // Optimization: Add item to cache so we can skip loading it later if the item
                // is requested again.
                SpaceAccountItemContextCache.set(
                    context,
                    consistency,
                    `${spaceId}:${item.accountId}`,
                    item,
                );

                return item;
            },
        ),
    );

    // Sort by added time.
    items.sort((item1, item2) => item1.addedTime.getTime() - item2.addedTime.getTime());

    return Array.from(
        sliceIterable(
            filterMapIterable(items, item => {
                if (item.state.type !== "Active") return;

                // Don't include bots in suggested accounts. We separately add affinity points
                // for bots in the welcome package.
                if (item.botId) return;

                return item.accountId;
            }),
            0,
            5,
        ),
    );
}
