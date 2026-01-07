import {TestDocumentCommentThread} from "~/server/documents/test_helpers/test_document_comment_thread.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {InboxDocumentNewCommentThreadsEntryModel} from "~/shared/notifications/inbox_model.js";

export function expectInboxDocumentNewCommentThreadsEntryModel({
    session,
    isDocumentPrivate = false,
    bucketGeneration,
    isArchived = false,
    loudNotificationCount = 0,
    firstCommentThread,
    commentThreads = [firstCommentThread.commentThread],
    otherCommentThreadAuthor = null,
}: {
    session: TestSpaceSession;
    isDocumentPrivate?: boolean;
    bucketGeneration: number;
    isArchived?: boolean;
    loudNotificationCount?: number;
    commentThreads?: ReadonlyArray<TestDocumentCommentThread>;
    firstCommentThread: {
        commentThread: TestDocumentCommentThread;
        contentTextSnippet: string;
    };
    otherCommentThreadAuthor?: TestSession | TestAccount | null;
}) {
    return new InboxDocumentNewCommentThreadsEntryModel({
        isArchived,
        spaceId: session.space.id,
        accountId: session.account.id,
        document: isDocumentPrivate
            ? {isPrivate: true, documentId: firstCommentThread.commentThread.document.id}
            : {
                  isPrivate: false,
                  document: expect.objectContaining({
                      id: firstCommentThread.commentThread.document.id,
                  }),
              },
        bucketGeneration,
        loudNotificationCount,
        commentThreadAuthorCount: new Set(
            commentThreads.map(commentThread => commentThread.firstComment.author.id),
        ).size,
        commentThreadIds: new Set(commentThreads.map(commentThread => commentThread.id)),
        firstCommentThread: {
            author: expect.objectContaining({
                id: firstCommentThread.commentThread.firstComment.author.id,
            }),
            createdTime: firstCommentThread.commentThread.firstComment.createdTime,
            contentTextSnippet: firstCommentThread.contentTextSnippet,
        },
        otherCommentThreadAuthor:
            otherCommentThreadAuthor instanceof TestSession
                ? expect.objectContaining({id: otherCommentThreadAuthor.account.id})
                : otherCommentThreadAuthor instanceof TestAccount
                  ? expect.objectContaining({id: otherCommentThreadAuthor.id})
                  : otherCommentThreadAuthor,
    });
}
