import {ServerSystemActionContext} from "~/server/context/server_action_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeChannelItemAccess} from "~/server/forum/data/internal/authorize_channel_item_access.js";
import {ForumTable} from "~/server/forum/data/internal/forum_table.js";
import {getChannelPreviewItemForAuthorization} from "~/server/forum/data/internal/get_channel_preview_item_for_authorization.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {mapAsyncIterableIterator} from "~/shared/helpers/iterable/map_async_iterable_iterator.js";
import {AccountId, ChannelId} from "~/shared/id/types/id_types.js";

/**
 * Get all subscribers to the channel.
 *
 * May return accounts that don't have access to the channel anymore. If you're
 * going to send a notification, you should filter down this list to accounts that
 * still have channel access.
 *
 * For example, if you're added to the private channel then you subscribe to the
 * private chanel (we add a `Channel#Subscription` item) then you're removed from
 * the private channel we don't remove your `Channel#Subscription` item. You'll be
 * returned from this function and we need to make sure you don't get a
 * notification during notification event processing.
 */
export async function getChannelNotificationSubscribers(
    context: ServerSystemActionContext,
    channelId: ChannelId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
) {
    // Double check that this is a system actor. Currently the list of channel
    // subscribers is private. We don't want there to be social pressure to never
    // unsubscribe from a channel because people can see whether or not you're
    // subscribed (like there is in Slack, leaving a channel shows everyone a "Caleb
    // left the channel" message).
    context.actor.authorizeSystem();

    const channelItem = await getChannelPreviewItemForAuthorization(context, channelId, {
        consistency,
    });

    await authorizeChannelItemAccess(context, channelItem, "View");

    const accountIds = await arrayFromAsyncIterable(
        mapAsyncIterableIterator(
            ForumTable.query(context, {
                consistency,
                limit: "All",
                partitionKey: {partitionType: "Channel", channelId},
                startSortKey: {
                    sortRangeType: "Subscription",
                    accountId: DynamoKeyAttributeSchema.id.getMinValue<AccountId>(),
                },
                endSortKey: {
                    sortRangeType: "Subscription",
                    accountId: DynamoKeyAttributeSchema.id.getMaxValue<AccountId>(),
                },
            }),
            item => item.accountId,
        ),
    );

    return accountIds;
}
