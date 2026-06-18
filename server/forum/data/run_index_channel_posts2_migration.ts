import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {ChannelPosts2Index} from "~/server/forum/data/internal/forum_realtime_table.js";
import {assert} from "~/shared/helpers/control/assert.js";

export async function runIndexChannelPosts2Migration(
    context: DynamoContext,
    {segmentIndex, totalSegmentCount}: {segmentIndex: number; totalSegmentCount: number},
) {
    assert(context.tracer.getRoot().serviceName === "MigrationService");

    await ChannelPosts2Index.runMigration(context, {
        segmentIndex,
        totalSegmentCount,
    });
}
