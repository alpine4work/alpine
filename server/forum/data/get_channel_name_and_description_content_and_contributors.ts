import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeChannelItemAccess} from "~/server/forum/data/internal/authorize_channel_item_access.js";
import {ForumRealtimeTable} from "~/server/forum/data/internal/forum_realtime_table.js";
import {ChannelPreviewItemAuthorizationCache} from "~/server/forum/data/internal/get_channel_preview_item_for_authorization.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {DataLossError} from "~/shared/error/error.js";
import {createChannelNotFoundError} from "~/shared/forum/forum_error_messages.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {AccountId, ChannelId} from "~/shared/id/types/id_types.js";
import {MessageContent} from "~/shared/messaging/message_content_schema.js";

/**
 * Get the channel name and description content without references. Used for
 * building a search entity which will load content references on its own in a
 * way that tracks dependencies.
 */
export async function getChannelNameAndDescriptionContentAndContributors(
    context: ServerActionContext,
    channelId: ChannelId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<{
    version: number;
    name: string;
    description: MessageContent;
    createdTime: Date;
    creatorId: AccountId | null;
    accessPolicy: AccessPolicy;
    contributionCountByAccountId: ReadonlyMap<AccountId, number>;
}> {
    const promise = (async () => {
        const items = await arrayFromAsyncIterable(
            ForumRealtimeTable.query(context, {
                partitionKey: {partitionType: "Channel", channelId},
                endSortKey: {sortRangeType: "Contributors"},
                limit: "All",
                consistency,
            }),
        );
        if (items.length === 0) throw createChannelNotFoundError(channelId);

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

    // Save the channel to our authorization cache in case we need it later.
    ChannelPreviewItemAuthorizationCache.set(
        context,
        consistency,
        channelId,
        promise.then(({channelItem}) => channelItem),
    );

    const {channelItem, contributorsItem} = await promise;
    await authorizeChannelItemAccess(context, channelItem, "View");

    return {
        version: channelItem.updateLockVersion ?? 0,
        name: channelItem.name,
        description: channelItem.description,
        createdTime: channelItem.createdTime,
        creatorId: channelItem.creatorId,
        accessPolicy: channelItem.accessPolicy,
        contributionCountByAccountId: contributorsItem?.contributionCountByAccountId ?? emptyMap,
    };
}
