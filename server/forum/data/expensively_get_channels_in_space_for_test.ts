import {
    ServerSessionActionContext,
    ServerSystemActionContext,
} from "~/server/context/server_action_context.js";
import {ForumRealtimeTable} from "~/server/forum/data/internal/forum_realtime_table.js";
import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

/**
 * We don't have an index on our spaceId in our forum tables. Instead of adding
 * an index for unit tests only, we provide this function to let tests
 * enumerate all channels in a space.
 *
 * This is only available in test environments.
 */
export async function expensivelyGetChannelsInSpaceForTest(
    context: ServerSessionActionContext | ServerSystemActionContext,
    spaceId: SpaceId,
) {
    assert(process.env.NODE_ENV === "test");

    const expensiveScan = await arrayFromAsyncIterable(
        ForumRealtimeTable.expensiveScan(context, {
            filter: [{partitionType: "Channel", sortRangeType: "Attributes"}],
        }),
    );

    const channels: Array<ChannelPreviewModel> = [];
    for (const item of expensiveScan) {
        if (item.partitionType === "Channel") {
            if (item.sortRangeType !== "Attributes") continue;
            if (item.spaceId !== spaceId) continue;

            channels.push(
                new ChannelPreviewModel({
                    id: item.channelId,
                    spaceId: item.spaceId,
                    name: item.name,
                    accessPolicy: item.accessPolicy,
                    version: item.updateLockVersion || 0,
                    createdTime: item.createdTime,
                }),
            );
        }
    }

    return channels;
}
