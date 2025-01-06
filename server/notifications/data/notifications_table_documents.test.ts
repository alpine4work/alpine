import {Fragment, Slice} from "prosemirror-model";
import {AddMarkStep, ReplaceStep} from "prosemirror-transform";
import {
    createDocument,
    createDocumentComment,
    updateDocumentContent,
} from "~/server/documents/data/documents_table.js";
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
import {
    dangerouslyAddSpaceAccountAsAdmin,
    getSpaceAccountsCacheForTest,
    removeSpaceAccountAsAdmin,
} from "~/server/spaces/spaces_table.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {printContentSingleLineTextSnippet} from "~/shared/content/print_content_single_line_text_snippet.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {DocumentContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {DocumentPreviewModel} from "~/shared/documents/document_model.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
import {createSimpleMessageContent} from "~/shared/messaging/message_content_schema.js";
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

function textSlice(text: string) {
    if (text.length === 0) return Slice.empty;
    return new Slice(Fragment.from(DocumentContentProsemirrorSchema.text(text)), 0, 0);
}

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

            const document1 = await createDocument(context.action(scenario.session1), {
                spaceId: scenario.space.id,
            });

            const document2 = await createDocument(context.action(scenario.session2), {
                spaceId: scenario.space.id,
            });

            await updateDocumentContent(context.action(scenario.session1), {
                id: document1.id,
                version: 0,
                steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
                clientId: generateId(),
            });

            await updateDocumentContent(context.action(scenario.session2), {
                id: document2.id,
                version: 0,
                steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
                clientId: generateId(),
            });

            const commentThread1Id = generateId<DocumentCommentThreadId>();
            const commentThread1CreatedTime = new Date();

            await updateDocumentContent(context.action(scenario.session2), {
                id: document1.id,
                version: 1,
                steps: [
                    new AddMarkStep(
                        10,
                        11,
                        DocumentContentProsemirrorSchema.mark("comment", {
                            commentThreadId: commentThread1Id,
                        }),
                    ),
                ],
                clientId: generateId(),
                createCommentThreads: [
                    {
                        commentThreadId: commentThread1Id,
                        initialCommentContent: createSimpleMessageContent("test1"),
                        initialCommentFileIds: [],
                        createdTime: commentThread1CreatedTime,
                    },
                ],
            });

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
                    document: new DocumentPreviewModel({
                        id: document1.id,
                        createdTime: document1.createdTime,
                        spaceId: scenario.space.id,
                        version: 2,
                        titleWithoutFallback: "",
                    }),
                    bucketGeneration: 0,
                    commentThreadCount: 1,
                    commentThreadAuthorCount: 1,
                    firstComment: {
                        author: await scenario.session2.get(),
                        createdTime: commentThread1CreatedTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("test1"),
                            references: emptyContentReferences,
                        }),
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

            const commentThread2Id = generateId<DocumentCommentThreadId>();
            const commentThread2CreatedTime = new Date();

            await updateDocumentContent(context.action(scenario.session2), {
                id: document1.id,
                version: 2,
                steps: [
                    new AddMarkStep(
                        11,
                        12,
                        DocumentContentProsemirrorSchema.mark("comment", {
                            commentThreadId: commentThread2Id,
                        }),
                    ),
                ],
                clientId: generateId(),
                createCommentThreads: [
                    {
                        commentThreadId: commentThread2Id,
                        initialCommentContent: createSimpleMessageContent("test2"),
                        initialCommentFileIds: [],
                        createdTime: commentThread2CreatedTime,
                    },
                ],
            });

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
                    document: new DocumentPreviewModel({
                        id: document1.id,
                        createdTime: document1.createdTime,
                        spaceId: scenario.space.id,
                        version: 3,
                        titleWithoutFallback: "",
                    }),
                    bucketGeneration: 0,
                    commentThreadCount: 2,
                    commentThreadAuthorCount: 1,
                    firstComment: {
                        author: await scenario.session2.get(),
                        createdTime: commentThread1CreatedTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("test1"),
                            references: emptyContentReferences,
                        }),
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

            const commentThread3Id = generateId<DocumentCommentThreadId>();
            const commentThread3CreatedTime = new Date();

            await updateDocumentContent(context.action(scenario.session3), {
                id: document1.id,
                version: 3,
                steps: [
                    new AddMarkStep(
                        12,
                        13,
                        DocumentContentProsemirrorSchema.mark("comment", {
                            commentThreadId: commentThread3Id,
                        }),
                    ),
                ],
                clientId: generateId(),
                createCommentThreads: [
                    {
                        commentThreadId: commentThread3Id,
                        initialCommentContent: createSimpleMessageContent("test3"),
                        initialCommentFileIds: [],
                        createdTime: commentThread3CreatedTime,
                    },
                ],
            });

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
                    document: new DocumentPreviewModel({
                        id: document1.id,
                        createdTime: document1.createdTime,
                        spaceId: scenario.space.id,
                        version: 4,
                        titleWithoutFallback: "",
                    }),
                    bucketGeneration: 0,
                    commentThreadCount: 3,
                    commentThreadAuthorCount: 2,
                    firstComment: {
                        author: await scenario.session2.get(),
                        createdTime: commentThread1CreatedTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("test1"),
                            references: emptyContentReferences,
                        }),
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

            const commentThread4Id = generateId<DocumentCommentThreadId>();
            const commentThread4CreatedTime = new Date();

            await updateDocumentContent(context.action(scenario.session2), {
                id: document2.id,
                version: 1,
                steps: [
                    new AddMarkStep(
                        10,
                        11,
                        DocumentContentProsemirrorSchema.mark("comment", {
                            commentThreadId: commentThread4Id,
                        }),
                    ),
                ],
                clientId: generateId(),
                createCommentThreads: [
                    {
                        commentThreadId: commentThread4Id,
                        initialCommentContent: createSimpleMessageContent("test4"),
                        initialCommentFileIds: [],
                        createdTime: commentThread4CreatedTime,
                    },
                ],
            });

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
                    document: new DocumentPreviewModel({
                        id: document1.id,
                        createdTime: document1.createdTime,
                        spaceId: scenario.space.id,
                        version: 4,
                        titleWithoutFallback: "",
                    }),
                    bucketGeneration: 0,
                    commentThreadCount: 3,
                    commentThreadAuthorCount: 2,
                    firstComment: {
                        author: await scenario.session2.get(),
                        createdTime: commentThread1CreatedTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("test1"),
                            references: emptyContentReferences,
                        }),
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

            const commentThread5Id = generateId<DocumentCommentThreadId>();
            const commentThread5CreatedTime = new Date();

            await updateDocumentContent(context.action(scenario.session1), {
                id: document2.id,
                version: 2,
                steps: [
                    new AddMarkStep(
                        11,
                        12,
                        DocumentContentProsemirrorSchema.mark("comment", {
                            commentThreadId: commentThread5Id,
                        }),
                    ),
                ],
                clientId: generateId(),
                createCommentThreads: [
                    {
                        commentThreadId: commentThread5Id,
                        initialCommentContent: createSimpleMessageContent("test5"),
                        initialCommentFileIds: [],
                        createdTime: commentThread5CreatedTime,
                    },
                ],
            });

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
                    document: new DocumentPreviewModel({
                        id: document1.id,
                        createdTime: document1.createdTime,
                        spaceId: scenario.space.id,
                        version: 4,
                        titleWithoutFallback: "",
                    }),
                    bucketGeneration: 0,
                    commentThreadCount: 3,
                    commentThreadAuthorCount: 2,
                    firstComment: {
                        author: await scenario.session2.get(),
                        createdTime: commentThread1CreatedTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("test1"),
                            references: emptyContentReferences,
                        }),
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
                    document: new DocumentPreviewModel({
                        id: document2.id,
                        createdTime: document2.createdTime,
                        spaceId: scenario.space.id,
                        version: 3,
                        titleWithoutFallback: "",
                    }),
                    bucketGeneration: 0,
                    commentThreadCount: 1,
                    commentThreadAuthorCount: 1,
                    firstComment: {
                        author: await scenario.session1.get(),
                        createdTime: commentThread5CreatedTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("test5"),
                            references: emptyContentReferences,
                        }),
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

            const document = await createDocument(context.action(scenario.session1), {
                spaceId: scenario.space.id,
            });

            await updateDocumentContent(context.action(scenario.session1), {
                id: document.id,
                version: 0,
                steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
                clientId: generateId(),
            });

            const commentThread1Id = generateId<DocumentCommentThreadId>();
            const commentThread1CreatedTime = new Date();

            await updateDocumentContent(context.action(scenario.session2), {
                id: document.id,
                version: 1,
                steps: [
                    new AddMarkStep(
                        10,
                        11,
                        DocumentContentProsemirrorSchema.mark("comment", {
                            commentThreadId: commentThread1Id,
                        }),
                    ),
                ],
                clientId: generateId(),
                createCommentThreads: [
                    {
                        commentThreadId: commentThread1Id,
                        initialCommentContent: scenario.mentionAccount1MessageContent,
                        initialCommentFileIds: [],
                        createdTime: commentThread1CreatedTime,
                    },
                ],
            });

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
                    document: new DocumentPreviewModel({
                        id: document.id,
                        createdTime: document.createdTime,
                        spaceId: scenario.space.id,
                        version: 2,
                        titleWithoutFallback: "",
                    }),
                    commentThreadId: commentThread1Id,
                    firstCommentAuthor: await scenario.session2.get(),
                    latestComment: {
                        author: await scenario.session2.get(),
                        createdTime: commentThread1CreatedTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount1MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session1.account.id, await scenario.session1.get()],
                                ]),
                            },
                        }),
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

            const commentThread2Id = generateId<DocumentCommentThreadId>();
            const commentThread2CreatedTime = new Date();

            await updateDocumentContent(context.action(scenario.session2), {
                id: document.id,
                version: 2,
                steps: [
                    new AddMarkStep(
                        11,
                        12,
                        DocumentContentProsemirrorSchema.mark("comment", {
                            commentThreadId: commentThread2Id,
                        }),
                    ),
                ],
                clientId: generateId(),
                createCommentThreads: [
                    {
                        commentThreadId: commentThread2Id,
                        initialCommentContent: scenario.mentionAccount3MessageContent,
                        initialCommentFileIds: [],
                        createdTime: commentThread2CreatedTime,
                    },
                ],
            });

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
                    document: new DocumentPreviewModel({
                        id: document.id,
                        createdTime: document.createdTime,
                        spaceId: scenario.space.id,
                        version: 3,
                        titleWithoutFallback: "",
                    }),
                    commentThreadId: commentThread1Id,
                    firstCommentAuthor: await scenario.session2.get(),
                    latestComment: {
                        author: await scenario.session2.get(),
                        createdTime: commentThread1CreatedTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount1MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session1.account.id, await scenario.session1.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxDocumentNewCommentThreadsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    document: new DocumentPreviewModel({
                        id: document.id,
                        createdTime: document.createdTime,
                        spaceId: scenario.space.id,
                        version: 3,
                        titleWithoutFallback: "",
                    }),
                    bucketGeneration: 0,
                    commentThreadCount: 1,
                    commentThreadAuthorCount: 1,
                    firstComment: {
                        author: await scenario.session2.get(),
                        createdTime: commentThread2CreatedTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount3MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session3.account.id, await scenario.session3.get()],
                                ]),
                            },
                        }),
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
                    document: new DocumentPreviewModel({
                        id: document.id,
                        createdTime: document.createdTime,
                        spaceId: scenario.space.id,
                        version: 3,
                        titleWithoutFallback: "",
                    }),
                    commentThreadId: commentThread2Id,
                    firstCommentAuthor: await scenario.session2.get(),
                    latestComment: {
                        author: await scenario.session2.get(),
                        createdTime: commentThread2CreatedTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount3MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session3.account.id, await scenario.session3.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("replying creates an inbox entry for subscribers", async () => {
            const scenario = await createNotificationsScenario(context);

            const document = await createDocument(context.action(scenario.session1), {
                spaceId: scenario.space.id,
            });

            await updateDocumentContent(context.action(scenario.session1), {
                id: document.id,
                version: 0,
                steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
                clientId: generateId(),
            });

            const commentThreadId = generateId<DocumentCommentThreadId>();
            const commentThreadCreatedTime = new Date();

            await updateDocumentContent(context.action(scenario.session2), {
                id: document.id,
                version: 1,
                steps: [
                    new AddMarkStep(
                        10,
                        11,
                        DocumentContentProsemirrorSchema.mark("comment", {
                            commentThreadId,
                        }),
                    ),
                ],
                clientId: generateId(),
                createCommentThreads: [
                    {
                        commentThreadId,
                        initialCommentContent: createSimpleMessageContent("comment1"),
                        initialCommentFileIds: [],
                        createdTime: commentThreadCreatedTime,
                    },
                ],
            });

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
                    document: new DocumentPreviewModel({
                        id: document.id,
                        createdTime: document.createdTime,
                        spaceId: scenario.space.id,
                        version: 2,
                        titleWithoutFallback: "",
                    }),
                    bucketGeneration: 0,
                    commentThreadCount: 1,
                    commentThreadAuthorCount: 1,
                    firstComment: {
                        author: await scenario.session2.get(),
                        createdTime: commentThreadCreatedTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment1"),
                            references: emptyContentReferences,
                        }),
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

            const comment2 = await createDocumentComment(context.action(scenario.session3), {
                documentId: document.id,
                commentThreadId: commentThreadId,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment2"),
                fileIds: [],
            });

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
                    document: new DocumentPreviewModel({
                        id: document.id,
                        createdTime: document.createdTime,
                        spaceId: scenario.space.id,
                        version: 2,
                        titleWithoutFallback: "",
                    }),
                    bucketGeneration: 0,
                    commentThreadCount: 1,
                    commentThreadAuthorCount: 1,
                    firstComment: {
                        author: await scenario.session2.get(),
                        createdTime: commentThreadCreatedTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment1"),
                            references: emptyContentReferences,
                        }),
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
                    document: new DocumentPreviewModel({
                        id: document.id,
                        createdTime: document.createdTime,
                        spaceId: scenario.space.id,
                        version: 2,
                        titleWithoutFallback: "",
                    }),
                    commentThreadId,
                    firstCommentAuthor: await scenario.session2.get(),
                    latestComment: {
                        author: await scenario.session3.get(),
                        createdTime: comment2.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment2"),
                            references: emptyContentReferences,
                        }),
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

            const comment3 = await createDocumentComment(context.action(scenario.session2), {
                documentId: document.id,
                commentThreadId: commentThreadId,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment3"),
                fileIds: [],
            });

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
                    document: new DocumentPreviewModel({
                        id: document.id,
                        createdTime: document.createdTime,
                        spaceId: scenario.space.id,
                        version: 2,
                        titleWithoutFallback: "",
                    }),
                    bucketGeneration: 0,
                    commentThreadCount: 1,
                    commentThreadAuthorCount: 1,
                    firstComment: {
                        author: await scenario.session2.get(),
                        createdTime: commentThreadCreatedTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment1"),
                            references: emptyContentReferences,
                        }),
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
                    document: new DocumentPreviewModel({
                        id: document.id,
                        createdTime: document.createdTime,
                        spaceId: scenario.space.id,
                        version: 2,
                        titleWithoutFallback: "",
                    }),
                    commentThreadId,
                    firstCommentAuthor: await scenario.session2.get(),
                    latestComment: {
                        author: await scenario.session2.get(),
                        createdTime: comment3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const comment4 = await createDocumentComment(context.action(scenario.session1), {
                documentId: document.id,
                commentThreadId: commentThreadId,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment4"),
                fileIds: [],
            });

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
                    document: new DocumentPreviewModel({
                        id: document.id,
                        createdTime: document.createdTime,
                        spaceId: scenario.space.id,
                        version: 2,
                        titleWithoutFallback: "",
                    }),
                    bucketGeneration: 0,
                    commentThreadCount: 1,
                    commentThreadAuthorCount: 1,
                    firstComment: {
                        author: await scenario.session2.get(),
                        createdTime: commentThreadCreatedTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment1"),
                            references: emptyContentReferences,
                        }),
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
                    document: new DocumentPreviewModel({
                        id: document.id,
                        createdTime: document.createdTime,
                        spaceId: scenario.space.id,
                        version: 2,
                        titleWithoutFallback: "",
                    }),
                    commentThreadId,
                    firstCommentAuthor: await scenario.session2.get(),
                    latestComment: {
                        author: await scenario.session1.get(),
                        createdTime: comment4.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment4"),
                            references: emptyContentReferences,
                        }),
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
                    document: new DocumentPreviewModel({
                        id: document.id,
                        createdTime: document.createdTime,
                        spaceId: scenario.space.id,
                        version: 2,
                        titleWithoutFallback: "",
                    }),
                    commentThreadId,
                    firstCommentAuthor: await scenario.session2.get(),
                    latestComment: {
                        author: await scenario.session1.get(),
                        createdTime: comment4.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment4"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session2.get(),
                }),
            ]);
        });

        test("comment notification events processed out of order result in the same latest comment", async () => {
            const scenario = await createNotificationsScenario(context);

            const document = await createDocument(context.action(scenario.session3), {
                spaceId: scenario.space.id,
            });

            await updateDocumentContent(context.action(scenario.session3), {
                id: document.id,
                version: 0,
                steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
                clientId: generateId(),
            });

            const commentThreadId = generateId<DocumentCommentThreadId>();
            const commentThreadCreatedTime = new Date();

            await updateDocumentContent(context.action(scenario.session2), {
                id: document.id,
                version: 1,
                steps: [
                    new AddMarkStep(
                        10,
                        11,
                        DocumentContentProsemirrorSchema.mark("comment", {
                            commentThreadId,
                        }),
                    ),
                ],
                clientId: generateId(),
                createCommentThreads: [
                    {
                        commentThreadId,
                        initialCommentContent: createSimpleMessageContent("comment0"),
                        initialCommentFileIds: [],
                        createdTime: commentThreadCreatedTime,
                    },
                ],
            });

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

            await createDocumentComment(context.action(scenario.session1), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment1"),
                fileIds: [],
            });

            await ProcessContextModule.waitForTestTasks();

            const pause1Promise = notificationEventBeforeProcessingTestCheckpoint.pauseForTest(
                scenario.session1.account.id,
            );
            const pause2Promise = notificationEventAfterProcessingTestCheckpoint.pauseForTest(
                scenario.session3.account.id,
            );

            await createDocumentComment(context.action(scenario.session1), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: scenario.mentionAccount2MessageContent,
                fileIds: [],
            });

            const comment3 = await createDocumentComment(context.action(scenario.session3), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment3"),
                fileIds: [],
            });

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
                    document: new DocumentPreviewModel({
                        id: document.id,
                        createdTime: document.createdTime,
                        spaceId: scenario.space.id,
                        version: 2,
                        titleWithoutFallback: "",
                    }),
                    commentThreadId,
                    loudNotificationCount: 0,
                    firstCommentAuthor: await scenario.session2.get(),
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
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
                    document: new DocumentPreviewModel({
                        id: document.id,
                        createdTime: document.createdTime,
                        spaceId: scenario.space.id,
                        version: 2,
                        titleWithoutFallback: "",
                    }),
                    commentThreadId,
                    loudNotificationCount: 0,
                    firstCommentAuthor: await scenario.session2.get(),
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
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
                    document: new DocumentPreviewModel({
                        id: document.id,
                        createdTime: document.createdTime,
                        spaceId: scenario.space.id,
                        version: 2,
                        titleWithoutFallback: "",
                    }),
                    commentThreadId,
                    loudNotificationCount: 0,
                    firstCommentAuthor: await scenario.session2.get(),
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
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
                    document: new DocumentPreviewModel({
                        id: document.id,
                        createdTime: document.createdTime,
                        spaceId: scenario.space.id,
                        version: 2,
                        titleWithoutFallback: "",
                    }),
                    commentThreadId,
                    loudNotificationCount: 1,
                    firstCommentAuthor: await scenario.session2.get(),
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session1.get(),
                }),
            ]);
        });
    });

    test("if an account is removed from a space their inbox won't update anymore", async () => {
        const space = await TestSpace.create(context);

        const session1 = await space.createSession({hasInternalAccess: true});
        const session2 = await space.createSession();

        const document = await createDocument(session1.action(), {
            spaceId: space.id,
        });

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
            clientId: generateId(),
        });

        const commentThreadId = generateId<DocumentCommentThreadId>();
        const commentThreadCreatedTime = new Date();

        await updateDocumentContent(session2.action(), {
            id: document.id,
            version: 1,
            steps: [
                new AddMarkStep(
                    10,
                    11,
                    DocumentContentProsemirrorSchema.mark("comment", {
                        commentThreadId,
                    }),
                ),
            ],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId,
                    initialCommentContent: createSimpleMessageContent("Test comment 0"),
                    initialCommentFileIds: [],
                    createdTime: commentThreadCreatedTime,
                },
            ],
        });

        await expect(
            getInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {type: "DocumentCommentThread", documentId: document.id, commentThreadId},
            }),
        ).rejects.toThrow(NotFoundError);

        await createDocumentComment(session1.action(), {
            documentId: document.id,
            commentThreadId,
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test comment 1"),
            fileIds: [],
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {type: "DocumentCommentThread", documentId: document.id, commentThreadId},
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

        await createDocumentComment(session1.action(), {
            documentId: document.id,
            commentThreadId,
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test comment 2"),
            fileIds: [],
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {type: "DocumentCommentThread", documentId: document.id, commentThreadId},
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

        await createDocumentComment(session1.action(), {
            documentId: document.id,
            commentThreadId,
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test comment 3"),
            fileIds: [],
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {type: "DocumentCommentThread", documentId: document.id, commentThreadId},
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

        await removeSpaceAccountAsAdmin(session1.action(), {
            spaceId: space.id,
            accountId: session2.account.id,
        });

        const spaceAccountsCache = getSpaceAccountsCacheForTest();
        spaceAccountsCache.clearForTest();

        await expect(
            getInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {type: "DocumentCommentThread", documentId: document.id, commentThreadId},
            }),
        ).rejects.toThrow(PermissionDeniedError);

        await createDocumentComment(session1.action(), {
            documentId: document.id,
            commentThreadId,
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test comment 4"),
            fileIds: [],
        });

        await ProcessContextModule.waitForTestTasks();

        await expect(
            getInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {type: "DocumentCommentThread", documentId: document.id, commentThreadId},
            }),
        ).rejects.toThrow(PermissionDeniedError);

        await createDocumentComment(session1.action(), {
            documentId: document.id,
            commentThreadId,
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test comment 5"),
            fileIds: [],
        });

        await ProcessContextModule.waitForTestTasks();

        await expect(
            getInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {type: "DocumentCommentThread", documentId: document.id, commentThreadId},
            }),
        ).rejects.toThrow(PermissionDeniedError);

        await dangerouslyAddSpaceAccountAsAdmin(session1.action(), {
            spaceId: space.id,
            accountId: session2.account.id,
        });

        expect(
            await getInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {type: "DocumentCommentThread", documentId: document.id, commentThreadId},
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

        await createDocumentComment(session1.action(), {
            documentId: document.id,
            commentThreadId,
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test comment 6"),
            fileIds: [],
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {type: "DocumentCommentThread", documentId: document.id, commentThreadId},
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

        await createDocumentComment(session1.action(), {
            documentId: document.id,
            commentThreadId,
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test comment 7"),
            fileIds: [],
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {type: "DocumentCommentThread", documentId: document.id, commentThreadId},
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
}
