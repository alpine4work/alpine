import {TestDocumentCommentThread} from "~/server/documents/test_helpers/test_document_comment_thread.js";
import {TestMessage} from "~/server/messaging/test_helpers/test_messaging_room_base.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {InboxDocumentCommentThreadEntryModel} from "~/shared/notifications/inbox_model.js";

export function expectInboxDocumentCommentThreadEntryModel({
    session,
    commentThread,
    isDocumentPrivate = false,
    isArchived = false,
    loudNotificationCount = 0,
    latestComment,
    firstCommentAuthor,
    otherCommentAuthor = null,
}: {
    session: TestSpaceSession;
    commentThread: TestDocumentCommentThread;
    isDocumentPrivate?: boolean;
    isArchived?: boolean;
    loudNotificationCount?: number;
    latestComment: {
        comment: TestMessage | TestDocumentCommentThread;
        contentTextSnippet: string;
        isStickyMention?: boolean;
    };
    firstCommentAuthor: TestSession | TestAccount;
    otherCommentAuthor?: TestSession | TestAccount | null;
}) {
    return new InboxDocumentCommentThreadEntryModel({
        isArchived,
        spaceId: session.space.id,
        accountId: session.account.id,
        document: isDocumentPrivate
            ? {isPrivate: true, documentId: commentThread.document.id}
            : {
                  isPrivate: false,
                  document: expect.objectContaining({id: commentThread.document.id}),
              },
        commentThreadId: commentThread.id,
        loudNotificationCount,
        latestComment: {
            createdTime: latestComment.comment.createdTime,
            author: expect.objectContaining({
                id:
                    latestComment.comment instanceof TestDocumentCommentThread
                        ? latestComment.comment.firstCommentAuthor.id
                        : latestComment.comment.author.id,
            }),
            contentTextSnippet: latestComment.contentTextSnippet,
            isStickyMention: latestComment.isStickyMention ?? false,
        },
        firstCommentAuthor:
            firstCommentAuthor instanceof TestSession
                ? expect.objectContaining({id: firstCommentAuthor.account.id})
                : expect.objectContaining({id: firstCommentAuthor.id}),
        otherCommentAuthor:
            otherCommentAuthor instanceof TestSession
                ? expect.objectContaining({id: otherCommentAuthor.account.id})
                : otherCommentAuthor instanceof TestAccount
                ? expect.objectContaining({id: otherCommentAuthor.id})
                : otherCommentAuthor,
    });
}
