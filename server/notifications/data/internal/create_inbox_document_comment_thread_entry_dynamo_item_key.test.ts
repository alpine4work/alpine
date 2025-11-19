import {InboxTable} from "~/server/notifications/data/internal/inbox_table.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    DocumentCommentThreadId,
    DocumentId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
import {createInboxDocumentCommentThreadEntryDynamoItemKey} from "~/shared/notifications/create_inbox_document_comment_thread_entry_dynamo_item_key.js";

// This test lives in `server/notifications/data` instead of
// `shared/notifications` because we need to reference server code in the test.
test("client can produce the same item key as the server", () => {
    const spaceId = generateId<SpaceId>();
    const accountId = generateId<AccountId>();
    const documentId = generateId<DocumentId>();
    const commentThreadId = generateId<DocumentCommentThreadId>();

    expect(
        createInboxDocumentCommentThreadEntryDynamoItemKey(
            spaceId,
            accountId,
            documentId,
            commentThreadId,
        ),
    ).toEqual(
        InboxTable.serializeOpaqueItemKey({
            partitionType: "Inbox",
            sortRangeType: "DocumentCommentThreadEntry",
            spaceId,
            accountId,
            documentId,
            commentThreadId,
        }),
    );
});
