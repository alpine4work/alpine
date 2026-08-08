import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeChannelItemAccess} from "~/server/forum/data/internal/authorize_channel_item_access.js";
import {ForumRealtimeTable} from "~/server/forum/data/internal/forum_realtime_table.js";
import {ChannelPreviewItemAuthorizationCache} from "~/server/forum/data/internal/get_channel_preview_item_for_authorization.js";
import {maxChannelContributionCount} from "~/server/forum/data/max_channel_contribution_count.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {DynamoItemKey} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {DataLossError} from "~/shared/error/error.open_source.js";
import {createChannelNotFoundError} from "~/shared/forum/forum_error_messages.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.open_source.js";
import {AccountId, ChannelId} from "~/shared/id/types/id_types.open_source.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

/**
 * Get an array of all the accounts which have contributed to this channel. We
 * consider an account a contributor if they've created the channel, posted in the
 * channel, or commented in the channel. The array is sorted with the top
 * contributors first. If multiple accounts have contributed the same amount then
 * we put the account who contributed first, first in the list.
 */
export async function getChannelContributors(
    context: ServerActionContext,
    channelId: ChannelId,
    {limit, consistency = "Eventual"}: {limit: number; consistency?: DynamoReadConsistency},
): Promise<Array<AccountModel>> {
    const promise = (async () => {
        const items = await arrayFromAsyncIterable(
            ForumRealtimeTable.query(context, {
                partitionKey: {partitionType: "Channel", channelId},
                endSortKey: {sortRangeType: "Contributors"},
                limit: "All",
                consistency,
            }),
        );
        if (items.length === 0) return null;

        const firstItem = items[0]!;
        const secondItem = items[1];

        if (firstItem.sortRangeType !== "Attributes") {
            throw new DataLossError("Expected the first query item to be the channel item");
        }

        if (secondItem && secondItem.sortRangeType !== "Contributors") {
            throw new DataLossError("Expected the second query item to be the contributors item");
        }

        return {channelItem: firstItem, contributorsItem: secondItem};
    })();

    const cachedPromise = promise.then(async result => (result ? result.channelItem : null));

    // Make sure errors thrown by this promise aren't treated as uncaught exceptions.
    // We catch them below when we await `getPromise`.
    cachedPromise.catch(() => {});

    // If we're loading the channel, we can use the channel item in our
    // `ChannelPreviewModel` cache to avoid extra fetches.
    ChannelPreviewItemAuthorizationCache.set(context, consistency, channelId, cachedPromise);

    return await (async () => {
        const result = await promise;
        if (!result) throw createChannelNotFoundError(channelId);

        await authorizeChannelItemAccess(context, result.channelItem, "View");

        const accountIdsByContributionCount = new DefaultMap<number, Array<AccountId>>(() => []);

        for (const [accountId, contributionCount] of result.contributorsItem
            ?.contributionCountByAccountId ?? emptyArray) {
            accountIdsByContributionCount.getOrSetDefault(contributionCount).push(accountId);
        }

        // Top contributor accounts are sorted by:
        //
        // 1. Who has the highest contribution count up to `maxChannelTopContributorCount`
        // 2. Earliest contribution time
        const contributorPromises: Array<Promise<AccountModel>> = [];

        outer: for (
            let contributionCount = maxChannelContributionCount;
            contributionCount >= 1;
            contributionCount--
        ) {
            const accountIds = accountIdsByContributionCount.get(contributionCount) ?? emptyArray;

            for (const accountId of accountIds) {
                contributorPromises.push(
                    getAccount(context, result.channelItem.spaceId, accountId),
                );

                if (contributorPromises.length >= limit) break outer;
            }
        }

        return await runAllPromises(contributorPromises);
    })();
}

export function getChannelContributorsKey(channelId: ChannelId): DynamoItemKey {
    return ForumRealtimeTable.serializeOpaqueItemKey({
        partitionType: "Channel",
        sortRangeType: "Contributors",
        channelId,
    });
}
