import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    getInboxEntries,
    getInboxEntry,
    notificationEventAfterProcessingTestCheckpoint,
    notificationEventBeforeProcessingTestCheckpoint,
    notificationEventProcessingTestCounter,
    processNotificationEvent,
} from "~/server/notifications/data/notifications_table.js";
import {
    createNotificationsScenario,
    massageInboxEntriesQuery,
} from "~/server/notifications/data/test_helpers/notifications_table_test_helpers.js";
import {addSpaceAccount} from "~/server/spaces/add_account/add_space_account.js";
import {getSpaceAccountsCacheForTest, removeSpaceAccount} from "~/server/spaces/spaces_table.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {DocumentPreviewModel} from "~/shared/documents/document_model.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {
    InboxDocumentCommentThreadEntryModel,
    InboxDocumentNewCommentThreadsEntryModel,
} from "~/shared/notifications/inbox_model.js";

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
        if (currentProcessingType !== "Once") return;

        beforeEach(() => {
            processingType = currentProcessingType;
        });

        test("creating comment threads creates an inbox entry for the document owner", async () => {
            const scenario = await createNotificationsScenario(context);

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

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentNewCommentThreadsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    document: {
                        isPrivate: false,
                        document: new DocumentPreviewModel({
                            id: document1.id,
                            createdTime: document1.createdTime,
                            spaceId: scenario.space.id,
                            version: 3,
                            titleWithoutFallback: "",
                            accessPolicy: expect.any(Object),
                        }),
                    },
                    bucketGeneration: 0,
                    commentThreadCount: 1,
                    commentThreadAuthorCount: 1,
                    firstComment: {
                        author: await scenario.session2.get(),
                        createdTime: commentThread1.createdTime,
                        contentTextSnippet: "test1",
                    },
                    otherCommentThreadAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            await document1.createCommentThread(scenario.session2, {from: 11, to: 12}, "test2");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentNewCommentThreadsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    document: {
                        isPrivate: false,
                        document: new DocumentPreviewModel({
                            id: document1.id,
                            createdTime: document1.createdTime,
                            spaceId: scenario.space.id,
                            version: 4,
                            titleWithoutFallback: "",
                            accessPolicy: expect.any(Object),
                        }),
                    },
                    bucketGeneration: 0,
                    commentThreadCount: 2,
                    commentThreadAuthorCount: 1,
                    firstComment: {
                        author: await scenario.session2.get(),
                        createdTime: commentThread1.createdTime,
                        contentTextSnippet: "test1",
                    },
                    otherCommentThreadAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            await document1.createCommentThread(scenario.session3, {from: 12, to: 13}, "test3");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentNewCommentThreadsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    document: {
                        isPrivate: false,
                        document: new DocumentPreviewModel({
                            id: document1.id,
                            createdTime: document1.createdTime,
                            spaceId: scenario.space.id,
                            version: 5,
                            titleWithoutFallback: "",
                            accessPolicy: expect.any(Object),
                        }),
                    },
                    bucketGeneration: 0,
                    commentThreadCount: 3,
                    commentThreadAuthorCount: 2,
                    firstComment: {
                        author: await scenario.session2.get(),
                        createdTime: commentThread1.createdTime,
                        contentTextSnippet: "test1",
                    },
                    otherCommentThreadAuthor: await scenario.session3.get(),
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            await document2.createCommentThread(scenario.session2, {from: 10, to: 11}, "test4");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentNewCommentThreadsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    document: {
                        isPrivate: false,
                        document: new DocumentPreviewModel({
                            id: document1.id,
                            createdTime: document1.createdTime,
                            spaceId: scenario.space.id,
                            version: 5,
                            titleWithoutFallback: "",
                            accessPolicy: expect.any(Object),
                        }),
                    },
                    bucketGeneration: 0,
                    commentThreadCount: 3,
                    commentThreadAuthorCount: 2,
                    firstComment: {
                        author: await scenario.session2.get(),
                        createdTime: commentThread1.createdTime,
                        contentTextSnippet: "test1",
                    },
                    otherCommentThreadAuthor: await scenario.session3.get(),
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const commentThread5 = await document2.createCommentThread(
                scenario.session1,
                {from: 11, to: 12},
                "test5",
            );

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentNewCommentThreadsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    document: {
                        isPrivate: false,
                        document: new DocumentPreviewModel({
                            id: document1.id,
                            createdTime: document1.createdTime,
                            spaceId: scenario.space.id,
                            version: 5,
                            titleWithoutFallback: "",
                            accessPolicy: expect.any(Object),
                        }),
                    },
                    bucketGeneration: 0,
                    commentThreadCount: 3,
                    commentThreadAuthorCount: 2,
                    firstComment: {
                        author: await scenario.session2.get(),
                        createdTime: commentThread1.createdTime,
                        contentTextSnippet: "test1",
                    },
                    otherCommentThreadAuthor: await scenario.session3.get(),
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentNewCommentThreadsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    document: {
                        isPrivate: false,
                        document: new DocumentPreviewModel({
                            id: document2.id,
                            createdTime: document2.createdTime,
                            spaceId: scenario.space.id,
                            version: 4,
                            titleWithoutFallback: "",
                            accessPolicy: expect.any(Object),
                        }),
                    },
                    bucketGeneration: 0,
                    commentThreadCount: 1,
                    commentThreadAuthorCount: 1,
                    firstComment: {
                        author: await scenario.session1.get(),
                        createdTime: commentThread5.createdTime,
                        contentTextSnippet: "test5",
                    },
                    otherCommentThreadAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            // Make sure multiple processing is working.
            expect(getCount1()).toEqual(1 * processingMultiple);
            expect(getCount2()).toEqual(3 * processingMultiple);
            expect(getCount3()).toEqual(1 * processingMultiple);
        });

        test("mentioning a user in the initial comment thread creates a comment thread entry", async () => {
            const scenario = await createNotificationsScenario(context);

            const document = await TestDocument.create(scenario.session1);
            await document.access.grantDefault(scenario.session1);

            await document.type(scenario.session1, "Hello, world!");

            const commentThread1 = await document.createCommentThread(
                scenario.session2,
                {from: 10, to: 11},
                scenario.mentionAccount1MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentCommentThreadEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 1,
                    document: {
                        isPrivate: false,
                        document: new DocumentPreviewModel({
                            id: document.id,
                            createdTime: document.createdTime,
                            spaceId: scenario.space.id,
                            version: 3,
                            titleWithoutFallback: "",
                            accessPolicy: expect.any(Object),
                        }),
                    },
                    commentThreadId: commentThread1.id,
                    firstCommentAuthor: await scenario.session2.get(),
                    latestComment: {
                        author: await scenario.session2.get(),
                        createdTime: commentThread1.createdTime,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const commentThread2 = await document.createCommentThread(
                scenario.session2,
                {from: 11, to: 12},
                scenario.mentionAccount3MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentCommentThreadEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 1,
                    document: {
                        isPrivate: false,
                        document: new DocumentPreviewModel({
                            id: document.id,
                            createdTime: document.createdTime,
                            spaceId: scenario.space.id,
                            version: 4,
                            titleWithoutFallback: "",
                            accessPolicy: expect.any(Object),
                        }),
                    },
                    commentThreadId: commentThread1.id,
                    firstCommentAuthor: await scenario.session2.get(),
                    latestComment: {
                        author: await scenario.session2.get(),
                        createdTime: commentThread1.createdTime,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxDocumentNewCommentThreadsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    document: {
                        isPrivate: false,
                        document: new DocumentPreviewModel({
                            id: document.id,
                            createdTime: document.createdTime,
                            spaceId: scenario.space.id,
                            version: 4,
                            titleWithoutFallback: "",
                            accessPolicy: expect.any(Object),
                        }),
                    },
                    bucketGeneration: 0,
                    commentThreadCount: 1,
                    commentThreadAuthorCount: 1,
                    firstComment: {
                        author: await scenario.session2.get(),
                        createdTime: commentThread2.createdTime,
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                    },
                    otherCommentThreadAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentCommentThreadEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 1,
                    document: {
                        isPrivate: false,
                        document: new DocumentPreviewModel({
                            id: document.id,
                            createdTime: document.createdTime,
                            spaceId: scenario.space.id,
                            version: 4,
                            titleWithoutFallback: "",
                            accessPolicy: expect.any(Object),
                        }),
                    },
                    commentThreadId: commentThread2.id,
                    firstCommentAuthor: await scenario.session2.get(),
                    latestComment: {
                        author: await scenario.session2.get(),
                        createdTime: commentThread2.createdTime,
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("replying creates an inbox entry for subscribers", async () => {
            const scenario = await createNotificationsScenario(context);

            const document = await TestDocument.create(scenario.session1);
            await document.access.grantDefault(scenario.session1);

            await document.type(scenario.session1, "Hello, world!");

            const commentThread = await document.createCommentThread(
                scenario.session2,
                {from: 10, to: 11},
                "comment1",
            );

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentNewCommentThreadsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    document: {
                        isPrivate: false,
                        document: new DocumentPreviewModel({
                            id: document.id,
                            createdTime: document.createdTime,
                            spaceId: scenario.space.id,
                            version: 3,
                            titleWithoutFallback: "",
                            accessPolicy: expect.any(Object),
                        }),
                    },
                    bucketGeneration: 0,
                    commentThreadCount: 1,
                    commentThreadAuthorCount: 1,
                    firstComment: {
                        author: await scenario.session2.get(),
                        createdTime: commentThread.createdTime,
                        contentTextSnippet: "comment1",
                    },
                    otherCommentThreadAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const comment2 = await commentThread.createComment(scenario.session3, "comment2");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentNewCommentThreadsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    document: {
                        isPrivate: false,
                        document: new DocumentPreviewModel({
                            id: document.id,
                            createdTime: document.createdTime,
                            spaceId: scenario.space.id,
                            version: 3,
                            titleWithoutFallback: "",
                            accessPolicy: expect.any(Object),
                        }),
                    },
                    bucketGeneration: 0,
                    commentThreadCount: 1,
                    commentThreadAuthorCount: 1,
                    firstComment: {
                        author: await scenario.session2.get(),
                        createdTime: commentThread.createdTime,
                        contentTextSnippet: "comment1",
                    },
                    otherCommentThreadAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentCommentThreadEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    document: {
                        isPrivate: false,
                        document: new DocumentPreviewModel({
                            id: document.id,
                            createdTime: document.createdTime,
                            spaceId: scenario.space.id,
                            version: 3,
                            titleWithoutFallback: "",
                            accessPolicy: expect.any(Object),
                        }),
                    },
                    commentThreadId: commentThread.id,
                    firstCommentAuthor: await scenario.session2.get(),
                    latestComment: {
                        author: await scenario.session3.get(),
                        createdTime: comment2.createdTime,
                        contentTextSnippet: "comment2",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const comment3 = await commentThread.createComment(scenario.session2, "comment3");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentNewCommentThreadsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    document: {
                        isPrivate: false,
                        document: new DocumentPreviewModel({
                            id: document.id,
                            createdTime: document.createdTime,
                            spaceId: scenario.space.id,
                            version: 3,
                            titleWithoutFallback: "",
                            accessPolicy: expect.any(Object),
                        }),
                    },
                    bucketGeneration: 0,
                    commentThreadCount: 1,
                    commentThreadAuthorCount: 1,
                    firstComment: {
                        author: await scenario.session2.get(),
                        createdTime: commentThread.createdTime,
                        contentTextSnippet: "comment1",
                    },
                    otherCommentThreadAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentCommentThreadEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    document: {
                        isPrivate: false,
                        document: new DocumentPreviewModel({
                            id: document.id,
                            createdTime: document.createdTime,
                            spaceId: scenario.space.id,
                            version: 3,
                            titleWithoutFallback: "",
                            accessPolicy: expect.any(Object),
                        }),
                    },
                    commentThreadId: commentThread.id,
                    firstCommentAuthor: await scenario.session2.get(),
                    latestComment: {
                        author: await scenario.session2.get(),
                        createdTime: comment3.createdTime,
                        contentTextSnippet: "comment3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const comment4 = await commentThread.createComment(scenario.session1, "comment4");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentNewCommentThreadsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    document: {
                        isPrivate: false,
                        document: new DocumentPreviewModel({
                            id: document.id,
                            createdTime: document.createdTime,
                            spaceId: scenario.space.id,
                            version: 3,
                            titleWithoutFallback: "",
                            accessPolicy: expect.any(Object),
                        }),
                    },
                    bucketGeneration: 0,
                    commentThreadCount: 1,
                    commentThreadAuthorCount: 1,
                    firstComment: {
                        author: await scenario.session2.get(),
                        createdTime: commentThread.createdTime,
                        contentTextSnippet: "comment1",
                    },
                    otherCommentThreadAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentCommentThreadEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    document: {
                        isPrivate: false,
                        document: new DocumentPreviewModel({
                            id: document.id,
                            createdTime: document.createdTime,
                            spaceId: scenario.space.id,
                            version: 3,
                            titleWithoutFallback: "",
                            accessPolicy: expect.any(Object),
                        }),
                    },
                    commentThreadId: commentThread.id,
                    firstCommentAuthor: await scenario.session2.get(),
                    latestComment: {
                        author: await scenario.session1.get(),
                        createdTime: comment4.createdTime,
                        contentTextSnippet: "comment4",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session3.get(),
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentCommentThreadEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    document: {
                        isPrivate: false,
                        document: new DocumentPreviewModel({
                            id: document.id,
                            createdTime: document.createdTime,
                            spaceId: scenario.space.id,
                            version: 3,
                            titleWithoutFallback: "",
                            accessPolicy: expect.any(Object),
                        }),
                    },
                    commentThreadId: commentThread.id,
                    firstCommentAuthor: await scenario.session2.get(),
                    latestComment: {
                        author: await scenario.session1.get(),
                        createdTime: comment4.createdTime,
                        contentTextSnippet: "comment4",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session2.get(),
                }),
            ]);
        });

        test("comment notification events processed out of order result in the same latest comment", async () => {
            const scenario = await createNotificationsScenario(context);

            const document = await TestDocument.create(scenario.session3);
            await document.access.grantDefault(scenario.session3);

            await document.type(scenario.session3, "Hello, world!");

            const commentThread = await document.createCommentThread(
                scenario.session2,
                {from: 10, to: 11},
                "comment0",
            );

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

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

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentCommentThreadEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    document: {
                        isPrivate: false,
                        document: new DocumentPreviewModel({
                            id: document.id,
                            createdTime: document.createdTime,
                            spaceId: scenario.space.id,
                            version: 3,
                            titleWithoutFallback: "",
                            accessPolicy: expect.any(Object),
                        }),
                    },
                    commentThreadId: commentThread.id,
                    loudNotificationCount: 0,
                    firstCommentAuthor: await scenario.session2.get(),
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: "comment3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentCommentThreadEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    document: {
                        isPrivate: false,
                        document: new DocumentPreviewModel({
                            id: document.id,
                            createdTime: document.createdTime,
                            spaceId: scenario.space.id,
                            version: 3,
                            titleWithoutFallback: "",
                            accessPolicy: expect.any(Object),
                        }),
                    },
                    commentThreadId: commentThread.id,
                    loudNotificationCount: 0,
                    firstCommentAuthor: await scenario.session2.get(),
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: "comment3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session1.get(),
                }),
            ]);

            unpause1();
            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentCommentThreadEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    document: {
                        isPrivate: false,
                        document: new DocumentPreviewModel({
                            id: document.id,
                            createdTime: document.createdTime,
                            spaceId: scenario.space.id,
                            version: 3,
                            titleWithoutFallback: "",
                            accessPolicy: expect.any(Object),
                        }),
                    },
                    commentThreadId: commentThread.id,
                    loudNotificationCount: 0,
                    firstCommentAuthor: await scenario.session2.get(),
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: "comment3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentCommentThreadEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    document: {
                        isPrivate: false,
                        document: new DocumentPreviewModel({
                            id: document.id,
                            createdTime: document.createdTime,
                            spaceId: scenario.space.id,
                            version: 3,
                            titleWithoutFallback: "",
                            accessPolicy: expect.any(Object),
                        }),
                    },
                    commentThreadId: commentThread.id,
                    loudNotificationCount: 1,
                    firstCommentAuthor: await scenario.session2.get(),
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: "comment3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session1.get(),
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
            });

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

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentCommentThreadEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session2.account.id,
                    loudNotificationCount: 0,
                    document: {
                        isPrivate: false,
                        document: new DocumentPreviewModel({
                            id: document.id,
                            createdTime: document.createdTime,
                            spaceId: space.id,
                            version: 5,
                            titleWithoutFallback: "foo",
                            accessPolicy: expect.any(Object),
                        }),
                    },
                    commentThreadId: commentThread.id,
                    firstCommentAuthor: await session2.get(),
                    latestComment: {
                        author: await session1.get(),
                        createdTime: comment2.createdTime,
                        contentTextSnippet: "baz",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await document.access.revoke(session1, session2);

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentCommentThreadEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session2.account.id,
                    loudNotificationCount: 0,
                    document: {
                        isPrivate: true,
                        documentId: document.id,
                    },
                    commentThreadId: commentThread.id,
                    firstCommentAuthor: await session2.get(),
                    latestComment: {
                        author: await session1.get(),
                        createdTime: comment2.createdTime,
                        contentTextSnippet: "",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
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

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentCommentThreadEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session2.account.id,
                    loudNotificationCount: 1,
                    document: {
                        isPrivate: false,
                        document: new DocumentPreviewModel({
                            id: document.id,
                            createdTime: document.createdTime,
                            spaceId: space.id,
                            version: 5,
                            titleWithoutFallback: "foo",
                            accessPolicy: expect.any(Object),
                        }),
                    },
                    commentThreadId: commentThread.id,
                    firstCommentAuthor: await session1.get(),
                    latestComment: {
                        author: await session1.get(),
                        createdTime: commentThread.createdTime,
                        contentTextSnippet: `Hello ${session2.account.initialName}`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await document.access.revoke(session1, session2);

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentCommentThreadEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session2.account.id,
                    loudNotificationCount: 1,
                    document: {
                        isPrivate: true,
                        documentId: document.id,
                    },
                    commentThreadId: commentThread.id,
                    firstCommentAuthor: await session1.get(),
                    latestComment: {
                        author: await session1.get(),
                        createdTime: commentThread.createdTime,
                        contentTextSnippet: "",
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
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

            expect(
                await getInboxEntries(session1.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentNewCommentThreadsEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session1.account.id,
                    loudNotificationCount: 0,
                    document: {
                        isPrivate: false,
                        document: new DocumentPreviewModel({
                            id: document.id,
                            createdTime: document.createdTime,
                            spaceId: space.id,
                            version: 5,
                            titleWithoutFallback: "foo",
                            accessPolicy: expect.any(Object),
                        }),
                    },
                    bucketGeneration: 0,
                    commentThreadCount: 1,
                    commentThreadAuthorCount: 1,
                    firstComment: {
                        author: await session2.get(),
                        createdTime: commentThread.createdTime,
                        contentTextSnippet: "bar",
                    },
                    otherCommentThreadAuthor: null,
                }),
            ]);

            await document.access.revoke(session1, session1);

            expect(
                await getInboxEntries(session1.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentNewCommentThreadsEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session1.account.id,
                    loudNotificationCount: 0,
                    document: {
                        isPrivate: true,
                        documentId: document.id,
                    },
                    bucketGeneration: 0,
                    commentThreadCount: 1,
                    commentThreadAuthorCount: 1,
                    firstComment: {
                        author: await session2.get(),
                        createdTime: commentThread.createdTime,
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

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentCommentThreadEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session2.account.id,
                    loudNotificationCount: 0,
                    document: {
                        isPrivate: false,
                        document: new DocumentPreviewModel({
                            id: document.id,
                            createdTime: document.createdTime,
                            spaceId: space.id,
                            version: 5,
                            titleWithoutFallback: "foo",
                            accessPolicy: expect.any(Object),
                        }),
                    },
                    commentThreadId: commentThread.id,
                    firstCommentAuthor: await session2.get(),
                    latestComment: {
                        author: await session1.get(),
                        createdTime: comment2.createdTime,
                        contentTextSnippet: "baz",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await document.access.revoke(session1, session2);

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentCommentThreadEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session2.account.id,
                    loudNotificationCount: 0,
                    document: {
                        isPrivate: true,
                        documentId: document.id,
                    },
                    commentThreadId: commentThread.id,
                    firstCommentAuthor: await session2.get(),
                    latestComment: {
                        author: await session1.get(),
                        createdTime: comment2.createdTime,
                        contentTextSnippet: "",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await commentThread.createComment(session1, "qux");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentCommentThreadEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session2.account.id,
                    loudNotificationCount: 0,
                    document: {
                        isPrivate: true,
                        documentId: document.id,
                    },
                    commentThreadId: commentThread.id,
                    firstCommentAuthor: await session2.get(),
                    latestComment: {
                        author: await session1.get(),
                        createdTime: comment2.createdTime,
                        contentTextSnippet: "",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
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

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            await document.access.grant(session1, session2);

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const comment = await commentThread.createComment(session1, "bar");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentCommentThreadEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session2.account.id,
                    loudNotificationCount: 0,
                    document: {
                        isPrivate: false,
                        document: new DocumentPreviewModel({
                            id: document.id,
                            createdTime: document.createdTime,
                            spaceId: space.id,
                            version: 5,
                            titleWithoutFallback: "foo",
                            accessPolicy: expect.any(Object),
                        }),
                    },
                    commentThreadId: commentThread.id,
                    firstCommentAuthor: await session1.get(),
                    latestComment: {
                        author: await session1.get(),
                        createdTime: comment.createdTime,
                        contentTextSnippet: "bar",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
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

            expect(
                await getInboxEntries(session1.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            await document.access.grant(session2, session1);

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(session1.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            await commentThread.createComment(session2, "qux");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(session1.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);
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

            expect(
                await getInboxEntries(session1.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            await document.access.grant(session2, session1);

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(session1.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const comment = await commentThread.createComment(session2, "bar");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(session1.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxDocumentCommentThreadEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session1.account.id,
                    loudNotificationCount: 0,
                    document: {
                        isPrivate: false,
                        document: new DocumentPreviewModel({
                            id: document.id,
                            createdTime: document.createdTime,
                            spaceId: space.id,
                            version: 7,
                            titleWithoutFallback: "foo",
                            accessPolicy: expect.any(Object),
                        }),
                    },
                    commentThreadId: commentThread.id,
                    firstCommentAuthor: await session2.get(),
                    latestComment: {
                        author: await session2.get(),
                        createdTime: comment.createdTime,
                        contentTextSnippet: "bar",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });
    });
}
