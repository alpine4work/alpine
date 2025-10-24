import {TestDocumentCommentThread} from "~/server/documents/test_helpers/test_document_comment_thread.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {InboxDocumentNewCommentThreadsEntryModel} from "~/shared/notifications/inbox_model.js";

export function expectDocumentNewCommentThreadsEntryModel({
    session,
    isDocumentPrivate = false,
    bucketGeneration,
    isArchived = false,
    loudNotificationCount = 0,
    commentThreadCount = 1,
    commentThreadAuthorCount = 1,
    firstComment,
    otherCommentThreadAuthor = null,
}: {
    session: TestSpaceSession;
    isDocumentPrivate?: boolean;
    bucketGeneration: number;
    isArchived?: boolean;
    loudNotificationCount?: number;
    commentThreadCount?: number;
    commentThreadAuthorCount?: number;
    firstComment: {
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
            ? {isPrivate: true, documentId: firstComment.commentThread.document.id}
            : {
                  isPrivate: false,
                  document: expect.objectContaining({id: firstComment.commentThread.document.id}),
              },
        bucketGeneration,
        loudNotificationCount,
        commentThreadCount,
        commentThreadAuthorCount,
        firstComment: {
            author: expect.objectContaining({id: firstComment.commentThread.firstCommentAuthor.id}),
            createdTime: firstComment.commentThread.createdTime,
            contentTextSnippet: firstComment.contentTextSnippet,
        },
        otherCommentThreadAuthor:
            otherCommentThreadAuthor instanceof TestSession
                ? expect.objectContaining({id: otherCommentThreadAuthor.account.id})
                : otherCommentThreadAuthor instanceof TestAccount
                ? expect.objectContaining({id: otherCommentThreadAuthor.id})
                : otherCommentThreadAuthor,
    });
}
