import {TestApnsContextModule} from "~/server/apns/apns_context_module.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {archiveInboxDocumentNewCommentThreadsEntryCommentThread} from "~/server/notifications/data/archive_inbox_document_new_comment_threads_entry_comment_thread.js";
import {archiveInboxEntry} from "~/server/notifications/data/archive_inbox_entry.js";
import {observeInbox} from "~/server/notifications/data/observe_inbox.js";
import {processNotificationEvent} from "~/server/notifications/data/process/process_notification_event.js";
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
});

test("can unarchive post in a channel posts entry with one post", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session2, {access: "Public"});
    const {range} = await document.type(session2, "target");

    const commentThread = await document.createCommentThread(session1, range, "test1");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxEntry(session2.action().clone({apns: new TestApnsContextModule()}), {
        spaceId: space.id,
        key: {
            type: "DocumentNewCommentThreads",
            documentId: document.id,
            bucketGeneration: 0,
        },
    });

    await unarchiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxDocumentNewCommentThreadsEntryModel({
            session: session2,
            bucketGeneration: 0,
            firstCommentThread: {commentThread, contentTextSnippet: "test1"},
        }),
    ]);
});

test("can unarchive post in a channel posts entry with three archived posts", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session2, {access: "Public"});
    const {range} = await document.type(session2, "target");

    const commentThread1 = await document.createCommentThread(session1, range, "test1");
    const commentThread2 = await document.createCommentThread(session1, range, "test2");
    const commentThread3 = await document.createCommentThread(session1, range, "test3");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxEntry(session2.action().clone({apns: new TestApnsContextModule()}), {
        spaceId: space.id,
        key: {
            type: "DocumentNewCommentThreads",
            documentId: document.id,
            bucketGeneration: 0,
        },
    });

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
            commentThreads: [
                [commentThread1, {isArchived: true}],
                commentThread2,
                [commentThread3, {isArchived: true}],
            ],
            firstCommentThread: {commentThread: commentThread1, contentTextSnippet: "test1"},
        }),
    ]);
});

test("can unarchive post in a channel posts entry with one unarchived post and two archived posts", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session2, {access: "Public"});
    const {range} = await document.type(session2, "target");

    const commentThread1 = await document.createCommentThread(session1, range, "test1");
    const commentThread2 = await document.createCommentThread(session1, range, "test2");
    const commentThread3 = await document.createCommentThread(session1, range, "test3");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxEntry(session2.action().clone({apns: new TestApnsContextModule()}), {
        spaceId: space.id,
        key: {
            type: "DocumentNewCommentThreads",
            documentId: document.id,
            bucketGeneration: 0,
        },
    });

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
        commentThreadId: commentThread3.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxDocumentNewCommentThreadsEntryModel({
            session: session2,
            bucketGeneration: 0,
            commentThreads: [[commentThread1, {isArchived: true}], commentThread2, commentThread3],
            firstCommentThread: {commentThread: commentThread1, contentTextSnippet: "test1"},
        }),
    ]);
});

test("can unarchive post in a channel posts entry with one unarchived post and two archived posts (state from archiving single posts)", async () => {
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

    await unarchiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread3.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxDocumentNewCommentThreadsEntryModel({
            session: session2,
            bucketGeneration: 0,
            commentThreads: [[commentThread1, {isArchived: true}], commentThread2, commentThread3],
            firstCommentThread: {commentThread: commentThread1, contentTextSnippet: "test1"},
        }),
    ]);
});

test("can unarchive post in a channel posts entry with two unarchived posts and one archived post", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session2, {access: "Public"});
    const {range} = await document.type(session2, "target");

    const commentThread1 = await document.createCommentThread(session1, range, "test1");
    const commentThread2 = await document.createCommentThread(session1, range, "test2");
    const commentThread3 = await document.createCommentThread(session1, range, "test3");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxEntry(session2.action().clone({apns: new TestApnsContextModule()}), {
        spaceId: space.id,
        key: {
            type: "DocumentNewCommentThreads",
            documentId: document.id,
            bucketGeneration: 0,
        },
    });

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
        commentThreadId: commentThread3.id,
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
            commentThreads: [commentThread1, commentThread2, commentThread3],
            firstCommentThread: {commentThread: commentThread1, contentTextSnippet: "test1"},
        }),
    ]);
});

test("unarchiving single post is idempotent when all posts are archived", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session2, {access: "Public"});
    const {range} = await document.type(session2, "target");

    const commentThread1 = await document.createCommentThread(session1, range, "test1");
    const commentThread2 = await document.createCommentThread(session1, range, "test2");
    const commentThread3 = await document.createCommentThread(session1, range, "test3");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxEntry(session2.action().clone({apns: new TestApnsContextModule()}), {
        spaceId: space.id,
        key: {
            type: "DocumentNewCommentThreads",
            documentId: document.id,
            bucketGeneration: 0,
        },
    });

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
            commentThreads: [
                [commentThread1, {isArchived: true}],
                commentThread2,
                [commentThread3, {isArchived: true}],
            ],
            firstCommentThread: {commentThread: commentThread1, contentTextSnippet: "test1"},
        }),
    ]);
});

test("unarchiving single post is idempotent when all but one post are unarchived", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session2, {access: "Public"});
    const {range} = await document.type(session2, "target");

    const commentThread1 = await document.createCommentThread(session1, range, "test1");
    const commentThread2 = await document.createCommentThread(session1, range, "test2");
    const commentThread3 = await document.createCommentThread(session1, range, "test3");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxEntry(session2.action().clone({apns: new TestApnsContextModule()}), {
        spaceId: space.id,
        key: {
            type: "DocumentNewCommentThreads",
            documentId: document.id,
            bucketGeneration: 0,
        },
    });

    await unarchiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread1.id,
    });

    await unarchiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
        spaceId: space.id,
        documentId: document.id,
        bucketGeneration: 0,
        commentThreadId: commentThread3.id,
    });

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
});

test("can’t unarchive individual post without access to space", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session2, {access: "Public"});
    const {range} = await document.type(session2, "target");

    await document.createCommentThread(session1, range, "test1");
    const commentThread2 = await document.createCommentThread(session1, range, "test2");
    await document.createCommentThread(session1, range, "test3");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxEntry(session2.action().clone({apns: new TestApnsContextModule()}), {
        spaceId: space.id,
        key: {
            type: "DocumentNewCommentThreads",
            documentId: document.id,
            bucketGeneration: 0,
        },
    });

    await space.removeAccount(session2.account);

    await expect(
        unarchiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
            spaceId: space.id,
            documentId: document.id,
            bucketGeneration: 0,
            commentThreadId: commentThread2.id,
        }),
    ).rejects.toThrow("Account doesn’t have access to space");
});

test("can’t unarchive individual post in entry that doesn’t exist", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(
        unarchiveInboxDocumentNewCommentThreadsEntryCommentThread(session.action(), {
            spaceId: space.id,
            documentId: generateId(),
            bucketGeneration: 0,
            commentThreadId: generateId(),
        }),
    ).rejects.toThrow("Inbox entry not found");
});

test("can’t unarchive individual post which doesn’t exist in inbox entry", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session2, {access: "Public"});
    const {range} = await document.type(session2, "target");

    await document.createCommentThread(session1, range, "test1");
    await document.createCommentThread(session1, range, "test2");
    await document.createCommentThread(session1, range, "test3");

    await ProcessContextModule.waitForTestTasks();

    await observeInbox(session2.action(), {spaceId: space.id});

    const commentThread4 = await document.createCommentThread(session1, range, "test4");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxEntry(session2.action().clone({apns: new TestApnsContextModule()}), {
        spaceId: space.id,
        key: {
            type: "DocumentNewCommentThreads",
            documentId: document.id,
            bucketGeneration: 0,
        },
    });

    await expect(
        unarchiveInboxDocumentNewCommentThreadsEntryCommentThread(session2.action(), {
            spaceId: space.id,
            documentId: document.id,
            bucketGeneration: 0,
            commentThreadId: commentThread4.id,
        }),
    ).rejects.toThrow("Comment thread not found in new comment threads inbox entry");
});
