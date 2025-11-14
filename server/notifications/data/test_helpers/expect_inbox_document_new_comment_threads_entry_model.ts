import {TestDocumentCommentThread} from "~/server/documents/test_helpers/test_document_comment_thread.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {InboxDocumentNewCommentThreadsEntryModel} from "~/shared/notifications/inbox_model.js";

export function expectInboxDocumentNewCommentThreadsEntryModel({
    session,
    isDocumentPrivate = false,
    bucketGeneration,
    isArchived = false,
    loudNotificationCount = 0,
    firstCommentThread,
    commentThreads = [[firstCommentThread.commentThread, {isArchived}]],
    otherCommentThreadAuthor = null,
}: {
    session: TestSpaceSession;
    isDocumentPrivate?: boolean;
    bucketGeneration: number;
    isArchived?: boolean;
    loudNotificationCount?: number;
    commentThreads?: ReadonlyArray<
        TestDocumentCommentThread | [TestDocumentCommentThread, {isArchived: boolean}]
    >;
    firstCommentThread: {
        commentThread: TestDocumentCommentThread;
        contentTextSnippet: string;
    };
    otherCommentThreadAuthor?: TestSession | TestAccount | null;
}) {
    const actualCommentThreads = commentThreads.map(commentThread =>
        isReadonlyArray(commentThread) ? commentThread : ([commentThread, {isArchived}] as const),
    );

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
            actualCommentThreads.map(commentThread => commentThread[0].firstCommentAuthor.id),
        ).size,
        commentThreads: new Map(
            actualCommentThreads.map(commentThread => [
                commentThread[0].id,
                {isArchived: commentThread[1].isArchived},
            ]),
        ),
        firstCommentThread: {
            author: expect.objectContaining({
                id: firstCommentThread.commentThread.firstCommentAuthor.id,
            }),
            createdTime: firstCommentThread.commentThread.createdTime,
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
