import {ForumRealtimeTable} from "~/server/forum/data/internal/forum_realtime_table.js";
import {createPostDynamoItemKey} from "~/shared/forum/create_post_dynamo_item_key.js";
import {generateId} from "~/shared/id/id.js";
import {PostId} from "~/shared/id/types/id_types.js";

// This test lives in `server/forum/data` instead of `shared/forum` because we need
// to reference server code in the test.
test("client can produce the same item key as the server", () => {
    const postId = generateId<PostId>();

    expect(createPostDynamoItemKey(postId)).toEqual(
        ForumRealtimeTable.serializeOpaqueItemKey({
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId,
        }),
    );
});
