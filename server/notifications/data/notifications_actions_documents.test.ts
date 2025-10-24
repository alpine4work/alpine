import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getInboxEntry} from "~/server/notifications/data/get_inbox_entry.js";
import {
    notificationEventAfterProcessingTestCheckpoint,
    notificationEventBeforeProcessingTestCheckpoint,
    notificationEventProcessingTestCounter,
    processNotificationEvent,
} from "~/server/notifications/data/process/process_notification_event.js";
import {createNotificationsTestScenario} from "~/server/notifications/data/test_helpers/create_notifications_test_scenario.js";
import {expectInboxDocumentCommentThreadEntryModel} from "~/server/notifications/data/test_helpers/expect_inbox_document_comment_thread_entry_model.js";
import {expectDocumentNewCommentThreadsEntryModel} from "~/server/notifications/data/test_helpers/expect_inbox_document_new_comment_threads_entry_model.js";
import {testGetInboxEntries} from "~/server/notifications/data/test_helpers/test_get_inbox_entries.js";
import {
    acceptSpaceAccountInvite,
    addSpaceAccount,
    getSpaceAccountsCacheForTest,
    removeSpaceAccount,
} from "~/server/spaces/spaces_actions.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/messaging/message_content_schema.js";

let processingType: "Once" | "TwiceSerially" | "ThriceConcurrently" = "Once";

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
});

// Exercise idempotency by running the test suite again with jobs
// processed twice.
for (const [currentProcessingType, processingMultiple] of [
    ["Once", 1],
    ["TwiceSerially", 2],
    ["ThriceConcurrently", 3],
] as const) {
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
                expectDocumentNewCommentThreadsEntryModel({
                    session: scenario.session1,
                    bucketGeneration: 0,
                    firstComment: {
                        commentThread: commentThread1,
                        contentTextSnippet: "test1",
                    },
                    otherCommentThreadAuthor: null,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([]);

            await document1.createCommentThread(scenario.session2, {from: 11, to: 12}, "test2");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectDocumentNewCommentThreadsEntryModel({
                    session: scenario.session1,
                    bucketGeneration: 0,
                    commentThreadCount: 2,
                    firstComment: {
                        commentThread: commentThread1,
                        contentTextSnippet: "test1",
                    },
                    otherCommentThreadAuthor: null,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([]);

            await document1.createCommentThread(scenario.session3, {from: 12, to: 13}, "test3");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectDocumentNewCommentThreadsEntryModel({
                    session: scenario.session1,
                    bucketGeneration: 0,
                    commentThreadCount: 3,
                    commentThreadAuthorCount: 2,
                    firstComment: {
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
                expectDocumentNewCommentThreadsEntryModel({
                    session: scenario.session1,
                    bucketGeneration: 0,
                    commentThreadCount: 3,
                    commentThreadAuthorCount: 2,
                    firstComment: {
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
                expectDocumentNewCommentThreadsEntryModel({
                    session: scenario.session1,
                    bucketGeneration: 0,
                    commentThreadCount: 3,
                    commentThreadAuthorCount: 2,
                    firstComment: {
                        commentThread: commentThread1,
                        contentTextSnippet: "test1",
                    },
                    otherCommentThreadAuthor: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectDocumentNewCommentThreadsEntryModel({
                    session: scenario.session2,
                    bucketGeneration: 0,
                    firstComment: {
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
                    firstCommentAuthor: scenario.session2,
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
                    firstCommentAuthor: scenario.session2,
                    latestComment: {
                        comment: commentThread1,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectDocumentNewCommentThreadsEntryModel({
                    session: scenario.session1,
                    bucketGeneration: 0,
                    firstComment: {
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
                    firstCommentAuthor: scenario.session2,
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
                expectDocumentNewCommentThreadsEntryModel({
                    session: scenario.session1,
                    bucketGeneration: 0,
                    firstComment: {
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
                expectDocumentNewCommentThreadsEntryModel({
                    session: scenario.session1,
                    bucketGeneration: 0,
                    firstComment: {
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
                    firstCommentAuthor: scenario.session2,
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
                expectDocumentNewCommentThreadsEntryModel({
                    session: scenario.session1,
                    bucketGeneration: 0,
                    firstComment: {
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
                    firstCommentAuthor: scenario.session2,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                }),
            ]);

            const comment4 = await commentThread.createComment(scenario.session1, "comment4");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectDocumentNewCommentThreadsEntryModel({
                    session: scenario.session1,
                    bucketGeneration: 0,
                    firstComment: {
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
                    firstCommentAuthor: scenario.session2,
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
                    firstCommentAuthor: scenario.session2,
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
                    firstCommentAuthor: scenario.session2,
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
                    firstCommentAuthor: scenario.session2,
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
                    firstCommentAuthor: scenario.session2,
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
                    firstCommentAuthor: scenario.session2,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                    otherCommentAuthor: scenario.session1,
                }),
            ]);
        });

        test("if an account is removed from a space their inbox won’t update anymore", async () => {
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
                    firstCommentAuthor: session2,
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
                    firstCommentAuthor: session2,
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
                    firstCommentAuthor: session1,
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
                    firstCommentAuthor: session1,
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
                expectDocumentNewCommentThreadsEntryModel({
                    session: session1,
                    bucketGeneration: 0,
                    firstComment: {
                        commentThread,
                        contentTextSnippet: "bar",
                    },
                    otherCommentThreadAuthor: null,
                }),
            ]);

            await document.access.revoke(session1, session1);

            expect(await testGetInboxEntries(session1)).toEqual([
                expectDocumentNewCommentThreadsEntryModel({
                    session: session1,
                    isDocumentPrivate: true,
                    bucketGeneration: 0,
                    firstComment: {
                        commentThread,
                        contentTextSnippet: "",
                    },
                    otherCommentThreadAuthor: null,
                }),
            ]);
        });

        test("won’t send new notification if account loses access to document", async () => {
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
                    firstCommentAuthor: session2,
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
                    firstCommentAuthor: session2,
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
                    firstCommentAuthor: session2,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: "",
                    },
                }),
            ]);
        });

        test("won’t send notification when mentioned if account doesn’t have access to document", async () => {
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
                    firstCommentAuthor: session1,
                    latestComment: {
                        comment,
                        contentTextSnippet: "bar",
                    },
                }),
            ]);
        });

        test("won’t send notification when comment thread is created if account doesn’t have access to own document", async () => {
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

        test("won’t send notification when comment thread is created if account doesn’t have access to own document (but will send notification if mentioned when access is granted back)", async () => {
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
                    firstCommentAuthor: session2,
                    latestComment: {
                        comment,
                        contentTextSnippet: "bar",
                    },
                }),
            ]);
        });
    });
}
