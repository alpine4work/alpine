import {TestApnsContextModule} from "~/server/context/apns_context_module_base.js";
import {TestWebPushContextModule} from "~/server/context/web_push_context_module.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {archiveInboxDocumentNewCommentThreadsEntryCommentThread} from "~/server/notifications/data/archive_inbox_document_new_comment_threads_entry_comment_thread.js";
import {archiveInboxEntry} from "~/server/notifications/data/archive_inbox_entry.js";
import {notificationsInjection} from "~/server/notifications/data/notifications_injection.js";
import {observeInbox} from "~/server/notifications/data/observe_inbox.js";
import {processNotificationEvent} from "~/server/notifications/data/process/process_notification_event.js";
import {expectInboxDocumentCommentThreadEntryModel} from "~/server/notifications/data/test_helpers/expect_inbox_document_comment_thread_entry_model.js";
import {expectInboxDocumentNewCommentThreadsEntryModel} from "~/server/notifications/data/test_helpers/expect_inbox_document_new_comment_threads_entry_model.js";
import {testGetInboxEntries} from "~/server/notifications/data/test_helpers/test_get_inbox_entries.js";
import {unarchiveInboxDocumentNewCommentThreadsEntryCommentThread} from "~/server/notifications/data/unarchive_inbox_document_new_comment_threads_entry_comment_thread.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {generateId} from "~/shared/id/id.js";

const context = createTestContext({
    processJob: async (context, job, jobStartTime, span) => {
        if (job.type === "NotificationEvent") {
            await processNotificationEvent(context, job.event, span);
        } else {
            // Noop for other jobs...
        }
    },
    notificationsInjection,
});

test("can\u2019t unarchive comment thread in a fully archived new comment threads comment threads entry with one comment thread", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session2, {access: "Public"});
    const {range} = await document.type(session2, "target");

    const commentThread = await document.createCommentThread(session1, range, "test1");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxEntry(
        session2
            .action()
            .clone({apns: new TestApnsContextModule(), webPush: new TestWebPushContextModule()}),
        {
            spaceId: space.id,
            key: {
                type: "DocumentNewCommentThreads",
                documentId: document.id,
                bucketGeneration: 0,
            },
        },
    );

    await unarchiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxDocumentNewCommentThreadsEntryModel({
            isArchived: true,
            session: session2,
            bucketGeneration: 0,
            firstCommentThread: {commentThread, contentTextSnippet: "test1"},
        }),
    ]);
});

test("can\u2019t unarchive comment thread in a deleted new comment threads comment threads entry with one comment thread", async () => {
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

    await unarchiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread,
            latestComment: {comment: commentThread, contentTextSnippet: "test1"},
            isFromNewCommentThread: true,
        }),
    ]);
});

test("can unarchive comment thread in a new comment threads comment threads entry with three comment threads", async () => {
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
        commentThreadId: commentThread2.id,
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
            firstCommentThread: {commentThread: commentThread1, contentTextSnippet: "test1"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread: commentThread3,
            latestComment: {comment: commentThread3, contentTextSnippet: "test3"},
            isFromNewCommentThread: true,
        }),
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread: commentThread2,
            latestComment: {comment: commentThread2, contentTextSnippet: "test2"},
            isFromNewCommentThread: true,
        }),
    ]);

    await unarchiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread2.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxDocumentNewCommentThreadsEntryModel({
            session: session2,
            bucketGeneration: 0,
            commentThreads: [commentThread1, commentThread2],
            firstCommentThread: {commentThread: commentThread1, contentTextSnippet: "test1"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread: commentThread3,
            latestComment: {comment: commentThread3, contentTextSnippet: "test3"},
            isFromNewCommentThread: true,
        }),
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread: commentThread2,
            latestComment: {comment: commentThread2, contentTextSnippet: "test2"},
            isFromNewCommentThread: true,
        }),
    ]);
});

test("can archive comment thread again after unarchiving", async () => {
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
        commentThreadId: commentThread2.id,
    });

    await archiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread3.id,
    });

    await unarchiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread2.id,
    });

    await archiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread2.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxDocumentNewCommentThreadsEntryModel({
            session: session2,
            bucketGeneration: 0,
            firstCommentThread: {commentThread: commentThread1, contentTextSnippet: "test1"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread: commentThread3,
            latestComment: {comment: commentThread3, contentTextSnippet: "test3"},
            isFromNewCommentThread: true,
        }),
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread: commentThread2,
            latestComment: {comment: commentThread2, contentTextSnippet: "test2"},
            isFromNewCommentThread: true,
        }),
    ]);
});

test("can\u2019t unarchive comment thread in a fully archived new comment threads comment threads entry where individual comment thread hasn\u2019t been archived", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session2, {access: "Public"});
    const {range} = await document.type(session2, "target");

    const commentThread1 = await document.createCommentThread(session1, range, "test1");
    const commentThread2 = await document.createCommentThread(session1, range, "test2");
    const commentThread3 = await document.createCommentThread(session1, range, "test3");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxEntry(
        session2
            .action()
            .clone({apns: new TestApnsContextModule(), webPush: new TestWebPushContextModule()}),
        {
            spaceId: space.id,
            key: {
                type: "DocumentNewCommentThreads",
                documentId: document.id,
                bucketGeneration: 0,
            },
        },
    );

    await unarchiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread2.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxDocumentNewCommentThreadsEntryModel({
            isArchived: true,
            session: session2,
            bucketGeneration: 0,
            commentThreads: [commentThread1, commentThread2, commentThread3],
            firstCommentThread: {commentThread: commentThread1, contentTextSnippet: "test1"},
        }),
    ]);
});

test("can\u2019t unarchive comment thread in a fully archived new comment threads comment threads entry where individual comment thread has been archived", async () => {
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
        commentThreadId: commentThread2.id,
    });

    await archiveInboxEntry(
        session2
            .action()
            .clone({apns: new TestApnsContextModule(), webPush: new TestWebPushContextModule()}),
        {
            spaceId: space.id,
            key: {
                type: "DocumentNewCommentThreads",
                documentId: document.id,
                bucketGeneration: 0,
            },
        },
    );

    expect(await testGetInboxEntries(session2)).toEqual([]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxDocumentNewCommentThreadsEntryModel({
            isArchived: true,
            session: session2,
            bucketGeneration: 0,
            commentThreads: [commentThread1, commentThread3],
            firstCommentThread: {commentThread: commentThread1, contentTextSnippet: "test1"},
        }),
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread: commentThread2,
            latestComment: {comment: commentThread2, contentTextSnippet: "test2"},
            isFromNewCommentThread: true,
        }),
    ]);

    await unarchiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread2.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxDocumentNewCommentThreadsEntryModel({
            isArchived: true,
            session: session2,
            bucketGeneration: 0,
            commentThreads: [commentThread1, commentThread3],
            firstCommentThread: {commentThread: commentThread1, contentTextSnippet: "test1"},
        }),
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread: commentThread2,
            latestComment: {comment: commentThread2, contentTextSnippet: "test2"},
            isFromNewCommentThread: true,
        }),
    ]);
});

test("can unarchive two comment threads in a new comment threads comment threads entry", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session2, {access: "Public"});
    const {range} = await document.type(session2, "target");

    const commentThread1 = await document.createCommentThread(session1, range, "test1");
    const commentThread2 = await document.createCommentThread(session1, range, "test2");
    const commentThread3 = await document.createCommentThread(session1, range, "test3");

    await ProcessContextModule.waitForTestTasks();
    const commentThread4 = await document.createCommentThread(session1, range, "test4");

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
        commentThreadId: commentThread2.id,
    });

    await archiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread4.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxDocumentNewCommentThreadsEntryModel({
            session: session2,
            bucketGeneration: 0,
            commentThreads: [commentThread3],
            firstCommentThread: {commentThread: commentThread3, contentTextSnippet: "test3"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread: commentThread4,
            latestComment: {comment: commentThread4, contentTextSnippet: "test4"},
            isFromNewCommentThread: true,
        }),
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread: commentThread2,
            latestComment: {comment: commentThread2, contentTextSnippet: "test2"},
            isFromNewCommentThread: true,
        }),
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread: commentThread1,
            latestComment: {comment: commentThread1, contentTextSnippet: "test1"},
            isFromNewCommentThread: true,
        }),
    ]);

    await unarchiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread2.id,
    });

    await unarchiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread4.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxDocumentNewCommentThreadsEntryModel({
            session: session2,
            bucketGeneration: 0,
            commentThreads: [commentThread2, commentThread3, commentThread4],
            firstCommentThread: {commentThread: commentThread2, contentTextSnippet: "test2"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread: commentThread4,
            latestComment: {comment: commentThread4, contentTextSnippet: "test4"},
            isFromNewCommentThread: true,
        }),
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread: commentThread2,
            latestComment: {comment: commentThread2, contentTextSnippet: "test2"},
            isFromNewCommentThread: true,
        }),
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread: commentThread1,
            latestComment: {comment: commentThread1, contentTextSnippet: "test1"},
            isFromNewCommentThread: true,
        }),
    ]);
});

test("unarchiving single comment thread is idempotent", async () => {
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
        commentThreadId: commentThread2.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxDocumentNewCommentThreadsEntryModel({
            session: session2,
            bucketGeneration: 0,
            commentThreads: [commentThread1, commentThread3],
            firstCommentThread: {commentThread: commentThread1, contentTextSnippet: "test1"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread: commentThread2,
            latestComment: {comment: commentThread2, contentTextSnippet: "test2"},
            isFromNewCommentThread: true,
        }),
    ]);

    await runAllPromises([
        unarchiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
            spaceId: space.id,
            documentId: document.id,
            bucketGeneration: 0,
            commentThreadId: commentThread2.id,
        }),
        unarchiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
            spaceId: space.id,
            documentId: document.id,
            bucketGeneration: 0,
            commentThreadId: commentThread2.id,
        }),
        unarchiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
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
            commentThreads: [commentThread1, commentThread2, commentThread3],
            firstCommentThread: {commentThread: commentThread1, contentTextSnippet: "test1"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread: commentThread2,
            latestComment: {comment: commentThread2, contentTextSnippet: "test2"},
            isFromNewCommentThread: true,
        }),
    ]);
});

test("can\u2019t unarchive individual comment thread without access to space", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session2, {access: "Public"});
    const {range} = await document.type(session2, "target");

    await document.createCommentThread(session1, range, "test1");
    const commentThread2 = await document.createCommentThread(session1, range, "test2");
    await document.createCommentThread(session1, range, "test3");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread2.id,
    });

    await space.removeAccount(session2.account);

    await expect(
        unarchiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
            spaceId: space.id,
            documentId: document.id,
            bucketGeneration: 0,
            commentThreadId: commentThread2.id,
        }),
    ).rejects.toThrow("Account doesn\u2019t have access to space");
});

test("noops when unarchiving individual comment thread in entry that doesn\u2019t exist", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await unarchiveInboxDocumentNewCommentThreadsEntryCommentThread(session.action(), {
        spaceId: space.id,
        documentId: generateId(),
        bucketGeneration: 0,
        commentThreadId: generateId(),
    });

    expect(await testGetInboxEntries(session)).toEqual([]);

    expect(await testGetInboxEntries(session, {filter: "Archive"})).toEqual([]);
});

test("can\u2019t unarchive individual comment thread which doesn\u2019t exist in inbox entry", async () => {
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
        unarchiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
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

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);
});

test("archiving a comment thread, unarchiving, then reacting to the comment thread will archive the comment thread in the new comment threads comment threads entry", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session2, {access: "Public"});
    const {range} = await document.type(session2, "target");

    const commentThread1 = await document.createCommentThread(session1, range, "test1");
    await ProcessContextModule.waitForTestTasks();

    const commentThread2 = await document.createCommentThread(session1, range, "test2");
    await ProcessContextModule.waitForTestTasks();

    await archiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread1.id,
    });

    await unarchiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread1.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxDocumentNewCommentThreadsEntryModel({
            session: session2,
            bucketGeneration: 0,
            commentThreads: [commentThread1, commentThread2],
            firstCommentThread: {commentThread: commentThread1, contentTextSnippet: "test1"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread: commentThread1,
            latestComment: {comment: commentThread1, contentTextSnippet: "test1"},
            isFromNewCommentThread: true,
        }),
    ]);

    await commentThread1.firstComment.setReaction(session2);

    await ProcessContextModule.waitForTestTasks();

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxDocumentNewCommentThreadsEntryModel({
            session: session2,
            bucketGeneration: 0,
            firstCommentThread: {commentThread: commentThread2, contentTextSnippet: "test2"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread: commentThread1,
            latestComment: {comment: commentThread1, contentTextSnippet: "test1"},
            isFromNewCommentThread: true,
        }),
    ]);
});

test("archiving a comment thread, unarchiving, then commenting on the comment thread will archive the comment thread in the new comment threads comment threads entry", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session2, {access: "Public"});
    const {range} = await document.type(session2, "target");

    const commentThread1 = await document.createCommentThread(session1, range, "test1");
    await ProcessContextModule.waitForTestTasks();

    const commentThread2 = await document.createCommentThread(session1, range, "test2");
    await ProcessContextModule.waitForTestTasks();

    await archiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread1.id,
    });

    await unarchiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread1.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxDocumentNewCommentThreadsEntryModel({
            session: session2,
            bucketGeneration: 0,
            commentThreads: [commentThread1, commentThread2],
            firstCommentThread: {commentThread: commentThread1, contentTextSnippet: "test1"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread: commentThread1,
            latestComment: {comment: commentThread1, contentTextSnippet: "test1"},
            isFromNewCommentThread: true,
        }),
    ]);

    await commentThread1.createComment(session2, "test3");

    await ProcessContextModule.waitForTestTasks();

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxDocumentNewCommentThreadsEntryModel({
            session: session2,
            bucketGeneration: 0,
            firstCommentThread: {commentThread: commentThread2, contentTextSnippet: "test2"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxDocumentCommentThreadEntryModel({
            isArchived: true,
            session: session2,
            commentThread: commentThread1,
            latestComment: {comment: commentThread1, contentTextSnippet: "test1"},
            isFromNewCommentThread: true,
        }),
    ]);
});
