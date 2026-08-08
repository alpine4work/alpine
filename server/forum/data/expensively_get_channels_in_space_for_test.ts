import {intoAccessPolicyModel} from "~/server/access/into_access_policy_model.js";
import {ServerMinimalActionContext} from "~/server/context/server_minimal_action_context.js";
import {ForumRealtimeTable} from "~/server/forum/data/internal/forum_realtime_table.js";
import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.open_source.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * We don't have an index on our spaceId in our forum tables. Instead of adding an
 * index for unit tests only, we provide this function to let tests enumerate all
 * channels in a space.
 *
 * This is only available in test environments.
 */
export async function expensivelyGetChannelsInSpaceForTest(
    context: ServerMinimalActionContext,
    spaceId: SpaceId,
) {
    assert(process.env.NODE_ENV === "test");

    const channels = await parallelMapAsyncIterableToArray(
        ForumRealtimeTable.expensiveScan(context, {
            filter: [{partitionType: "Channel", sortRangeType: "Attributes"}],
        }),
        async item => {
            if (item.partitionType !== "Channel") return null;

            if (item.sortRangeType !== "Attributes") return null;
            if (item.spaceId !== spaceId) return null;

            return new ChannelPreviewModel({
                id: item.channelId,
                spaceId: item.spaceId,
                name: item.name,
                accessPolicy: await intoAccessPolicyModel(context, item.accessPolicy),
                version: item.updateLockVersion || 0,
                createdTime: item.createdTime,
            });
        },
    );

    return channels.filter(isNonNullable);
}
