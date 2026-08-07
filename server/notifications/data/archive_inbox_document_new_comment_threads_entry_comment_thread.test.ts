import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {archiveInboxDocumentNewCommentThreadsEntryCommentThread} from "~/server/notifications/data/archive_inbox_document_new_comment_threads_entry_comment_thread.js";
import {
    updateInboxEntryAfterExecuteTransactionTestCheckpoint,
    updateInboxEntryBeforeExecuteTransactionTestCheckpoint,
} from "~/server/notifications/data/internal/update_inbox_entry.js";
import {observeInbox} from "~/server/notifications/data/observe_inbox.js";
import {processNotificationEvent} from "~/server/notifications/data/process/process_notification_event.js";
import {expectInboxDocumentCommentThreadEntryModel} from "~/server/notifications/data/test_helpers/expect_inbox_document_comment_thread_entry_model.js";
import {expectInboxDocumentNewCommentThreadsEntryModel} from "~/server/notifications/data/test_helpers/expect_inbox_document_new_comment_threads_entry_model.js";
import {testGetInboxEntries} from "~/server/notifications/data/test_helpers/test_get_inbox_entries.js";
import {unarchiveInboxDocumentNewCommentThreadsEntryCommentThread} from "~/server/notifications/data/unarchive_inbox_document_new_comment_threads_entry_comment_thread.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {MessageContentProsemirrorSchema as schema} from "~/shared/content/message_content_schema.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {cast} from "~/shared/helpers/control/cast.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";

const context = createTestContext({
    processJob: async (context, job, jobStartTime, span) => {
        if (job.type === "NotificationEvent") {
            await processNotificationEvent(context, job.event, span);
        } else {
            // Noop for other jobs...
        }
    },
});

test("can archive a single comment thread in a new comment threads entry with one comment thread", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session2, {access: "Public"});
    const {range} = await document.type(session2, "target");

    const commentThread = await document.createCommentThread(session1, range, "test1");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([]);

    expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread,
            latestComment: {
                comment: commentThread,
                contentTextSnippet: "test1",
            },
            isFromNewCommentThread: true,
        }),
    ]);
});

test("can archive single comment thread in a new comment threads entry with three comment threads", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session2, {access: "Public"});
    const {range} = await document.type(session2, "target");

    const commentThread1 = await document.createCommentThread(session1, range, "test1");
    const commentThread2 = await document.createCommentThread(session1, range, "test2");
    const commentThread3 = await document.createCommentThread(session1, range, "test3");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread1.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxDocumentNewCommentThreadsEntryModel({
            session: session2,
            bucketGeneration: 0,
            commentThreads: [commentThread2, commentThread3],
            firstCommentThread: {commentThread: commentThread2, contentTextSnippet: "test2"},
        }),
    ]);
});

test("can archive two comment threads in a new comment threads entry with three comment threads", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session2, {access: "Public"});
    const {range} = await document.type(session2, "target");

    const commentThread1 = await document.createCommentThread(session1, range, "test1");
    const commentThread2 = await document.createCommentThread(session1, range, "test2");
    const commentThread3 = await document.createCommentThread(session1, range, "test3");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread1.id,
    });

    await archiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread3.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxDocumentNewCommentThreadsEntryModel({
            session: session2,
            bucketGeneration: 0,
            firstCommentThread: {commentThread: commentThread2, contentTextSnippet: "test2"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread: commentThread3,
            latestComment: {
                comment: commentThread3,
                contentTextSnippet: "test3",
            },
            isFromNewCommentThread: true,
        }),
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread: commentThread1,
            latestComment: {
                comment: commentThread1,
                contentTextSnippet: "test1",
            },
            isFromNewCommentThread: true,
        }),
    ]);
});

test("can archive three comment threads in a new comment threads entry with three comment threads", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session2, {access: "Public"});
    const {range} = await document.type(session2, "target");

    const commentThread1 = await document.createCommentThread(session1, range, "test1");
    const commentThread2 = await document.createCommentThread(session1, range, "test2");
    const commentThread3 = await document.createCommentThread(session1, range, "test3");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread1.id,
    });

    await archiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread3.id,
    });

    await archiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread2.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([]);

    expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread: commentThread3,
            latestComment: {
                comment: commentThread3,
                contentTextSnippet: "test3",
            },
            isFromNewCommentThread: true,
        }),
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread: commentThread2,
            latestComment: {
                comment: commentThread2,
                contentTextSnippet: "test2",
            },
            isFromNewCommentThread: true,
        }),
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread: commentThread1,
            latestComment: {
                comment: commentThread1,
                contentTextSnippet: "test1",
            },
            isFromNewCommentThread: true,
        }),
    ]);
});

test("archiving single comment thread is idempotent when all comment threads are unarchived", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session2, {access: "Public"});
    const {range} = await document.type(session2, "target");

    const commentThread1 = await document.createCommentThread(session1, range, "test1");
    const commentThread2 = await document.createCommentThread(session1, range, "test2");
    const commentThread3 = await document.createCommentThread(session1, range, "test3");

    await ProcessContextModule.waitForTestTasks();

    await runAllPromises([
        archiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
            spaceId: space.id,
            documentId: document.id,
            bucketGeneration: 0,
            commentThreadId: commentThread2.id,
        }),
        archiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
            spaceId: space.id,
            documentId: document.id,
            bucketGeneration: 0,
            commentThreadId: commentThread2.id,
        }),
        archiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
            spaceId: space.id,
            documentId: document.id,
            bucketGeneration: 0,
            commentThreadId: commentThread2.id,
        }),
    ]);

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxDocumentNewCommentThreadsEntryModel({
            session: session2,
            bucketGeneration: 0,
            commentThreads: [commentThread1, commentThread3],
            firstCommentThread: {commentThread: commentThread1, contentTextSnippet: "test1"},
        }),
    ]);
});

test("archiving single comment thread is idempotent when all but one comment threads are archived", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session2, {access: "Public"});
    const {range} = await document.type(session2, "target");

    const commentThread1 = await document.createCommentThread(session1, range, "test1");
    const commentThread2 = await document.createCommentThread(session1, range, "test2");
    const commentThread3 = await document.createCommentThread(session1, range, "test3");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread1.id,
    });

    await archiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread3.id,
    });

    await runAllPromises([
        archiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
            spaceId: space.id,
            documentId: document.id,
            bucketGeneration: 0,
            commentThreadId: commentThread2.id,
        }),
        archiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
            spaceId: space.id,
            documentId: document.id,
            bucketGeneration: 0,
            commentThreadId: commentThread2.id,
        }),
        archiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
            spaceId: space.id,
            documentId: document.id,
            bucketGeneration: 0,
            commentThreadId: commentThread2.id,
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread: commentThread3,
            latestComment: {
                comment: commentThread3,
                contentTextSnippet: "test3",
            },
            isFromNewCommentThread: true,
        }),
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread: commentThread2,
            latestComment: {
                comment: commentThread2,
                contentTextSnippet: "test2",
            },
            isFromNewCommentThread: true,
        }),
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread: commentThread1,
            latestComment: {
                comment: commentThread1,
                contentTextSnippet: "test1",
            },
            isFromNewCommentThread: true,
        }),
    ]);
});

test("can\u2019t archive individual comment thread without access to space", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session2, {access: "Public"});
    const {range} = await document.type(session2, "target");

    await document.createCommentThread(session1, range, "test1");
    const commentThread2 = await document.createCommentThread(session1, range, "test2");
    await document.createCommentThread(session1, range, "test3");

    await ProcessContextModule.waitForTestTasks();

    await space.removeAccount(session2.account);

    await expect(
        archiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
            spaceId: space.id,
            documentId: document.id,
            bucketGeneration: 0,
            commentThreadId: commentThread2.id,
        }),
    ).rejects.toThrow("Account doesn\u2019t have access to space");
});

test("noops when archiving individual comment thread in entry that doesn\u2019t exist", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await archiveInboxDocumentNewCommentThreadsEntryCommentThread(session.action(), {
        spaceId: space.id,
        documentId: generateId(),
        bucketGeneration: 0,
        commentThreadId: generateId(),
    });

    expect(await testGetInboxEntries(session)).toEqual([]);

    expect(await testGetInboxEntries(session, {filter: "Done"})).toEqual([]);
});

test("can\u2019t archive individual comment thread which doesn\u2019t exist in inbox entry", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session2, {access: "Public"});
    const {range} = await document.type(session2, "target");

    const commentThread1 = await document.createCommentThread(session1, range, "test1");
    const commentThread2 = await document.createCommentThread(session1, range, "test2");
    const commentThread3 = await document.createCommentThread(session1, range, "test3");

    await ProcessContextModule.waitForTestTasks();

    await observeInbox(session2.action(), {spaceId: space.id});

    const commentThread4 = await document.createCommentThread(session1, range, "test4");

    await ProcessContextModule.waitForTestTasks();

    await expect(
        archiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
            spaceId: space.id,
            documentId: document.id,
            bucketGeneration: 0,
            commentThreadId: commentThread4.id,
        }),
    ).rejects.toThrow("Comment thread not found in new comment threads inbox entry");

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxDocumentNewCommentThreadsEntryModel({
            session: session2,
            bucketGeneration: 2,
            firstCommentThread: {commentThread: commentThread4, contentTextSnippet: "test4"},
        }),
        expectInboxDocumentNewCommentThreadsEntryModel({
            session: session2,
            bucketGeneration: 0,
            commentThreads: [commentThread1, commentThread2, commentThread3],
            firstCommentThread: {commentThread: commentThread1, contentTextSnippet: "test1"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);
});

// TODO(12/11/2025 #flaky-tests): https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/sg5fz408r6xb5gycbshdxbybt4
// eslint-disable-next-line jest/no-disabled-tests
test.skip("race condition: archiving comment thread commits after comment thread comment creates inbox entry", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const document = await TestDocument.create(session2, {access: "Public"});
    const {range} = await document.type(session2, "target");

    const commentThread1 = await document.createCommentThread(session1, range, "test1");
    const commentThread2 = await document.createCommentThread(session1, range, "test2");
    const commentThread3 = await document.createCommentThread(session1, range, "test3");

    await ProcessContextModule.waitForTestTasks();

    const pause1Promise = updateInboxEntryBeforeExecuteTransactionTestCheckpoint.pauseForTest(
        session2.account.id,
    );

    const pause2Promise = updateInboxEntryAfterExecuteTransactionTestCheckpoint.pauseForTest(
        session3.account.id,
    );

    const archivePromise = archiveInboxDocumentNewCommentThreadsEntryCommentThread(
        session2.action(),
        {
            spaceId: space.id,
            documentId: document.id,
            bucketGeneration: 0,
            commentThreadId: commentThread2.id,
        },
    );

    const {unpause: unpause1} = await pause1Promise;

    const comment = await commentThread2.createComment(
        session3,
        schema.node("doc", {}, [
            schema.node("paragraph", {}, [
                schema.text("Hello "),
                schema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "Account",
                        accountId: session2.account.id,
                        isShort: false,
                    }),
                }),
                schema.text("!"),
            ]),
        ]),
    );

    const {unpause: unpause2} = await pause2Promise;
    unpause2();

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxDocumentCommentThreadEntryModel({
            loudNotificationCount: 1,
            session: session2,
            commentThread: commentThread2,
            latestComment: {
                comment,
                contentTextSnippet: `Hello ${session2.account.initialName}!`,
                isStickyMention: true,
            },
        }),
        expectInboxDocumentNewCommentThreadsEntryModel({
            session: session2,
            bucketGeneration: 0,
            commentThreads: [commentThread1, commentThread3],
            firstCommentThread: {commentThread: commentThread1, contentTextSnippet: "test1"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);

    unpause1();
    await archivePromise;
    await ProcessContextModule.waitForTestTasks();

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxDocumentCommentThreadEntryModel({
            loudNotificationCount: 1,
            session: session2,
            commentThread: commentThread2,
            latestComment: {
                comment,
                contentTextSnippet: `Hello ${session2.account.initialName}!`,
                isStickyMention: true,
            },
        }),
        expectInboxDocumentNewCommentThreadsEntryModel({
            session: session2,
            bucketGeneration: 0,
            commentThreads: [commentThread1, commentThread3],
            firstCommentThread: {commentThread: commentThread1, contentTextSnippet: "test1"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);
});

// TODO(12/11/2025 #flaky-tests): https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/sg5fz408r6xb5gycbshdxbybt4
// eslint-disable-next-line jest/no-disabled-tests
test.skip("race condition: archiving comment thread commits after comment thread comment creates inbox entry and we unarchive the comment thread in the new comment threads entry", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const document = await TestDocument.create(session2, {access: "Public"});
    const {range} = await document.type(session2, "target");

    const commentThread1 = await document.createCommentThread(session1, range, "test1");
    const commentThread2 = await document.createCommentThread(session1, range, "test2");
    const commentThread3 = await document.createCommentThread(session1, range, "test3");

    await ProcessContextModule.waitForTestTasks();

    const pause1Promise = updateInboxEntryBeforeExecuteTransactionTestCheckpoint.pauseForTest(
        session2.account.id,
    );

    const pause2Promise = updateInboxEntryAfterExecuteTransactionTestCheckpoint.pauseForTest(
        session3.account.id,
    );

    const archivePromise = archiveInboxDocumentNewCommentThreadsEntryCommentThread(
        session2.action(),
        {
            spaceId: space.id,
            documentId: document.id,
            bucketGeneration: 0,
            commentThreadId: commentThread2.id,
        },
    );

    const {unpause: unpause1, stopPausing: stopPausing1} = await pause1Promise;
    stopPausing1();

    const comment = await commentThread2.createComment(
        session3,
        schema.node("doc", {}, [
            schema.node("paragraph", {}, [
                schema.text("Hello "),
                schema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "Account",
                        accountId: session2.account.id,
                        isShort: false,
                    }),
                }),
                schema.text("!"),
            ]),
        ]),
    );

    const {unpause: unpause2} = await pause2Promise;
    unpause2();

    await unarchiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread2.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxDocumentCommentThreadEntryModel({
            loudNotificationCount: 1,
            session: session2,
            commentThread: commentThread2,
            latestComment: {
                comment,
                contentTextSnippet: `Hello ${session2.account.initialName}!`,
                isStickyMention: true,
            },
        }),
        expectInboxDocumentNewCommentThreadsEntryModel({
            session: session2,
            bucketGeneration: 0,
            commentThreads: [commentThread1, commentThread2, commentThread3],
            firstCommentThread: {commentThread: commentThread1, contentTextSnippet: "test1"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);

    unpause1();
    await archivePromise;
    await ProcessContextModule.waitForTestTasks();

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxDocumentCommentThreadEntryModel({
            loudNotificationCount: 1,
            session: session2,
            commentThread: commentThread2,
            latestComment: {
                comment,
                contentTextSnippet: `Hello ${session2.account.initialName}!`,
                isStickyMention: true,
            },
        }),
        expectInboxDocumentNewCommentThreadsEntryModel({
            session: session2,
            bucketGeneration: 0,
            commentThreads: [commentThread1, commentThread3],
            firstCommentThread: {commentThread: commentThread1, contentTextSnippet: "test1"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);
});
