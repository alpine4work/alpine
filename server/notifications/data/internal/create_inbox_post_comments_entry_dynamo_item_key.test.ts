import {InboxTable} from "~/server/notifications/data/internal/inbox_table.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, PostId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {createInboxPostCommentsEntryDynamoItemKey} from "~/shared/notifications/create_inbox_post_comments_entry_dynamo_item_key.js";

// This test lives in `server/notifications/data` instead of `shared/notifications`
// because we need to reference server code in the test.
test("client can produce the same item key as the server", () => {
    const spaceId = generateId<SpaceId>();
    const accountId = generateId<AccountId>();
    const postId = generateId<PostId>();

    expect(createInboxPostCommentsEntryDynamoItemKey(spaceId, accountId, postId)).toEqual(
        InboxTable.serializeOpaqueItemKey({
            partitionType: "Inbox",
            sortRangeType: "PostCommentsEntry",
            spaceId,
            accountId,
            postId,
        }),
    );
});
