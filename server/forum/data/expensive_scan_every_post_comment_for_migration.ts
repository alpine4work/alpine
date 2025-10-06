import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {ForumRealtimeTable} from "~/server/forum/data/internal/forum_realtime_table.js";
import {ForumTable} from "~/server/forum/data/internal/forum_table.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {PostId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Scan every post comment in our database. Use when migrating data.
 *
 * Separate from `expensiveScanEveryChannelAndPostForMigration()` since post
 * comments and posts/channels are backed by different underlying tables.
 */
export async function* expensiveScanEveryPostCommentForMigration(
    context: DynamoContext,
    {segmentIndex, totalSegmentCount}: {segmentIndex: number; totalSegmentCount: number},
): AsyncIterableIterator<{
    getSpaceId: () => Promise<SpaceId>;
    postId: PostId;
    commentIndex: number;
}> {
    assert(context.tracer.getRoot().serviceName === "MigrationService");

    const spaceIdByPostId = new Map<PostId, Promise<SpaceId>>();

    for await (const item of ForumTable.expensiveScan(context, {
        segmentIndex,
        totalSegmentCount,
        filter: [{partitionType: "Post", sortRangeType: "Comments"}],
    })) {
        if (item.partitionType === "Post" && item.sortRangeType === "Comments") {
            yield {
                getSpaceId: () =>
                    getOrSetDefaultMapValue(spaceIdByPostId, item.postId, async () => {
                        const postItem = await ForumRealtimeTable.getPartialItem(
                            context,
                            {
                                partitionType: "Post",
                                sortRangeType: "Attributes",
                                postId: item.postId,
                            },
                            {attributes: ["spaceId"]},
                        );
                        return postItem.spaceId;
                    }),
                postId: item.postId,
                commentIndex: item.commentIndex,
            };
        }
    }
}
