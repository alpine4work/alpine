import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {ForumRealtimeTable} from "~/server/forum/data/internal/forum_realtime_table.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {ChannelId, PostId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Scan every channel and post in our database. Use when migrating data.
 */
export async function* expensiveScanEveryChannelAndPostForMigration(
    context: DynamoContext,
    {segmentIndex, totalSegmentCount}: {segmentIndex: number; totalSegmentCount: number},
): AsyncIterableIterator<
    | {type: "Channel"; spaceId: SpaceId; channelId: ChannelId}
    | {type: "Post"; spaceId: SpaceId; postId: PostId}
> {
    assert(context.tracer.getRoot().serviceName === "MigrationService");

    for await (const item of ForumRealtimeTable.expensiveScan(context, {
        segmentIndex,
        totalSegmentCount,
        filter: [
            {partitionType: "Channel", sortRangeType: "Attributes"},
            {partitionType: "Post", sortRangeType: "Attributes"},
        ],
    })) {
        if (item.partitionType === "Channel") {
            if (item.sortRangeType !== "Attributes") continue;
            yield {type: "Channel", spaceId: item.spaceId, channelId: item.channelId};
        } else if (item.partitionType === "Post") {
            if (item.sortRangeType !== "Attributes") continue;
            yield {type: "Post", spaceId: item.spaceId, postId: item.postId};
        }
    }
}
