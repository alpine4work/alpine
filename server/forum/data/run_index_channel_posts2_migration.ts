import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {ChannelPostsIndex} from "~/server/forum/data/internal/forum_realtime_table.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

export async function runIndexChannelPosts2Migration(
    context: DynamoContext,
    {segmentIndex, totalSegmentCount}: {segmentIndex: number; totalSegmentCount: number},
) {
    assert(context.tracer.getRoot().serviceName === "MigrationService");

    await ChannelPostsIndex.runMigration(context, {
        segmentIndex,
        totalSegmentCount,
    });
}
