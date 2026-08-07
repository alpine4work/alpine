import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {authorizeChannelAccess} from "~/server/forum/data/authorize_channel_access.js";
import {
    ForumRealtimeTable,
    allowedChannelSortRangeTypesForGetChannelRealtimeEvent,
    allowedPostSortRangeTypesForGetPostRealtimeEvent,
} from "~/server/forum/data/internal/forum_realtime_table.js";
import {getPostItemForAuthorization} from "~/server/forum/data/internal/get_post_item_for_authorization.js";
import {RynamoEventStub} from "~/shared/dynamo/rynamo_types.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {RynamoChannelOrPostEvent} from "~/shared/forum/channel_realtime_protocol.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {ChannelId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Converts realtime event stubs into full realtime event objects.
 */
export async function getChannelRealtimeEvent(
    context: ServerSessionActionContext,
    channelId: ChannelId,
    events: ReadonlyArray<RynamoEventStub>,
): Promise<ReadonlyArray<RynamoChannelOrPostEvent>> {
    const [, actualEvents] = await runAllPromises([
        // Authorizing in parallel means we'll batch the channel read in
        // `authorizeChannelAccess()` with any DynamoDB reads from the
        // `ForumRealtimeTable.getRealtimeEvent()` call.
        authorizeChannelAccess(context, channelId, "View"),

        ForumRealtimeTable.getRealtimeEvent(
            context,
            await runAllPromises(
                events.map(async eventStub => {
                    const itemKey = ForumRealtimeTable.deserializeOpaqueItemKey(eventStub.item.key);

                    // Check that the `itemKey` we're reading is for the channel we've authorized.
                    if (
                        itemKey.partitionType === "Channel" &&
                        itemKey.channelId === channelId &&
                        allowedChannelSortRangeTypesForGetChannelRealtimeEvent[
                            itemKey.sortRangeType
                        ]
                    ) {
                        return {...eventStub, itemKey};
                    }

                    // Check that the `itemKey` we're reading is for a post in the channel we've
                    // authorized.
                    if (
                        itemKey.partitionType === "Post" &&
                        allowedPostSortRangeTypesForGetPostRealtimeEvent[itemKey.sortRangeType]
                    ) {
                        const postItem = await getPostItemForAuthorization(context, itemKey.postId);
                        if (postItem.channelId === channelId) {
                            return {...eventStub, itemKey};
                        }
                    }

                    throw new PermissionDeniedError(
                        "Can\u2019t get realtime event for item that\u2019s not associated with the designated channel",
                    );
                }),
            ),
        ),
    ]);

    return actualEvents as ReadonlyArray<RynamoChannelOrPostEvent>;
}
