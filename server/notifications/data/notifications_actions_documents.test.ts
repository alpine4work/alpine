import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestPushContextModules} from "~/server/dynamo/test_helpers/create_test_push_context_modules.js";
import {archiveInboxEntry} from "~/server/notifications/data/archive_inbox_entry.js";
import {getInboxEntry} from "~/server/notifications/data/get_inbox_entry.js";
import {NotificationsTable} from "~/server/notifications/data/internal/notifications_table.js";
import {
    updateInboxEntryAfterExecuteTransactionTestCheckpoint,
    updateInboxEntryBeforeExecuteTransactionTestCheckpoint,
} from "~/server/notifications/data/internal/update_inbox_entry.js";
import {notificationsInjection} from "~/server/notifications/data/notifications_injection.js";
import {observeInbox} from "~/server/notifications/data/observe_inbox.js";
import {
    notificationEventAfterProcessingTestCheckpoint,
    notificationEventBeforeProcessingTestCheckpoint,
    notificationEventProcessingTestCounter,
    processNotificationEvent,
} from "~/server/notifications/data/process/process_notification_event.js";
import {createNotificationsTestScenario} from "~/server/notifications/data/test_helpers/create_notifications_test_scenario.js";
import {expectInboxDocumentCommentThreadEntryModel} from "~/server/notifications/data/test_helpers/expect_inbox_document_comment_thread_entry_model.js";
import {expectInboxDocumentNewCommentThreadsEntryModel} from "~/server/notifications/data/test_helpers/expect_inbox_document_new_comment_threads_entry_model.js";
import {testGetInboxEntries} from "~/server/notifications/data/test_helpers/test_get_inbox_entries.js";
import {unarchiveInboxEntry} from "~/server/notifications/data/unarchive_inbox_entry.js";
import {acceptSpaceAccountInvite} from "~/server/spaces/accept_space_account_invite.js";
import {addSpaceAccount} from "~/server/spaces/add_space_account.js";
import {getSpaceAccountsCacheForTest} from "~/server/spaces/get_space_accounts_cache_for_test.js";
import {removeSpaceAccount} from "~/server/spaces/remove_space_account.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/content/message_content_schema.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {cast} from "~/shared/helpers/control/cast.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

type ProcessingType = "Once" | "TwiceSerially" | "ThriceConcurrently";

let processingType: ProcessingType = "Once";

const testSuites: Array<{
    type: ProcessingType;
    processingMultiple: number;
    only?: CommitBlocker;
}> = [
    {type: "Once", processingMultiple: 1},
    {type: "TwiceSerially", processingMultiple: 2},
    {type: "ThriceConcurrently", processingMultiple: 3},
];

afterEach(() => {
    processingType = "Once";
});

const context = createTestContext({
    processJob: async (context, job, jobStartTime, span) => {
        if (job.type === "NotificationEvent") {
            switch (processingType) {
                case "Once": {
                    await processNotificationEvent(context, job.event, span);
                    break;
                }
                case "TwiceSerially": {
                    await processNotificationEvent(context, job.event, span);
                    await processNotificationEvent(context, job.event, span);
                    break;
                }
                case "ThriceConcurrently": {
                    await runAllPromises([
                        processNotificationEvent(context, job.event, span),
                        processNotificationEvent(context, job.event, span),
                        processNotificationEvent(context, job.event, span),
                    ]);
                    break;
                }
                default:
                    throw exhaustive(processingType);
            }
        } else {
            // Noop for other jobs...
        }
    },
    notificationsInjection,
    tasksInjection: {
        internalGetUpdateOurAccountNameTaskTransactionEntries: () => [],
    },
});

// Exercise idempotency by running the test suite again with jobs processed twice.
for (const {type: currentProcessingType, processingMultiple} of testSuites) {
    // If another suite has `only` set then skip this suite so we only run the suite
    // with `only` set.
    if (
        testSuites.some(testSuite => !!testSuite.only && testSuite.type !== currentProcessingType)
    ) {
        continue;
    }

    describe(`processing: ${currentProcessingType}`, () => {
        beforeEach(() => {
            processingType = currentProcessingType;
        });

        test("creating comment threads creates an inbox entry for the document owner", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const {getCount: getCount1} = notificationEventProcessingTestCounter.recordForTest(
                scenario.session1.account.id,
            );
            const {getCount: getCount2} = notificationEventProcessingTestCounter.recordForTest(
                scenario.session2.account.id,
            );
            const {getCount: getCount3} = notificationEventProcessingTestCounter.recordForTest(
                scenario.session3.account.id,
            );

            const document1 = await TestDocument.create(scenario.session1);
            await document1.access.grantDefault(scenario.session1);
            const document2 = await TestDocument.create(scenario.session2);
            await document2.access.grantDefault(scenario.session2);

            await document1.type(scenario.session1, "Hello, world!");
            await document2.type(scenario.session2, "Hello, world!");

            const commentThread1 = await document1.createCommentThread(
                scenario.session2,
                {from: 10, to: 11},
                "test1",
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: scenario.session1,
                    bucketGeneration: 0,
                    firstCommentThread: {
                        commentThread: commentThread1,
                        contentTextSnippet: "test1",
                    },
                    otherCommentThreadAuthor: null,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([]);

            const commentThread2 = await document1.createCommentThread(
                scenario.session2,
                {from: 11, to: 12},
                "test2",
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: scenario.session1,
                    bucketGeneration: 0,
                    commentThreads: [commentThread1, commentThread2],
                    firstCommentThread: {
                        commentThread: commentThread1,
                        contentTextSnippet: "test1",
                    },
                    otherCommentThreadAuthor: null,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([]);

            const commentThread3 = await document1.createCommentThread(
                scenario.session3,
                {from: 12, to: 13},
                "test3",
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: scenario.session1,
                    bucketGeneration: 0,
                    commentThreads: [commentThread1, commentThread2, commentThread3],
                    firstCommentThread: {
                        commentThread: commentThread1,
                        contentTextSnippet: "test1",
                    },
                    otherCommentThreadAuthor: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([]);

            await document2.createCommentThread(scenario.session2, {from: 10, to: 11}, "test4");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: scenario.session1,
                    bucketGeneration: 0,
                    commentThreads: [commentThread1, commentThread2, commentThread3],
                    firstCommentThread: {
                        commentThread: commentThread1,
                        contentTextSnippet: "test1",
                    },
                    otherCommentThreadAuthor: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([]);

            const commentThread5 = await document2.createCommentThread(
                scenario.session1,
                {from: 11, to: 12},
                "test5",
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: scenario.session1,
                    bucketGeneration: 0,
                    commentThreads: [commentThread1, commentThread2, commentThread3],
                    firstCommentThread: {
                        commentThread: commentThread1,
                        contentTextSnippet: "test1",
                    },
                    otherCommentThreadAuthor: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: scenario.session2,
                    bucketGeneration: 0,
                    firstCommentThread: {
                        commentThread: commentThread5,
                        contentTextSnippet: "test5",
                    },
                    otherCommentThreadAuthor: null,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([]);

            // Make sure multiple processing is working.
            expect(getCount1()).toEqual(1 * processingMultiple);
            expect(getCount2()).toEqual(3 * processingMultiple);
            expect(getCount3()).toEqual(1 * processingMultiple);
        });

        test("mentioning a user in the initial comment thread creates a comment thread entry", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const document = await TestDocument.create(scenario.session1);
            await document.access.grantDefault(scenario.session1);

            await document.type(scenario.session1, "Hello, world!");

            const commentThread1 = await document.createCommentThread(
                scenario.session2,
                {from: 10, to: 11},
                scenario.mentionAccount1MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: scenario.session1,
                    loudNotificationCount: 1,
                    commentThread: commentThread1,
                    latestComment: {
                        comment: commentThread1,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([]);

            const commentThread2 = await document.createCommentThread(
                scenario.session2,
                {from: 11, to: 12},
                scenario.mentionAccount3MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: scenario.session1,
                    loudNotificationCount: 1,
                    commentThread: commentThread1,
                    latestComment: {
                        comment: commentThread1,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: scenario.session1,
                    bucketGeneration: 0,
                    firstCommentThread: {
                        commentThread: commentThread2,
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                    },
                    otherCommentThreadAuthor: null,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: scenario.session3,
                    loudNotificationCount: 1,
                    commentThread: commentThread2,
                    latestComment: {
                        comment: commentThread2,
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);
        });

        test("replying creates an inbox entry for subscribers", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const document = await TestDocument.create(scenario.session1);
            await document.access.grantDefault(scenario.session1);

            await document.type(scenario.session1, "Hello, world!");

            const commentThread = await document.createCommentThread(
                scenario.session2,
                {from: 10, to: 11},
                "comment1",
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: scenario.session1,
                    bucketGeneration: 0,
                    firstCommentThread: {
                        commentThread,
                        contentTextSnippet: "comment1",
                    },
                    otherCommentThreadAuthor: null,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([]);

            const comment2 = await commentThread.createComment(scenario.session3, "comment2");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: scenario.session1,
                    bucketGeneration: 0,
                    firstCommentThread: {
                        commentThread,
                        contentTextSnippet: "comment1",
                    },
                    otherCommentThreadAuthor: null,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: scenario.session2,
                    commentThread,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: "comment2",
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([]);

            const comment3 = await commentThread.createComment(scenario.session2, "comment3");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: scenario.session1,
                    bucketGeneration: 0,
                    firstCommentThread: {
                        commentThread,
                        contentTextSnippet: "comment1",
                    },
                    otherCommentThreadAuthor: null,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: scenario.session3,
                    commentThread,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                }),
            ]);

            const comment4 = await commentThread.createComment(scenario.session1, "comment4");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: scenario.session2,
                    commentThread,
                    latestComment: {
                        comment: comment4,
                        contentTextSnippet: "comment4",
                    },
                    otherCommentAuthor: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: scenario.session3,
                    commentThread,
                    latestComment: {
                        comment: comment4,
                        contentTextSnippet: "comment4",
                    },
                    otherCommentAuthor: scenario.session2,
                }),
            ]);
        });

        test("comment notification events processed out of order result in the same latest comment", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const document = await TestDocument.create(scenario.session3);
            await document.access.grantDefault(scenario.session3);

            await document.type(scenario.session3, "Hello, world!");

            const commentThread = await document.createCommentThread(
                scenario.session2,
                {from: 10, to: 11},
                "comment0",
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            await commentThread.createComment(scenario.session1, "comment1");

            await ProcessContextModule.waitForTestTasks();

            const pause1Promise = notificationEventBeforeProcessingTestCheckpoint.pauseForTest(
                scenario.session1.account.id,
            );
            const pause2Promise = notificationEventAfterProcessingTestCheckpoint.pauseForTest(
                scenario.session3.account.id,
            );

            await commentThread.createComment(
                scenario.session1,
                scenario.mentionAccount2MessageContent,
            );

            const comment3 = await commentThread.createComment(scenario.session3, "comment3");

            const {unpause: unpause1} = await pause1Promise;
            const {unpause: unpause2} = await pause2Promise;
            unpause2();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: scenario.session1,
                    commentThread,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: scenario.session2,
                    commentThread,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                    otherCommentAuthor: scenario.session1,
                }),
            ]);

            unpause1();
            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: scenario.session1,
                    commentThread,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: scenario.session2,
                    commentThread,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                    otherCommentAuthor: scenario.session1,
                }),
            ]);
        });

        test("if an account is removed from a space their inbox won\u2019t update anymore", async () => {
            const space = await TestSpace.create(context);

            const session1 = await space.createSession({role: "Admin"});
            const session2 = await space.createSession();

            const document = await TestDocument.create(session1);
            await document.access.grantDefault(session1);

            await document.type(session1, "Hello, world!");

            const commentThread = await document.createCommentThread(
                session2,
                {from: 10, to: 11},
                "Test comment 0",
            );

            await expect(
                getInboxEntry(session2.action(), {
                    spaceId: space.id,
                    key: {
                        type: "DocumentCommentThread",
                        documentId: document.id,
                        commentThreadId: commentThread.id,
                    },
                }),
            ).rejects.toThrow(NotFoundError);

            await commentThread.createComment(session1, "Test comment 1");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntry(session2.action(), {
                    spaceId: space.id,
                    key: {
                        type: "DocumentCommentThread",
                        documentId: document.id,
                        commentThreadId: commentThread.id,
                    },
                }),
            ).toEqual({
                key: expect.any(String),
                version: 1,
                model: expect.objectContaining({
                    latestComment: expect.objectContaining({
                        contentTextSnippet: "Test comment 1",
                    }),
                }),
            });

            await commentThread.createComment(session1, "Test comment 2");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntry(session2.action(), {
                    spaceId: space.id,
                    key: {
                        type: "DocumentCommentThread",
                        documentId: document.id,
                        commentThreadId: commentThread.id,
                    },
                }),
            ).toEqual({
                key: expect.any(String),
                version: 2,
                model: expect.objectContaining({
                    latestComment: expect.objectContaining({
                        contentTextSnippet: "Test comment 2",
                    }),
                }),
            });

            await commentThread.createComment(session1, "Test comment 3");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntry(session2.action(), {
                    spaceId: space.id,
                    key: {
                        type: "DocumentCommentThread",
                        documentId: document.id,
                        commentThreadId: commentThread.id,
                    },
                }),
            ).toEqual({
                key: expect.any(String),
                version: 3,
                model: expect.objectContaining({
                    latestComment: expect.objectContaining({
                        contentTextSnippet: "Test comment 3",
                    }),
                }),
            });

            await removeSpaceAccount(session1.action(), {
                spaceId: space.id,
                accountId: session2.account.id,
            });

            const spaceAccountsCache = getSpaceAccountsCacheForTest();
            spaceAccountsCache.clearForTest();

            await expect(
                getInboxEntry(session2.action(), {
                    spaceId: space.id,
                    key: {
                        type: "DocumentCommentThread",
                        documentId: document.id,
                        commentThreadId: commentThread.id,
                    },
                }),
            ).rejects.toThrow(PermissionDeniedError);

            await commentThread.createComment(session1, "Test comment 4");

            await ProcessContextModule.waitForTestTasks();

            await expect(
                getInboxEntry(session2.action(), {
                    spaceId: space.id,
                    key: {
                        type: "DocumentCommentThread",
                        documentId: document.id,
                        commentThreadId: commentThread.id,
                    },
                }),
            ).rejects.toThrow(PermissionDeniedError);

            await commentThread.createComment(session1, "Test comment 5");

            await ProcessContextModule.waitForTestTasks();

            await expect(
                getInboxEntry(session2.action(), {
                    spaceId: space.id,
                    key: {
                        type: "DocumentCommentThread",
                        documentId: document.id,
                        commentThreadId: commentThread.id,
                    },
                }),
            ).rejects.toThrow(PermissionDeniedError);

            await addSpaceAccount(session1.action(), {
                spaceId: space.id,
                accountId: session2.account.id,
                withoutInviteForTest: true,
            });

            await acceptSpaceAccountInvite(session2.action(), space.id);

            expect(
                await getInboxEntry(session2.action(), {
                    spaceId: space.id,
                    key: {
                        type: "DocumentCommentThread",
                        documentId: document.id,
                        commentThreadId: commentThread.id,
                    },
                }),
            ).toEqual({
                key: expect.any(String),
                version: 3,
                model: expect.objectContaining({
                    latestComment: expect.objectContaining({
                        contentTextSnippet: "Test comment 3",
                    }),
                }),
            });

            await commentThread.createComment(session1, "Test comment 6");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntry(session2.action(), {
                    spaceId: space.id,
                    key: {
                        type: "DocumentCommentThread",
                        documentId: document.id,
                        commentThreadId: commentThread.id,
                    },
                }),
            ).toEqual({
                key: expect.any(String),
                version: 4,
                model: expect.objectContaining({
                    latestComment: expect.objectContaining({
                        contentTextSnippet: "Test comment 6",
                    }),
                }),
            });

            await commentThread.createComment(session1, "Test comment 7");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntry(session2.action(), {
                    spaceId: space.id,
                    key: {
                        type: "DocumentCommentThread",
                        documentId: document.id,
                        commentThreadId: commentThread.id,
                    },
                }),
            ).toEqual({
                key: expect.any(String),
                version: 5,
                model: expect.objectContaining({
                    latestComment: expect.objectContaining({
                        contentTextSnippet: "Test comment 7",
                    }),
                }),
            });
        });

        test("will hide document title if account loses access to document", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session1, {title: "foo"});
            await document.access.grant(session1, session2);

            await document.type(session1, "Hello, ");
            const {range} = await document.type(session1, "world");
            await document.type(session1, "!");

            const commentThread = await document.createCommentThread(session2, range, "bar");

            const comment2 = await commentThread.createComment(session1, "baz");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: session2,
                    commentThread,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: "baz",
                    },
                }),
            ]);

            await document.access.revoke(session1, session2);

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: session2,
                    isDocumentPrivate: true,
                    commentThread,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: "",
                    },
                }),
            ]);
        });

        test("will mark document as deleted in inbox entry when document is soft-deleted", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session1, {title: "foo"});
            await document.access.grant(session1, session2);

            await document.type(session1, "Hello, ");
            const {range} = await document.type(session1, "world");
            await document.type(session1, "!");

            const commentThread = await document.createCommentThread(session2, range, "bar");

            const comment2 = await commentThread.createComment(session1, "baz");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: session2,
                    commentThread,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: "baz",
                    },
                }),
            ]);

            await document.delete(session1);

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: session2,
                    isDocumentPrivate: true,
                    isDocumentDeleted: true,
                    commentThread,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: "",
                    },
                }),
            ]);
        });

        test("will hide document title if account loses access to document when mentioned in comment", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session1, {title: "foo"});
            await document.access.grant(session1, session2);

            await document.type(session1, "Hello, ");
            const {range} = await document.type(session1, "world");
            await document.type(session1, "!");

            const commentThread = await document.createCommentThread(
                session1,
                range,
                assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", null, [
                        MessageContentProsemirrorSchema.node("paragraph", null, [
                            MessageContentProsemirrorSchema.text("Hello "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: session2.account.id,
                                    isShort: false,
                                }),
                            }),
                        ]),
                    ]),
                ),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: session2,
                    loudNotificationCount: 1,
                    commentThread,
                    latestComment: {
                        comment: commentThread,
                        contentTextSnippet: `Hello ${session2.account.initialName}`,
                        isStickyMention: true,
                    },
                }),
            ]);

            await document.access.revoke(session1, session2);

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: session2,
                    loudNotificationCount: 1,
                    isDocumentPrivate: true,
                    commentThread,
                    latestComment: {
                        comment: commentThread,
                        contentTextSnippet: "",
                        isStickyMention: true,
                    },
                }),
            ]);
        });

        test("will hide document title in new comment threads entry if account loses access to own document", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session1, {title: "foo"});
            await document.access.grant(session1, session2);

            await document.type(session1, "Hello, ");
            const {range} = await document.type(session1, "world");
            await document.type(session1, "!");

            const commentThread = await document.createCommentThread(session2, range, "bar");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session1)).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: session1,
                    bucketGeneration: 0,
                    firstCommentThread: {
                        commentThread,
                        contentTextSnippet: "bar",
                    },
                    otherCommentThreadAuthor: null,
                }),
            ]);

            await document.access.revoke(session1, session1);

            expect(await testGetInboxEntries(session1)).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: session1,
                    isDocumentPrivate: true,
                    bucketGeneration: 0,
                    firstCommentThread: {
                        commentThread,
                        contentTextSnippet: "",
                    },
                    otherCommentThreadAuthor: null,
                }),
            ]);
        });

        test("won\u2019t send new notification if account loses access to document", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session1, {title: "foo"});
            await document.access.grant(session1, session2);

            await document.type(session1, "Hello, ");
            const {range} = await document.type(session1, "world");
            await document.type(session1, "!");

            const commentThread = await document.createCommentThread(session2, range, "bar");

            const comment2 = await commentThread.createComment(session1, "baz");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: session2,
                    commentThread,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: "baz",
                    },
                }),
            ]);

            await document.access.revoke(session1, session2);

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: session2,
                    isDocumentPrivate: true,
                    commentThread,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: "",
                    },
                }),
            ]);

            await commentThread.createComment(session1, "qux");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: session2,
                    isDocumentPrivate: true,
                    commentThread,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: "",
                    },
                }),
            ]);
        });

        test("won\u2019t send notification when mentioned if account doesn\u2019t have access to document", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session1, {title: "foo"});

            await document.type(session1, "Hello, ");
            const {range} = await document.type(session1, "world");
            await document.type(session1, "!");

            const commentThread = await document.createCommentThread(
                session1,
                range,
                assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", null, [
                        MessageContentProsemirrorSchema.node("paragraph", null, [
                            MessageContentProsemirrorSchema.text("Hello "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: session2.account.id,
                                    isShort: false,
                                }),
                            }),
                        ]),
                    ]),
                ),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            await document.access.grant(session1, session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            const comment = await commentThread.createComment(session1, "bar");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: session2,
                    commentThread,
                    latestComment: {
                        comment,
                        contentTextSnippet: "bar",
                    },
                }),
            ]);
        });

        test("won\u2019t send notification when comment thread is created if account doesn\u2019t have access to own document", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session1, {title: "foo"});
            await document.access.grant(session1, session2);
            await document.access.revoke(session1, session1);

            await document.type(session2, "Hello, ");
            const {range} = await document.type(session2, "world");
            await document.type(session2, "!");

            const commentThread = await document.createCommentThread(session2, range, "bar");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session1)).toEqual([]);

            await document.access.grant(session2, session1);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session1)).toEqual([]);

            await commentThread.createComment(session2, "qux");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session1)).toEqual([]);
        });

        test("won\u2019t send notification when comment thread is created if account doesn\u2019t have access to own document (but will send notification if mentioned when access is granted back)", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session1, {title: "foo"});
            await document.access.grant(session1, session2);
            await document.access.revoke(session1, session1);

            await document.type(session2, "Hello, ");
            const {range} = await document.type(session2, "world");
            await document.type(session2, "!");

            const commentThread = await document.createCommentThread(
                session2,
                range,
                assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", null, [
                        MessageContentProsemirrorSchema.node("paragraph", null, [
                            MessageContentProsemirrorSchema.text("Hello "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: session1.account.id,
                                    isShort: false,
                                }),
                            }),
                        ]),
                    ]),
                ),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session1)).toEqual([]);

            await document.access.grant(session2, session1);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session1)).toEqual([]);

            const comment = await commentThread.createComment(session2, "bar");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session1)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: session1,
                    commentThread,
                    latestComment: {
                        comment,
                        contentTextSnippet: "bar",
                    },
                }),
            ]);
        });

        test("creating a comment thread also creates a `DocumentNewCommentThreadsEntry` item", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session2, {access: "Public"});
            const {range} = await document.type(session2, "target");

            const commentThread = await document.createCommentThread(session1, range, "test");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: session2,
                    bucketGeneration: 0,
                    firstCommentThread: {commentThread, contentTextSnippet: "test"},
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);

            expect(
                await NotificationsTable.getItem(context, {
                    partitionType: "Inbox",
                    sortRangeType: "DocumentCommentThreadInNewCommentThreadsEntry",
                    spaceId: space.id,
                    accountId: session2.account.id,
                    documentId: document.id,
                    commentThreadId: commentThread.id,
                }),
            ).toEqual(
                expect.objectContaining({
                    newCommentThreadsEntry: {
                        bucketGeneration: 0,
                    },
                }),
            );
        });

        test("creating a comment thread also creates a `DocumentNewCommentThreadsEntry` item at later inbox generation", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session2, {access: "Public"});
            const {range} = await document.type(session2, "target");

            await observeInbox(session2.action(), {spaceId: space.id});
            await observeInbox(session2.action(), {spaceId: space.id});
            await observeInbox(session2.action(), {spaceId: space.id});

            const commentThread = await document.createCommentThread(session1, range, "test");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: session2,
                    bucketGeneration: 6,
                    firstCommentThread: {commentThread, contentTextSnippet: "test"},
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);

            expect(
                await NotificationsTable.getItem(context, {
                    partitionType: "Inbox",
                    sortRangeType: "DocumentCommentThreadInNewCommentThreadsEntry",
                    spaceId: space.id,
                    accountId: session2.account.id,
                    documentId: document.id,
                    commentThreadId: commentThread.id,
                }),
            ).toEqual(
                expect.objectContaining({
                    newCommentThreadsEntry: {
                        bucketGeneration: 6,
                    },
                }),
            );
        });

        test("creating multiple comment threads in a new comment threads entry also creates multiple `DocumentCommentThreadInNewCommentThreadsEntry` items", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session2, {access: "Public"});
            const {range} = await document.type(session2, "target");

            const commentThread1 = await document.createCommentThread(session1, range, "test1");
            const commentThread2 = await document.createCommentThread(session1, range, "test2");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: session2,
                    bucketGeneration: 0,
                    commentThreads: [commentThread1, commentThread2],
                    firstCommentThread: {
                        commentThread: commentThread1,
                        contentTextSnippet: "test1",
                    },
                }),
            ]);

            expect(
                await NotificationsTable.getItem(context, {
                    partitionType: "Inbox",
                    sortRangeType: "DocumentCommentThreadInNewCommentThreadsEntry",
                    spaceId: space.id,
                    accountId: session2.account.id,
                    documentId: document.id,
                    commentThreadId: commentThread1.id,
                }),
            ).toEqual(
                expect.objectContaining({
                    newCommentThreadsEntry: {
                        bucketGeneration: 0,
                    },
                }),
            );

            expect(
                await NotificationsTable.getItem(context, {
                    partitionType: "Inbox",
                    sortRangeType: "DocumentCommentThreadInNewCommentThreadsEntry",
                    spaceId: space.id,
                    accountId: session2.account.id,
                    documentId: document.id,
                    commentThreadId: commentThread2.id,
                }),
            ).toEqual(
                expect.objectContaining({
                    newCommentThreadsEntry: {
                        bucketGeneration: 0,
                    },
                }),
            );

            const commentThread3 = await document.createCommentThread(session1, range, "test3");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: session2,
                    bucketGeneration: 0,
                    commentThreads: [commentThread1, commentThread2, commentThread3],
                    firstCommentThread: {
                        commentThread: commentThread1,
                        contentTextSnippet: "test1",
                    },
                }),
            ]);

            expect(
                await NotificationsTable.getItem(context, {
                    partitionType: "Inbox",
                    sortRangeType: "DocumentCommentThreadInNewCommentThreadsEntry",
                    spaceId: space.id,
                    accountId: session2.account.id,
                    documentId: document.id,
                    commentThreadId: commentThread3.id,
                }),
            ).toEqual(
                expect.objectContaining({
                    newCommentThreadsEntry: {
                        bucketGeneration: 0,
                    },
                }),
            );
        });

        test("responding to a comment on a comment thread in a new comment threads entry archives the new comment threads entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session2, {access: "Public"});
            const {range} = await document.type(session2, "target");

            const commentThread = await document.createCommentThread(session1, range, "test1");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: session2,
                    bucketGeneration: 0,
                    firstCommentThread: {commentThread, contentTextSnippet: "test1"},
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);

            const comment = await commentThread.createComment(session2, "test2");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    isArchived: true,
                    session: session2,
                    commentThread,
                    latestComment: {comment, contentTextSnippet: "test2"},
                }),
            ]);
        });

        test("responding to every comment thread in a new comment threads entry archives the new comment threads entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session2, {access: "Public"});
            const {range} = await document.type(session2, "target");

            const commentThread1 = await document.createCommentThread(session1, range, "test1");
            await ProcessContextModule.waitForTestTasks();

            const commentThread2 = await document.createCommentThread(session1, range, "test2");
            await ProcessContextModule.waitForTestTasks();

            const commentThread3 = await document.createCommentThread(session1, range, "test3");
            await ProcessContextModule.waitForTestTasks();

            const comment1 = await commentThread1.createComment(session2, "test4");
            await ProcessContextModule.waitForTestTasks();

            const comment2 = await commentThread3.createComment(session2, "test5");
            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: session2,
                    bucketGeneration: 0,
                    firstCommentThread: {
                        commentThread: commentThread2,
                        contentTextSnippet: "test2",
                    },
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    isArchived: true,
                    session: session2,
                    commentThread: commentThread3,
                    latestComment: {comment: comment2, contentTextSnippet: "test5"},
                }),
                expectInboxDocumentCommentThreadEntryModel({
                    isArchived: true,
                    session: session2,
                    commentThread: commentThread1,
                    latestComment: {comment: comment1, contentTextSnippet: "test4"},
                }),
            ]);

            const comment3 = await commentThread2.createComment(session2, "test6");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    isArchived: true,
                    session: session2,
                    commentThread: commentThread2,
                    latestComment: {comment: comment3, contentTextSnippet: "test6"},
                }),
                expectInboxDocumentCommentThreadEntryModel({
                    isArchived: true,
                    session: session2,
                    commentThread: commentThread3,
                    latestComment: {comment: comment2, contentTextSnippet: "test5"},
                }),
                expectInboxDocumentCommentThreadEntryModel({
                    isArchived: true,
                    session: session2,
                    commentThread: commentThread1,
                    latestComment: {comment: comment1, contentTextSnippet: "test4"},
                }),
            ]);
        });

        test("being mentioned in a comment thread in a new comment threads entry archives the new comment threads entry", async () => {
            const schema = MessageContentProsemirrorSchema;

            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session2, {access: "Public"});
            const {range} = await document.type(session2, "target");

            const commentThread = await document.createCommentThread(session1, range, "test1");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: session2,
                    bucketGeneration: 0,
                    firstCommentThread: {commentThread, contentTextSnippet: "test1"},
                }),
            ]);
            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);

            const comment = await commentThread.createComment(
                session1,
                schema.node("doc", null, [
                    schema.node("paragraph", null, [
                        schema.text("Hello "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "Account",
                                accountId: session2.account.id,
                                isShort: false,
                            }),
                        }),
                    ]),
                ]),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: session2,
                    commentThread,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment,
                        contentTextSnippet: `Hello ${session2.account.initialName}`,
                        isStickyMention: true,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);
        });

        test("being mentioned in every comment thread in a new comment threads entry archives the new comment threads entry", async () => {
            const schema = MessageContentProsemirrorSchema;

            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session2, {access: "Public"});
            const {range} = await document.type(session2, "target");

            const commentThread1 = await document.createCommentThread(session1, range, "test1");
            const commentThread2 = await document.createCommentThread(session1, range, "test2");
            const commentThread3 = await document.createCommentThread(session1, range, "test3");

            await ProcessContextModule.waitForTestTasks();

            const comment1 = await commentThread1.createComment(
                session1,
                schema.node("doc", null, [
                    schema.node("paragraph", null, [
                        schema.text("Hello "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "Account",
                                accountId: session2.account.id,
                                isShort: false,
                            }),
                        }),
                        schema.text(" (1)"),
                    ]),
                ]),
            );

            await ProcessContextModule.waitForTestTasks();

            const comment2 = await commentThread3.createComment(
                session1,
                schema.node("doc", null, [
                    schema.node("paragraph", null, [
                        schema.text("Hello "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "Account",
                                accountId: session2.account.id,
                                isShort: false,
                            }),
                        }),
                        schema.text(" (2)"),
                    ]),
                ]),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: session2,
                    commentThread: commentThread3,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${session2.account.initialName} (2)`,
                        isStickyMention: true,
                    },
                }),
                expectInboxDocumentCommentThreadEntryModel({
                    session: session2,
                    commentThread: commentThread1,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${session2.account.initialName} (1)`,
                        isStickyMention: true,
                    },
                }),
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: session2,
                    bucketGeneration: 0,
                    firstCommentThread: {
                        commentThread: commentThread2,
                        contentTextSnippet: "test2",
                    },
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);

            const comment3 = await commentThread2.createComment(
                session1,
                schema.node("doc", null, [
                    schema.node("paragraph", null, [
                        schema.text("Hello "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "Account",
                                accountId: session2.account.id,
                                isShort: false,
                            }),
                        }),
                        schema.text(" (3)"),
                    ]),
                ]),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: session2,
                    commentThread: commentThread2,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: `Hello ${session2.account.initialName} (3)`,
                        isStickyMention: true,
                    },
                }),
                expectInboxDocumentCommentThreadEntryModel({
                    session: session2,
                    commentThread: commentThread3,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${session2.account.initialName} (2)`,
                        isStickyMention: true,
                    },
                }),
                expectInboxDocumentCommentThreadEntryModel({
                    session: session2,
                    commentThread: commentThread1,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${session2.account.initialName} (1)`,
                        isStickyMention: true,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);
        });

        test("comment notification event is processed before create comment thread notification event", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3] = await space.createSessions(3);

            const document = await TestDocument.create(session2, {access: "Public"});
            const {range} = await document.type(session2, "target");

            await ProcessContextModule.waitForTestTasks();

            const pauseBeforeCreateCommentThreadPromise =
                notificationEventBeforeProcessingTestCheckpoint.pauseForTest(session1.account.id);

            const pauseAfterFirstCommentPromise =
                notificationEventAfterProcessingTestCheckpoint.pauseForTest(session2.account.id);

            const pauseAfterSecondCommentPromise =
                notificationEventAfterProcessingTestCheckpoint.pauseForTest(session3.account.id);

            const commentThread = await document.createCommentThread(session1, range, "test1");

            await commentThread.createComment(session2, "test2");
            const secondComment = await commentThread.createComment(session3, "test3");

            const {unpause: unpauseBeforeCreateCommentThread} =
                await pauseBeforeCreateCommentThreadPromise;

            const {unpause: unpauseAfterFirstComment} = await pauseAfterFirstCommentPromise;
            unpauseAfterFirstComment();

            const {unpause: unpauseAfterSecondComment} = await pauseAfterSecondCommentPromise;
            unpauseAfterSecondComment();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: session2,
                    commentThread,
                    latestComment: {comment: secondComment, contentTextSnippet: "test3"},
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);

            unpauseBeforeCreateCommentThread();

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: session2,
                    commentThread,
                    latestComment: {comment: secondComment, contentTextSnippet: "test3"},
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);
        });

        test("comment notification event is processed before create comment thread notification event when there\u2019s an existing new comment threads entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3] = await space.createSessions(3);

            const document = await TestDocument.create(session2, {access: "Public"});
            const {range} = await document.type(session2, "target");

            const commentThread1 = await document.createCommentThread(session1, range, "test1");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: session2,
                    bucketGeneration: 0,
                    firstCommentThread: {
                        commentThread: commentThread1,
                        contentTextSnippet: "test1",
                    },
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);

            const pauseBeforeCreateCommentThreadPromise =
                notificationEventBeforeProcessingTestCheckpoint.pauseForTest(session1.account.id);

            const pauseAfterFirstCommentPromise =
                notificationEventAfterProcessingTestCheckpoint.pauseForTest(session2.account.id);

            const pauseAfterSecondCommentPromise =
                notificationEventAfterProcessingTestCheckpoint.pauseForTest(session3.account.id);

            const commentThread2 = await document.createCommentThread(session1, range, "test2");

            await commentThread2.createComment(session2, "test3");
            const secondComment = await commentThread2.createComment(session3, "test4");

            const {unpause: unpauseBeforeCreateCommentThread} =
                await pauseBeforeCreateCommentThreadPromise;

            const {unpause: unpauseAfterFirstComment} = await pauseAfterFirstCommentPromise;
            unpauseAfterFirstComment();

            const {unpause: unpauseAfterSecondComment} = await pauseAfterSecondCommentPromise;
            unpauseAfterSecondComment();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: session2,
                    commentThread: commentThread2,
                    latestComment: {comment: secondComment, contentTextSnippet: "test4"},
                }),
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: session2,
                    bucketGeneration: 0,
                    firstCommentThread: {
                        commentThread: commentThread1,
                        contentTextSnippet: "test1",
                    },
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);

            unpauseBeforeCreateCommentThread();

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: session2,
                    commentThread: commentThread2,
                    latestComment: {comment: secondComment, contentTextSnippet: "test4"},
                }),
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: session2,
                    bucketGeneration: 0,
                    firstCommentThread: {
                        commentThread: commentThread1,
                        contentTextSnippet: "test1",
                    },
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);
        });

        test("comment notification event processing starts before create comment thread event processing is finished", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3] = await space.createSessions(3);

            const document = await TestDocument.create(session2, {access: "Public"});
            const {range} = await document.type(session2, "target");

            await ProcessContextModule.waitForTestTasks();

            const pauseBeforeCreateCommentThreadPromise =
                notificationEventBeforeProcessingTestCheckpoint.pauseForTest(session1.account.id);

            const pauseAfterCreateCommentThreadPromise =
                notificationEventAfterProcessingTestCheckpoint.pauseForTest(session1.account.id);

            const pauseAfterCreateFirstCommentPromise =
                notificationEventAfterProcessingTestCheckpoint.pauseForTest(session2.account.id);

            const pauseBeforeCreateSecondCommentPromise =
                updateInboxEntryBeforeExecuteTransactionTestCheckpoint.pauseForTest(
                    session3.account.id,
                );

            const commentThread = await document.createCommentThread(session1, range, "test1");

            await commentThread.createComment(session2, "test2");
            const secondComment = await commentThread.createComment(session3, "test3");

            const {unpause: unpauseBeforeCreateCommentThread} =
                await pauseBeforeCreateCommentThreadPromise;

            const {unpause: unpauseAfterCreateFirstComment} =
                await pauseAfterCreateFirstCommentPromise;
            unpauseAfterCreateFirstComment();

            const {unpause: unpauseBeforeCreateSecondComment} =
                await pauseBeforeCreateSecondCommentPromise;

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);

            unpauseBeforeCreateCommentThread();

            const {unpause: unpauseAfterCreateCommentThread} =
                await pauseAfterCreateCommentThreadPromise;
            unpauseAfterCreateCommentThread();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);

            unpauseBeforeCreateSecondComment();

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: session2,
                    commentThread,
                    latestComment: {comment: secondComment, contentTextSnippet: "test3"},
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);
        });

        test("comment notification event processing starts before create comment thread event processing is finished (when there are multiple comment threads in a new comment threads notification)", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3, session4, session5] =
                await space.createSessions(5);

            const document = await TestDocument.create(session2, {access: "Public"});
            const {range} = await document.type(session2, "target");

            await ProcessContextModule.waitForTestTasks();

            const pauseBeforeCreateCommentThreadPromise =
                notificationEventBeforeProcessingTestCheckpoint.pauseForTest(session1.account.id);

            const pauseAfterCreateCommentThreadPromise =
                notificationEventAfterProcessingTestCheckpoint.pauseForTest(session1.account.id);

            const pauseAfterCreateFirstCommentPromise =
                notificationEventAfterProcessingTestCheckpoint.pauseForTest(session2.account.id);

            const pauseBeforeCreateSecondCommentPromise =
                updateInboxEntryBeforeExecuteTransactionTestCheckpoint.pauseForTest(
                    session3.account.id,
                );

            const pauseAfterCreateOtherCommentThread1Promise =
                notificationEventAfterProcessingTestCheckpoint.pauseForTest(session4.account.id);

            const pauseAfterCreateOtherCommentThread2Promise =
                notificationEventAfterProcessingTestCheckpoint.pauseForTest(session5.account.id);

            const otherCommentThread1 = await document.createCommentThread(
                session4,
                range,
                "test1",
            );
            const otherCommentThread2 = await document.createCommentThread(
                session5,
                range,
                "test2",
            );
            const commentThread = await document.createCommentThread(session1, range, "test3");

            await commentThread.createComment(session2, "test4");
            const secondComment = await commentThread.createComment(session3, "test5");

            const {unpause: unpauseBeforeCreateCommentThread} =
                await pauseBeforeCreateCommentThreadPromise;

            const {unpause: unpauseAfterCreateFirstComment} =
                await pauseAfterCreateFirstCommentPromise;
            unpauseAfterCreateFirstComment();

            const {unpause: unpauseBeforeCreateSecondComment} =
                await pauseBeforeCreateSecondCommentPromise;

            const {unpause: unpauseAfterCreateOtherCommentThread1} =
                await pauseAfterCreateOtherCommentThread1Promise;
            unpauseAfterCreateOtherCommentThread1();

            const {unpause: unpauseAfterCreateOtherCommentThread2} =
                await pauseAfterCreateOtherCommentThread2Promise;
            unpauseAfterCreateOtherCommentThread2();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: session2,
                    bucketGeneration: 0,
                    commentThreads: [otherCommentThread1, otherCommentThread2],
                    firstCommentThread: {
                        commentThread: otherCommentThread1,
                        contentTextSnippet: "test1",
                    },
                    otherCommentThreadAuthor: expect.any(AccountModel),
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);

            unpauseBeforeCreateCommentThread();

            const {unpause: unpauseAfterCreateCommentThread} =
                await pauseAfterCreateCommentThreadPromise;
            unpauseAfterCreateCommentThread();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: session2,
                    bucketGeneration: 0,
                    commentThreads: [otherCommentThread1, otherCommentThread2],
                    firstCommentThread: {
                        commentThread: otherCommentThread1,
                        contentTextSnippet: "test1",
                    },
                    otherCommentThreadAuthor: expect.any(AccountModel),
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);

            unpauseBeforeCreateSecondComment();

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    session: session2,
                    commentThread,
                    latestComment: {comment: secondComment, contentTextSnippet: "test5"},
                }),
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: session2,
                    bucketGeneration: 0,
                    commentThreads: [otherCommentThread1, otherCommentThread2],
                    firstCommentThread: {
                        commentThread: otherCommentThread1,
                        contentTextSnippet: "test1",
                    },
                    otherCommentThreadAuthor: expect.any(AccountModel),
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);
        });

        test("archiving a new comment threads entry with one comment thread archives that one comment thread as well", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session2, {access: "Public"});
            const {range} = await document.type(session2, "target");

            const commentThread = await document.createCommentThread(session1, range, "test1");

            await ProcessContextModule.waitForTestTasks();

            await archiveInboxEntry(session2.action().clone(createTestPushContextModules()), {
                spaceId: space.id,
                key: {
                    type: "DocumentNewCommentThreads",
                    documentId: document.id,
                    bucketGeneration: 0,
                },
            });

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    isArchived: true,
                    session: session2,
                    bucketGeneration: 0,
                    firstCommentThread: {commentThread, contentTextSnippet: "test1"},
                }),
            ]);
        });

        test("archiving a new comment threads entry with multiple comment threads archives all the comment threads", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session2, {access: "Public"});
            const {range} = await document.type(session2, "target");

            const commentThread1 = await document.createCommentThread(session1, range, "test1");
            const commentThread2 = await document.createCommentThread(session1, range, "test2");
            const commentThread3 = await document.createCommentThread(session1, range, "test3");

            await ProcessContextModule.waitForTestTasks();

            await archiveInboxEntry(session2.action().clone(createTestPushContextModules()), {
                spaceId: space.id,
                key: {
                    type: "DocumentNewCommentThreads",
                    documentId: document.id,
                    bucketGeneration: 0,
                },
            });

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    isArchived: true,
                    session: session2,
                    bucketGeneration: 0,
                    commentThreads: [commentThread1, commentThread2, commentThread3],
                    firstCommentThread: {
                        commentThread: commentThread1,
                        contentTextSnippet: "test1",
                    },
                }),
            ]);
        });

        test("unarchiving a new comment threads entry with one comment thread unarchives that one comment thread as well", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session2, {access: "Public"});
            const {range} = await document.type(session2, "target");

            const commentThread = await document.createCommentThread(session1, range, "test1");

            await ProcessContextModule.waitForTestTasks();

            await archiveInboxEntry(session2.action().clone(createTestPushContextModules()), {
                spaceId: space.id,
                key: {
                    type: "DocumentNewCommentThreads",
                    documentId: document.id,
                    bucketGeneration: 0,
                },
            });

            await unarchiveInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {
                    type: "DocumentNewCommentThreads",
                    documentId: document.id,
                    bucketGeneration: 0,
                },
            });

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: session2,
                    bucketGeneration: 0,
                    firstCommentThread: {commentThread, contentTextSnippet: "test1"},
                }),
            ]);
        });

        test("unarchiving a new comment threads entry with multiple comment threads unarchives all the comment threads as well", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session2, {access: "Public"});
            const {range} = await document.type(session2, "target");

            const commentThread1 = await document.createCommentThread(session1, range, "test1");
            const commentThread2 = await document.createCommentThread(session1, range, "test2");
            const commentThread3 = await document.createCommentThread(session1, range, "test3");

            await ProcessContextModule.waitForTestTasks();

            await archiveInboxEntry(session2.action().clone(createTestPushContextModules()), {
                spaceId: space.id,
                key: {
                    type: "DocumentNewCommentThreads",
                    documentId: document.id,
                    bucketGeneration: 0,
                },
            });

            await unarchiveInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {
                    type: "DocumentNewCommentThreads",
                    documentId: document.id,
                    bucketGeneration: 0,
                },
            });

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: session2,
                    bucketGeneration: 0,
                    commentThreads: [commentThread1, commentThread2, commentThread3],
                    firstCommentThread: {
                        commentThread: commentThread1,
                        contentTextSnippet: "test1",
                    },
                }),
            ]);
        });

        test("setting a reaction on a document comment archives the document comment thread inbox entry", async () => {
            const schema = MessageContentProsemirrorSchema;

            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session2, {access: "Public"});
            const {range} = await document.type(session2, "abc");

            const commentThread = await document.createCommentThread(
                session1,
                range,
                schema.node("doc", null, [
                    schema.node("paragraph", null, [
                        schema.text("Hello, "),
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

            await ProcessContextModule.waitForTestTasks();

            const comment1 = await commentThread.createComment(session1, "test1");

            await ProcessContextModule.waitForTestTasks();

            await comment1.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    isArchived: true,
                    session: session2,
                    commentThread,
                    latestComment: {
                        comment: commentThread,
                        contentTextSnippet: `Hello, ${session2.account.initialName}!`,
                    },
                }),
            ]);
        });

        test("setting a reaction on a document comment that\u2019s not the latest comment archives the document comment inbox entry", async () => {
            const schema = MessageContentProsemirrorSchema;

            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session2, {access: "Public"});
            const {range} = await document.type(session2, "abc");

            const commentThread = await document.createCommentThread(
                session1,
                range,
                schema.node("doc", null, [
                    schema.node("paragraph", null, [
                        schema.text("Hello, "),
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

            await ProcessContextModule.waitForTestTasks();

            const comment1 = await commentThread.createComment(session1, "test1");
            await commentThread.createComment(session1, "test2");
            await commentThread.createComment(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            await comment1.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    isArchived: true,
                    session: session2,
                    commentThread,
                    latestComment: {
                        comment: commentThread,
                        contentTextSnippet: `Hello, ${session2.account.initialName}!`,
                    },
                }),
            ]);
        });

        test("setting a reaction on the latest document comment archives the document comment inbox entry", async () => {
            const schema = MessageContentProsemirrorSchema;

            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session2, {access: "Public"});
            const {range} = await document.type(session2, "abc");

            const commentThread = await document.createCommentThread(
                session1,
                range,
                schema.node("doc", null, [
                    schema.node("paragraph", null, [
                        schema.text("Hello, "),
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

            await ProcessContextModule.waitForTestTasks();

            await commentThread.createComment(session1, "test1");
            await commentThread.createComment(session1, "test2");
            const comment3 = await commentThread.createComment(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            await comment3.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    isArchived: true,
                    session: session2,
                    commentThread,
                    latestComment: {
                        comment: commentThread,
                        contentTextSnippet: `Hello, ${session2.account.initialName}!`,
                    },
                }),
            ]);
        });

        test("setting a reaction on the latest document comment, explicitly unarchiving, then setting a reaction on a different document comment archives the document comment inbox entry", async () => {
            const schema = MessageContentProsemirrorSchema;

            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session2, {access: "Public"});
            const {range} = await document.type(session2, "abc");

            const commentThread = await document.createCommentThread(
                session1,
                range,
                schema.node("doc", null, [
                    schema.node("paragraph", null, [
                        schema.text("Hello, "),
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

            await ProcessContextModule.waitForTestTasks();

            const comment1 = await commentThread.createComment(session1, "test1");
            await commentThread.createComment(session1, "test2");
            const comment3 = await commentThread.createComment(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            await comment3.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            await unarchiveInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {
                    type: "DocumentCommentThread",
                    documentId: document.id,
                    commentThreadId: commentThread.id,
                },
            });

            await comment1.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    isArchived: true,
                    session: session2,
                    commentThread,
                    latestComment: {
                        comment: commentThread,
                        contentTextSnippet: `Hello, ${session2.account.initialName}!`,
                    },
                }),
            ]);
        });

        test("setting a reaction on the latest document comment, implicitly unarchiving, then setting a reaction on a different document comment archives the document comment inbox entry", async () => {
            const schema = MessageContentProsemirrorSchema;

            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session2, {access: "Public"});
            const {range} = await document.type(session2, "abc");

            const commentThread = await document.createCommentThread(
                session1,
                range,
                schema.node("doc", null, [
                    schema.node("paragraph", null, [
                        schema.text("Hello, "),
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

            await ProcessContextModule.waitForTestTasks();

            const comment1 = await commentThread.createComment(session1, "test1");
            await commentThread.createComment(session1, "test2");
            const comment3 = await commentThread.createComment(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            await comment3.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            const comment4 = await commentThread.createComment(session1, "test4");

            await ProcessContextModule.waitForTestTasks();

            await comment1.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    isArchived: true,
                    session: session2,
                    commentThread,
                    latestComment: {
                        comment: comment4,
                        contentTextSnippet: "test4",
                    },
                }),
            ]);
        });

        test("setting a reaction on the latest document comment, implicitly unarchiving, then setting a reaction on the latest document comment archives the document comment inbox entry", async () => {
            const schema = MessageContentProsemirrorSchema;

            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session2, {access: "Public"});
            const {range} = await document.type(session2, "abc");

            const commentThread = await document.createCommentThread(
                session1,
                range,
                schema.node("doc", null, [
                    schema.node("paragraph", null, [
                        schema.text("Hello, "),
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

            await ProcessContextModule.waitForTestTasks();

            await commentThread.createComment(session1, "test1");
            await commentThread.createComment(session1, "test2");
            const comment3 = await commentThread.createComment(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            await comment3.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            const comment4 = await commentThread.createComment(session1, "test4");

            await ProcessContextModule.waitForTestTasks();

            await comment4.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    isArchived: true,
                    session: session2,
                    commentThread,
                    latestComment: {
                        comment: comment4,
                        contentTextSnippet: "test4",
                    },
                }),
            ]);
        });

        test("clears `isStickyMention` when archiving by reacting to a document comment", async () => {
            const schema = MessageContentProsemirrorSchema;

            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session1, {access: "Public"});
            const {range} = await document.type(session1, "abc");

            const commentThread = await document.createCommentThread(session1, range, "test1");

            await ProcessContextModule.waitForTestTasks();

            const comment1 = await commentThread.createComment(
                session1,
                schema.node("doc", null, [
                    schema.node("paragraph", null, [
                        schema.text("Hello, "),
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
            await commentThread.createComment(session1, "test2");
            const comment3 = await commentThread.createComment(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    loudNotificationCount: 1,
                    session: session2,
                    commentThread,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello, ${session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);

            await comment3.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    isArchived: true,
                    session: session2,
                    commentThread,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello, ${session2.account.initialName}!`,
                    },
                }),
            ]);
        });

        test("process setting document comment reaction before document comment notification event", async () => {
            const schema = MessageContentProsemirrorSchema;

            const space = await TestSpace.create(context);
            const [session1, session2, session3] = await space.createSessions(3);

            const document = await TestDocument.create(session1, {access: "Public"});
            const {range} = await document.type(session1, "abc");

            const commentThread = await document.createCommentThread(session1, range, "test1");

            await ProcessContextModule.waitForTestTasks();

            const comment1 = await commentThread.createComment(
                session1,
                schema.node("doc", null, [
                    schema.node("paragraph", null, [
                        schema.text("Hello, "),
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

            await ProcessContextModule.waitForTestTasks();

            const pause1Promise = notificationEventBeforeProcessingTestCheckpoint.pauseForTest(
                session3.account.id,
            );

            const pause2Promise =
                updateInboxEntryAfterExecuteTransactionTestCheckpoint.pauseForTest(
                    session2.account.id,
                );

            const comment2 = await commentThread.createComment(session3, "test2");

            const {unpause: unpause1} = await pause1Promise;

            await comment2.setReaction(session2);

            const {unpause: unpause2} = await pause2Promise;
            unpause2();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    isArchived: true,
                    session: session2,
                    commentThread,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello, ${session2.account.initialName}!`,
                    },
                }),
            ]);

            unpause1();

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    isArchived: true,
                    session: session2,
                    commentThread,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello, ${session2.account.initialName}!`,
                    },
                }),
            ]);
        });

        test("reacting to a document comment archives the associated new document comment threads entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session2, {access: "Public"});
            const {range} = await document.type(session2, "abc");

            const commentThread = await document.createCommentThread(session1, range, "test1");

            await commentThread.createComment(session1, "test2");
            await commentThread.createComment(session1, "test3");
            const comment3 = await commentThread.createComment(session1, "test4");

            await ProcessContextModule.waitForTestTasks();

            await comment3.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    isArchived: true,
                    session: session2,
                    commentThread,
                    latestComment: {comment: commentThread, contentTextSnippet: "test1"},
                    isFromNewCommentThread: true,
                }),
            ]);
        });

        test("reacting to a document comment archives the comment thread in a new document comment threads entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session2, {access: "Public"});
            const {range} = await document.type(session2, "abc");

            const commentThread1 = await document.createCommentThread(session1, range, "test1");
            const commentThread2 = await document.createCommentThread(session1, range, "test2");
            const commentThread3 = await document.createCommentThread(session1, range, "test3");

            const comment = await commentThread2.createComment(session1, "test4");

            await ProcessContextModule.waitForTestTasks();

            await comment.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: session2,
                    bucketGeneration: 0,
                    commentThreads: [commentThread1, commentThread3],
                    firstCommentThread: {
                        commentThread: commentThread1,
                        contentTextSnippet: "test1",
                    },
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    isArchived: true,
                    session: session2,
                    commentThread: commentThread2,
                    latestComment: {comment: commentThread2, contentTextSnippet: "test2"},
                    isFromNewCommentThread: true,
                }),
            ]);
        });

        test("reacting to a document comment archives the associated new document comment threads entry even if the reaction is processed before the create document comment notification event", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3] = await space.createSessions(3);

            const document = await TestDocument.create(session2, {access: "Public"});
            const {range} = await document.type(session2, "abc");

            const pause1Promise = notificationEventBeforeProcessingTestCheckpoint.pauseForTest(
                session3.account.id,
            );

            const pause2Promise =
                updateInboxEntryAfterExecuteTransactionTestCheckpoint.pauseForTest(
                    session2.account.id,
                );

            const commentThread = await document.createCommentThread(session3, range, "test1");

            await commentThread.createComment(session1, "test2");
            await commentThread.createComment(session1, "test3");
            const comment3 = await commentThread.createComment(session1, "test4");

            const {unpause: unpause1} = await pause1Promise;

            await comment3.setReaction(session2);

            const {unpause: unpause2} = await pause2Promise;
            unpause2();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);

            unpause1();

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);
        });

        test("reacting to a document comment archives the associated comment thread in a new document comment threads entry even if the reaction is processed before the create document comment notification event", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3] = await space.createSessions(3);

            const document = await TestDocument.create(session2, {access: "Public"});
            const {range} = await document.type(session2, "abc");

            const pause1Promise = notificationEventBeforeProcessingTestCheckpoint.pauseForTest(
                session3.account.id,
            );

            const pause2Promise =
                updateInboxEntryAfterExecuteTransactionTestCheckpoint.pauseForTest(
                    session2.account.id,
                );

            const commentThread1 = await document.createCommentThread(session1, range, "test1");
            const commentThread2 = await document.createCommentThread(session3, range, "test2");
            const commentThread3 = await document.createCommentThread(session1, range, "test3");

            await commentThread2.createComment(session1, "test4");
            await commentThread2.createComment(session1, "test5");
            const comment3 = await commentThread2.createComment(session1, "test6");

            const {unpause: unpause1} = await pause1Promise;

            await comment3.setReaction(session2);

            const {unpause: unpause2} = await pause2Promise;
            unpause2();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: session2,
                    bucketGeneration: 0,
                    commentThreads: [commentThread1, commentThread3],
                    firstCommentThread: {
                        commentThread: commentThread1,
                        contentTextSnippet: "test1",
                    },
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);

            unpause1();

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    session: session2,
                    bucketGeneration: 0,
                    commentThreads: [commentThread1, commentThread3],
                    firstCommentThread: {
                        commentThread: commentThread1,
                        contentTextSnippet: "test1",
                    },
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);
        });

        test("commenting on a comment thread in a new comment threads entry with a single comment thread deletes the new comment threads entry", async () => {
            const schema = MessageContentProsemirrorSchema;

            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const document = await TestDocument.create(session2, {access: "Public"});
            const {range} = await document.type(session2, "abc");

            const commentThread = await document.createCommentThread(session1, range, "test1");

            await ProcessContextModule.waitForTestTasks();

            await archiveInboxEntry(session2.action().clone(createTestPushContextModules()), {
                spaceId: space.id,
                key: {
                    type: "DocumentNewCommentThreads",
                    documentId: document.id,
                    bucketGeneration: 0,
                },
            });

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([
                expectInboxDocumentNewCommentThreadsEntryModel({
                    isArchived: true,
                    session: session2,
                    bucketGeneration: 0,
                    firstCommentThread: {commentThread, contentTextSnippet: "test1"},
                }),
            ]);

            const comment = await commentThread.createComment(
                session1,
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

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxDocumentCommentThreadEntryModel({
                    loudNotificationCount: 1,
                    session: session2,
                    commentThread,
                    latestComment: {
                        comment,
                        contentTextSnippet: `Hello ${session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);
        });
    });
}
