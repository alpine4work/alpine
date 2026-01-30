import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {authorizeChannelAccess} from "~/server/forum/data/authorize_channel_access.js";
import {
    ForumRealtimeTable,
    allowedChannelSortRangeTypesForGetChannelRealtimeEvent,
    allowedPostSortRangeTypesForGetPostRealtimeEvent,
} from "~/server/forum/data/internal/forum_realtime_table.js";
import {getPostItemForAuthorization} from "~/server/forum/data/internal/get_post_item_for_authorization.js";
import {DynamoGeneralRealtimeEventStub} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {DynamoGeneralRealtimeChannelOrPostEvent} from "~/shared/forum/channel_realtime_protocol.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {ChannelId} from "~/shared/id/types/id_types.js";

/**
 * Converts realtime event stubs into full realtime event objects.
 */
export async function getChannelRealtimeEvent(
    context: ServerSessionActionContext,
    channelId: ChannelId,
    eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEventStub>,
): Promise<ReadonlyArray<DynamoGeneralRealtimeChannelOrPostEvent>> {
    const [, actualEventTransaction] = await runAllPromises([
        // Authorizing in parallel means we'll batch the channel read in
        // `authorizeChannelAccess()` with any DynamoDB reads from the
        // `ForumRealtimeTable.getRealtimeEvent()` call.
        authorizeChannelAccess(context, channelId, "View"),

        ForumRealtimeTable.getRealtimeEvent(
            context,
            await runAllPromises(
                eventTransaction.map(async eventStub => {
                    const itemKey = ForumRealtimeTable.deserializeOpaqueItemKey(eventStub.item.key);

                    // Check that the `itemKey` we're reading is for the channel we've
                    // authorized.
                    if (
                        itemKey.partitionType === "Channel" &&
                        itemKey.channelId === channelId &&
                        allowedChannelSortRangeTypesForGetChannelRealtimeEvent[
                            itemKey.sortRangeType
                        ]
                    ) {
                        return {...eventStub, itemKey};
                    }

                    // Check that the `itemKey` we're reading is for a post in the channel
                    // we've authorized.
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

    return actualEventTransaction as ReadonlyArray<DynamoGeneralRealtimeChannelOrPostEvent>;
}
