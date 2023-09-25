import {Fragment, Slice} from "prosemirror-model";
import {AddMarkStep, ReplaceStep} from "prosemirror-transform";
import {
    createDocument,
    createDocumentComment,
    updateDocumentContent,
} from "~/server/documents/data/documents_table.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestNotificationsContextModule} from "~/server/notifications/data/notifications_context_module.js";
import {
    getInboxEntries,
    notificationEventAfterProcessingTestCheckpoint,
    notificationEventBeforeProcessingTestCheckpoint,
} from "~/server/notifications/data/notifications_table.js";
import {
    createNotificationsScenario,
    massageInboxEntriesQuery,
} from "~/server/notifications/data/test_helpers/notifications_table_test_helpers.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {
    DocumentContentProsemirrorSchema,
    emptyDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {DocumentPreviewModel} from "~/shared/documents/document_model.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
import {createSimpleMessageContent} from "~/shared/messaging/message_content_schema.js";
import {
    InboxDocumentCommentThreadEntryModel,
    InboxDocumentNewCommentThreadsEntryModel,
} from "~/shared/notifications/inbox_model.js";

const context = createTestContext({
    createNotificationsContextModule: () =>
        new TestNotificationsContextModule({
            dangerouslyEscalateToSystemContext: context.escalateToSystemContext,
        }),
});

function textSlice(text: string) {
    if (text.length === 0) return Slice.empty;
    return new Slice(Fragment.from(DocumentContentProsemirrorSchema.text(text)), 0, 0);
}

test("creating comment threads creates an inbox entry for the document owner", async () => {
    const scenario = await createNotificationsScenario(context);

    const document1 = await createDocument(context.action(scenario.session1), {
        spaceId: scenario.space.id,
        content: emptyDocumentContent,
    });

    const document2 = await createDocument(context.action(scenario.session2), {
        spaceId: scenario.space.id,
        content: emptyDocumentContent,
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
                author: await scenario.session2.account.get(),
                createdTime: commentThread1CreatedTime,
                contentSnippet: {
                    doc: createSimpleMessageContent("test1"),
                    references: emptyContentReferences,
                },
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
                author: await scenario.session2.account.get(),
                createdTime: commentThread1CreatedTime,
                contentSnippet: {
                    doc: createSimpleMessageContent("test1"),
                    references: emptyContentReferences,
                },
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
                author: await scenario.session2.account.get(),
                createdTime: commentThread1CreatedTime,
                contentSnippet: {
                    doc: createSimpleMessageContent("test1"),
                    references: emptyContentReferences,
                },
            },
            otherCommentThreadAuthor: await scenario.session3.account.get(),
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
                author: await scenario.session2.account.get(),
                createdTime: commentThread1CreatedTime,
                contentSnippet: {
                    doc: createSimpleMessageContent("test1"),
                    references: emptyContentReferences,
                },
            },
            otherCommentThreadAuthor: await scenario.session3.account.get(),
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
                author: await scenario.session2.account.get(),
                createdTime: commentThread1CreatedTime,
                contentSnippet: {
                    doc: createSimpleMessageContent("test1"),
                    references: emptyContentReferences,
                },
            },
            otherCommentThreadAuthor: await scenario.session3.account.get(),
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
                author: await scenario.session1.account.get(),
                createdTime: commentThread5CreatedTime,
                contentSnippet: {
                    doc: createSimpleMessageContent("test5"),
                    references: emptyContentReferences,
                },
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
});

test("mentioning a user in the initial comment thread creates a comment thread entry", async () => {
    const scenario = await createNotificationsScenario(context);

    const document = await createDocument(context.action(scenario.session1), {
        spaceId: scenario.space.id,
        content: emptyDocumentContent,
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
            firstCommentAuthor: await scenario.session2.account.get(),
            latestComment: {
                author: await scenario.session2.account.get(),
                createdTime: commentThread1CreatedTime,
                contentSnippet: {
                    doc: scenario.mentionAccount1MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session1.account.id, await scenario.session1.account.get()],
                        ]),
                    },
                },
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
            firstCommentAuthor: await scenario.session2.account.get(),
            latestComment: {
                author: await scenario.session2.account.get(),
                createdTime: commentThread1CreatedTime,
                contentSnippet: {
                    doc: scenario.mentionAccount1MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session1.account.id, await scenario.session1.account.get()],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxDocumentNewCommentThreadsEntryModel({
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
                author: await scenario.session2.account.get(),
                createdTime: commentThread2CreatedTime,
                contentSnippet: {
                    doc: scenario.mentionAccount3MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session3.account.id, await scenario.session3.account.get()],
                        ]),
                    },
                },
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
            firstCommentAuthor: await scenario.session2.account.get(),
            latestComment: {
                author: await scenario.session2.account.get(),
                createdTime: commentThread2CreatedTime,
                contentSnippet: {
                    doc: scenario.mentionAccount3MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session3.account.id, await scenario.session3.account.get()],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
    ]);
});

test("replying creates an inbox entry for subscribers", async () => {
    const scenario = await createNotificationsScenario(context);

    const document = await createDocument(context.action(scenario.session1), {
        spaceId: scenario.space.id,
        content: emptyDocumentContent,
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
                author: await scenario.session2.account.get(),
                createdTime: commentThreadCreatedTime,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment1"),
                    references: emptyContentReferences,
                },
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
                author: await scenario.session2.account.get(),
                createdTime: commentThreadCreatedTime,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment1"),
                    references: emptyContentReferences,
                },
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
            firstCommentAuthor: await scenario.session2.account.get(),
            latestComment: {
                author: await scenario.session3.account.get(),
                createdTime: comment2.createdTime,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment2"),
                    references: emptyContentReferences,
                },
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
                author: await scenario.session2.account.get(),
                createdTime: commentThreadCreatedTime,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment1"),
                    references: emptyContentReferences,
                },
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
            firstCommentAuthor: await scenario.session2.account.get(),
            latestComment: {
                author: await scenario.session2.account.get(),
                createdTime: comment3.createdTime,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
    ]);

    const comment4 = await createDocumentComment(context.action(scenario.session1), {
        documentId: document.id,
        commentThreadId: commentThreadId,
        parentCommentIndex: null,
        content: createSimpleMessageContent("comment4"),
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
                author: await scenario.session2.account.get(),
                createdTime: commentThreadCreatedTime,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment1"),
                    references: emptyContentReferences,
                },
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
            firstCommentAuthor: await scenario.session2.account.get(),
            latestComment: {
                author: await scenario.session1.account.get(),
                createdTime: comment4.createdTime,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment4"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: await scenario.session3.account.get(),
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
            firstCommentAuthor: await scenario.session2.account.get(),
            latestComment: {
                author: await scenario.session1.account.get(),
                createdTime: comment4.createdTime,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment4"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: await scenario.session2.account.get(),
        }),
    ]);
});

test("comment notification events processed out of order result in the same latest comment", async () => {
    const scenario = await createNotificationsScenario(context);

    const document = await createDocument(context.action(scenario.session3), {
        spaceId: scenario.space.id,
        content: emptyDocumentContent,
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
    });

    const comment3 = await createDocumentComment(context.action(scenario.session3), {
        documentId: document.id,
        commentThreadId,
        parentCommentIndex: null,
        content: createSimpleMessageContent("comment3"),
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
            firstCommentAuthor: await scenario.session2.account.get(),
            latestComment: {
                createdTime: comment3.createdTime,
                author: await scenario.session3.account.get(),
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
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
            firstCommentAuthor: await scenario.session2.account.get(),
            latestComment: {
                createdTime: comment3.createdTime,
                author: await scenario.session3.account.get(),
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: await scenario.session1.account.get(),
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
            firstCommentAuthor: await scenario.session2.account.get(),
            latestComment: {
                createdTime: comment3.createdTime,
                author: await scenario.session3.account.get(),
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
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
            firstCommentAuthor: await scenario.session2.account.get(),
            latestComment: {
                createdTime: comment3.createdTime,
                author: await scenario.session3.account.get(),
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: await scenario.session1.account.get(),
        }),
    ]);
});
