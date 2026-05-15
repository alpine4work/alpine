import {Fragment, Mark, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {apiDocumentsPaths} from "~/server/api/internal/documents/api_documents_paths.js";
import {ApiServiceBotActionContext} from "~/server/api/internal/shared/api_service_context.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {
    getDocumentContent,
    getDocumentContentSteps,
    updateDocumentContent,
    updateDocumentSnapshotForTest,
} from "~/server/documents/data/documents_actions.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {
    DocumentCollaborationPutContentRequestBodySchema,
    DocumentCollaborationPutContentResponseBodySchema,
} from "~/shared/documents/document_collaboration_protocol.js";
import {
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {InternalError} from "~/shared/error/error.js";
import {assertId, generateId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";
import {diffProsemirrorNodes} from "~/shared/prosemirror/diff_prosemirror_nodes.js";

const context = createTestContext({
    chatInjection,
    documentsInjection,
    tasksInjection,

    // Reimplement the Durable Object `/put-content` route in tests so we can test the
    // API endpoint. The actual route in `DocumentCollaborationDurableObject` isn't
    // that dissimilar from what you see here.
    sendRequestToDurableObject: async (actualContext, request) => {
        const match = request.url.match(/^\/api\/durable-objects\/documents\/([^/]+)\/put-content/);
        if (!match) return;

        const context = (actualContext as ApiServiceBotActionContext).dynamo
            // Strong consistency isn't required since this logic is test-only. So all requests
            // will be strong consistency implicitly.
            .unexpectStrongReadConsistency();

        const documentId = assertId<DocumentId>(match[1]!);

        const requestBody = DocumentCollaborationPutContentRequestBodySchema.deserialize(
            request.body ?? null,
        );

        const document = await getDocumentContent(context, documentId);

        const invertedSteps =
            requestBody.version < document.version
                ? await getDocumentContentSteps(context, {
                      id: documentId,
                      startVersion: requestBody.version,
                      endVersion: document.version,
                  })
                : [];

        let oldContent = document.content;

        for (let index = invertedSteps.length - 1; index >= 0; index--) {
            const step = invertedSteps[index]!;
            const stepResult = step.invertedStep.apply(oldContent);
            if (!stepResult.doc) throw new InternalError(stepResult.failed!);
            oldContent = assertDocumentContent(stepResult.doc);
        }

        const requestContent = DocumentContentProsemirrorSchema.nodes.doc.create(
            // This method isn't currently allowed to update document attributes like
            // `AccessPolicy`.
            oldContent.attrs,
            requestBody.content,
        );

        const steps = diffProsemirrorNodes(oldContent, requestContent);

        const {newVersion, newContent} = await updateDocumentContent(context, {
            id: documentId,
            version: requestBody.version,
            steps,
            clientId: generateId(),
        });

        return DocumentCollaborationPutContentResponseBodySchema.serialize({
            ok: true,
            spaceId: document.spaceId,
            creatorId: document.creator.id,
            newVersion,
            newContent,
        });
    },
});

const server = createTestApiServer(context, apiDocumentsPaths);

describe("POST /documents", () => {
    test("can create a document without content", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const response = await server.POST("/documents", {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                spaceId: space.id,
                document: {
                    title: "Test Document Created by Bot",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Hello, world!"}],
                            },
                        ],
                    },
                },
            },
        });

        // When no creator is specified, the bot is the creator
        expect(response).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: expect.objectContaining({
                spaceId: space.id,
                document: expect.objectContaining({
                    id: expect.any(String),
                    title: "Test Document Created by Bot",
                    creator: {id: bot.id},
                    content: expect.objectContaining({
                        elements: expect.arrayContaining([
                            expect.objectContaining({
                                type: "Paragraph",
                                elements: expect.arrayContaining([
                                    expect.objectContaining({
                                        type: "Text",
                                        text: "Hello, world!",
                                    }),
                                ]),
                            }),
                        ]),
                    }),
                }),
            }),
        });
    });

    test("can create a document with content", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const response = await server.POST("/documents", {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                spaceId: space.id,
                document: {
                    title: "Document with Content",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Hello from the bot!"}],
                            },
                        ],
                    },
                },
            },
        });

        // When no creator is specified, the bot is the creator
        expect(response).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: expect.objectContaining({
                spaceId: space.id,
                document: expect.objectContaining({
                    id: expect.any(String),
                    title: "Document with Content",
                    creator: {id: bot.id},
                    content: expect.objectContaining({
                        elements: expect.arrayContaining([
                            expect.objectContaining({
                                type: "Paragraph",
                                elements: expect.arrayContaining([
                                    expect.objectContaining({
                                        type: "Text",
                                        text: "Hello from the bot!",
                                    }),
                                ]),
                            }),
                        ]),
                    }),
                }),
            }),
        });
    });

    test("can create a document with creator", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const response = await server.POST("/documents", {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                spaceId: space.id,
                document: {
                    title: "Document with Creator",
                    creator: {
                        id: session.account.id,
                    },
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Hello from the creator!"}],
                            },
                        ],
                    },
                },
            },
        });

        expect(response).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: expect.objectContaining({
                spaceId: space.id,
                document: expect.objectContaining({
                    id: expect.any(String),
                    title: "Document with Creator",
                    creator: {id: session.account.id},
                }),
            }),
        });
    });

    test("can create a document with creator from task comments", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);

        const collection = await TestTaskCollection.create(session, {
            access: {
                type: "Local",
                accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
                defaultGrant: null,
                urlGrant: null,
            },
        });
        const task = await TestTask.create(session, {collections: [collection]});
        await task.createComment(session, "This is a test comment");

        // Create API key with Task scope - this simulates a bot being mentioned in task
        // comments
        const apiKey = await bot.createApiKey({type: "Task", taskId: task.id});

        const response = await server.POST("/documents", {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                spaceId: space.id,
                document: {
                    title: "Document with Creator",
                    creator: {
                        id: session.account.id,
                    },
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Hello from the creator!"}],
                            },
                        ],
                    },
                },
            },
        });

        expect(response).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: expect.objectContaining({
                spaceId: space.id,
                document: expect.objectContaining({
                    id: expect.any(String),
                    title: "Document with Creator",
                    creator: {id: session.account.id},
                }),
            }),
        });
    });
});

test("can read document content", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const document = await TestDocument.create(session, {
        title: "Test Document",
        access: "Private",
    });

    await document.type(session, "This is a test document with some content.");

    expect(
        await server.GET(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            spaceId: space.id,
            document: expect.objectContaining({
                id: document.id,
                title: "Test Document",
                content: expect.objectContaining({
                    elements: expect.arrayContaining([
                        expect.objectContaining({
                            type: "Paragraph",
                            elements: expect.arrayContaining([
                                expect.objectContaining({
                                    type: "Text",
                                    text: "This is a test document with some content.",
                                }),
                            ]),
                        }),
                    ]),
                }),
            }),
        }),
    });
});

test("can read untitled document content", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const document = await TestDocument.create(session, {
        title: "",
        access: "Private",
    });

    await document.type(session, "This is a test document with some content.");

    expect(
        await server.GET(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            spaceId: space.id,
            document: expect.objectContaining({
                id: document.id,
                title: "",
                content: expect.objectContaining({
                    elements: expect.arrayContaining([
                        expect.objectContaining({
                            type: "Paragraph",
                            elements: expect.arrayContaining([
                                expect.objectContaining({
                                    type: "Text",
                                    text: "This is a test document with some content.",
                                }),
                            ]),
                        }),
                    ]),
                }),
            }),
        }),
    });
});

test("can\u2019t read document content without access", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const document = await TestDocument.create(session2, {access: "Private"});

    expect(
        await server.GET(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 403,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: expect.objectContaining({
                message: expect.stringMatching("You aren\u2019t allowed"),
            }),
        },
    });
});

test("can\u2019t read document content for non-existent document", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    expect(
        await server.GET(`/documents/${generateId<DocumentId>()}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 404,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: expect.objectContaining({
                message: expect.stringMatching("doesn\u2019t exist"),
            }),
        },
    });
});

describe("/documents/{id}/mention", () => {
    test("can read document mention", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const document = await TestDocument.create(session, {
            title: "Test Document Title",
            access: "Private",
        });

        expect(
            await server.GET(`/documents/${document.id}/mention`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                mention: {
                    target: {
                        type: "Document",
                        id: document.id,
                    },
                    title: "Test Document Title",
                },
            },
        });
    });

    test("can’t read document mention without access", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const session2 = await space.createSession();

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey(session1);

        const document = await TestDocument.create(session2, {access: "Private"});

        expect(
            await server.GET(`/documents/${document.id}/mention`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 403,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message: expect.stringMatching("You aren’t allowed to access this document."),
                }),
            },
        });
    });

    test("can’t read document mention for non-existent document", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        expect(
            await server.GET(`/documents/${generateId<DocumentId>()}/mention`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 404,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message: expect.stringMatching("This document doesn’t exist"),
                }),
            },
        });
    });

    test("can read document mention with document scope", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const document = await TestDocument.create(session, {
            title: "Scoped Document",
            access: "Private",
        });
        const apiKey = await bot.createApiKey({type: "Document", documentId: document.id});

        expect(
            await server.GET(`/documents/${document.id}/mention`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                mention: {
                    target: {
                        type: "Document",
                        id: document.id,
                    },
                    title: "Scoped Document",
                },
            },
        });
    });
});

test("can read document content with document scope", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const document = await TestDocument.create(session, {
        title: "Test Document",
        access: "Private",
    });

    const apiKey = await bot.createApiKey({type: "Document", documentId: document.id});

    await document.type(session, "This is a test document with some content.");

    expect(
        await server.GET(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            spaceId: space.id,
            document: expect.objectContaining({
                id: document.id,
                title: "Test Document",
                content: expect.objectContaining({
                    elements: expect.arrayContaining([
                        expect.objectContaining({
                            type: "Paragraph",
                            elements: expect.arrayContaining([
                                expect.objectContaining({
                                    type: "Text",
                                    text: "This is a test document with some content.",
                                }),
                            ]),
                        }),
                    ]),
                }),
            }),
        }),
    });
});

describe("comment threads", () => {
    const schema = DocumentContentProsemirrorSchema;

    function textSlice(text: string, marks: ReadonlyArray<Mark> = []) {
        if (text.length === 0) return Slice.empty;
        return new Slice(Fragment.from(schema.text(text, marks)), 0, 0);
    }

    test("returns snippet of document with comment", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect((await document.get()).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [
                        schema.text("Hello", [
                            schema.mark("comment", {commentThreadId: commentThread.id}),
                        ]),
                        schema.text(", world!"),
                    ]),
                ])
                .toJSON(),
        );

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey({type: "Document", documentId: document.id});

        expect(
            await server.GET(`/documents/${document.id}/threads/${commentThread.id}`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                commentThread: expect.objectContaining({
                    id: commentThread.id,
                    isResolved: false,
                    commentCount: 1,
                    documentContentSnippet: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {
                                        type: "Text",
                                        text: "Hello",
                                        marks: [
                                            {
                                                type: "Comment",
                                                threadId: commentThread.id,
                                            },
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: ", world!",
                                    },
                                ],
                            },
                        ],
                    },
                }),
            },
        });
    });

    test("returns fallback content snippet if the comment text was removed", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect((await document.get()).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [
                        schema.text("Hello", [
                            schema.mark("comment", {commentThreadId: commentThread.id}),
                        ]),
                        schema.text(", world!"),
                    ]),
                ])
                .toJSON(),
        );

        // Remove the text of the commented range
        await document.update(session, [new ReplaceStep(range.from, range.to, textSlice(""))]);

        expect((await document.get()).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [schema.text(", world!")]),
                ])
                .toJSON(),
        );

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey({type: "Document", documentId: document.id});

        expect(
            await server.GET(`/documents/${document.id}/threads/${commentThread.id}`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                commentThread: expect.objectContaining({
                    id: commentThread.id,
                    isResolved: false,
                    commentCount: 1,
                    documentContentSnippet: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {
                                        type: "Text",
                                        text: "Hello",
                                        marks: [
                                            {
                                                type: "Comment",
                                                threadId: commentThread.id,
                                            },
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: ", world!",
                                    },
                                ],
                            },
                        ],
                    },
                }),
            },
        });
    });

    test("returns snippet of document if comment thread is resolved", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect((await document.get()).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [
                        schema.text("Hello", [
                            schema.mark("comment", {commentThreadId: commentThread.id}),
                        ]),
                        schema.text(", world!"),
                    ]),
                ])
                .toJSON(),
        );

        // resolve comment thread
        await commentThread.resolve(session);

        expect((await document.get()).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        );

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey({type: "Document", documentId: document.id});

        expect(
            await server.GET(`/documents/${document.id}/threads/${commentThread.id}`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                commentThread: expect.objectContaining({
                    id: commentThread.id,
                    isResolved: true,
                    commentCount: 1,
                    documentContentSnippet: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {
                                        type: "Text",
                                        text: "Hello",
                                        marks: [
                                            {
                                                type: "Comment",
                                                threadId: commentThread.id,
                                            },
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: ", world!",
                                    },
                                ],
                            },
                        ],
                    },
                }),
            },
        });
    });

    test("returns snippet of document if comment thread is resolved and text is removed", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect((await document.get()).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [
                        schema.text("Hello", [
                            schema.mark("comment", {commentThreadId: commentThread.id}),
                        ]),
                        schema.text(", world!"),
                    ]),
                ])
                .toJSON(),
        );

        // Remove the text of the commented range
        await document.update(session, [new ReplaceStep(range.from, range.to, textSlice(""))]);

        expect((await document.get()).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [schema.text(", world!")]),
                ])
                .toJSON(),
        );

        // resolve comment thread
        await commentThread.resolve(session);

        expect((await document.get()).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [schema.text(", world!")]),
                ])
                .toJSON(),
        );

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey({type: "Document", documentId: document.id});

        expect(
            await server.GET(`/documents/${document.id}/threads/${commentThread.id}`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                commentThread: expect.objectContaining({
                    id: commentThread.id,
                    isResolved: true,
                    commentCount: 1,
                    documentContentSnippet: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {
                                        type: "Text",
                                        text: "Hello",
                                        marks: [
                                            {
                                                type: "Comment",
                                                threadId: commentThread.id,
                                            },
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: ", world!",
                                    },
                                ],
                            },
                        ],
                    },
                }),
            },
        });
    });
});

describe("PUT /documents/{id}", () => {
    test("no-op PUT returns the unchanged document", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const document = await TestDocument.create(session, {
            title: "No-op Test",
            body: "Stable content.",
            access: "Public",
        });

        const response = await server.PUT(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                document: {
                    title: "No-op Test",
                    version: await document.getVersion(),
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Stable content."}],
                            },
                        ],
                    },
                },
            },
        });

        expect(response).toMatchObject({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                document: expect.objectContaining({
                    content: expect.objectContaining({
                        elements: expect.arrayContaining([
                            expect.objectContaining({
                                type: "Paragraph",
                                elements: [
                                    expect.objectContaining({
                                        type: "Text",
                                        text: "Stable content.",
                                    }),
                                ],
                            }),
                        ]),
                    }),
                }),
            },
        });
    });

    test("PUT returns the updated document", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const document = await TestDocument.create(session, {
            title: "Updated Test",
            body: "Original content.",
            access: "Public",
        });

        const response = await server.PUT(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                document: {
                    title: "Updated Test",
                    version: await document.getVersion(),
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Updated content."}],
                            },
                        ],
                    },
                },
            },
        });

        expect(response).toMatchObject({
            status: 200,
            body: {
                document: expect.objectContaining({
                    content: expect.objectContaining({
                        elements: expect.arrayContaining([
                            expect.objectContaining({
                                type: "Paragraph",
                                elements: [
                                    expect.objectContaining({
                                        type: "Text",
                                        text: "Updated content.",
                                    }),
                                ],
                            }),
                        ]),
                    }),
                }),
            },
        });
    });

    test("PUT updates the document title via ProseMirror steps", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const document = await TestDocument.create(session, {
            title: "Original API Title",
            body: "Body stays the same.",
            access: "Public",
        });

        const response = await server.PUT(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                document: {
                    title: "Renamed Via API",
                    version: await document.getVersion(),
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Body stays the same."}],
                            },
                        ],
                    },
                },
            },
        });

        expect(response).toMatchObject({
            status: 200,
            body: {
                document: expect.objectContaining({
                    title: "Renamed Via API",
                }),
            },
        });
    });

    test("PUT rebases title updates from a previous version over concurrent body updates", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const document = await TestDocument.create(session, {
            title: "Original Title",
            body: "Original body.",
            access: "Public",
        });
        const previousVersion = await document.getVersion();

        await document.type(session, " Concurrent tail.");

        const putResponse = await server.PUT(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                document: {
                    title: "Renamed Title",
                    version: previousVersion,
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Original body."}],
                            },
                        ],
                    },
                },
            },
        });
        const getResponse = await server.GET(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect({putResponse, getResponse}).toMatchObject({
            putResponse: {
                status: 200,
                body: {
                    document: expect.objectContaining({
                        title: "Renamed Title",
                        content: expect.objectContaining({
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {
                                            type: "Text",
                                            text: "Original body. Concurrent tail.",
                                        },
                                    ],
                                },
                            ],
                        }),
                    }),
                },
            },
            getResponse: {
                status: 200,
                body: {
                    document: expect.objectContaining({
                        title: "Renamed Title",
                        content: expect.objectContaining({
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {
                                            type: "Text",
                                            text: "Original body. Concurrent tail.",
                                        },
                                    ],
                                },
                            ],
                        }),
                    }),
                },
            },
        });
    });

    test("PUT rebases body updates from a previous version over concurrent title updates", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const document = await TestDocument.create(session, {
            title: "Original Title",
            body: "Original body.",
            access: "Public",
        });
        const previousVersion = await document.getVersion();

        const concurrentTitleResponse = await server.PUT(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                document: {
                    title: "Concurrent Title",
                    version: previousVersion,
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Original body."}],
                            },
                        ],
                    },
                },
            },
        });
        const staleBodyResponse = await server.PUT(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                document: {
                    title: "Original Title",
                    version: previousVersion,
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Updated body."}],
                            },
                        ],
                    },
                },
            },
        });

        expect({concurrentTitleResponse, staleBodyResponse}).toMatchObject({
            concurrentTitleResponse: {status: 200},
            staleBodyResponse: {
                status: 200,
                body: {
                    document: expect.objectContaining({
                        title: "Concurrent Title",
                        content: expect.objectContaining({
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Updated body."}],
                                },
                            ],
                        }),
                    }),
                },
            },
        });
    });

    test("PUT rebases non-conflicting body updates from a previous version", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const document = await TestDocument.create(session, {
            title: "Body Rebase",
            body: "Alpha",
            access: "Public",
        });
        const previousVersion = await document.getVersion();

        const concurrentBodyResponse = await server.PUT(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                document: {
                    title: "Body Rebase",
                    version: previousVersion,
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Alpha Beta"}],
                            },
                        ],
                    },
                },
            },
        });
        const staleBodyResponse = await server.PUT(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                document: {
                    title: "Body Rebase",
                    version: previousVersion,
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Start Alpha"}],
                            },
                        ],
                    },
                },
            },
        });

        expect({concurrentBodyResponse, staleBodyResponse}).toMatchObject({
            concurrentBodyResponse: {status: 200},
            staleBodyResponse: {
                status: 200,
                body: {
                    document: expect.objectContaining({
                        title: "Body Rebase",
                        content: expect.objectContaining({
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Start Alpha Beta"}],
                                },
                            ],
                        }),
                    }),
                },
            },
        });
    });

    test("PUT rebases previous version updates across the document snapshot boundary", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const document = await TestDocument.create(session, {
            title: "Snapshot Boundary",
            body: "Base",
            access: "Public",
        });
        const previousVersion = await document.getVersion();

        await document.type(session, " one");
        await document.type(session, " two");
        await updateDocumentSnapshotForTest(session.action(), document.id);
        await document.type(session, " three");
        await document.type(session, " four");

        const response = await server.PUT(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                document: {
                    title: "Renamed Across Snapshot",
                    version: previousVersion,
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Base"}],
                            },
                        ],
                    },
                },
            },
        });

        expect(response).toMatchObject({
            status: 200,
            body: {
                document: expect.objectContaining({
                    title: "Renamed Across Snapshot",
                    content: expect.objectContaining({
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Base one two three four"}],
                            },
                        ],
                    }),
                }),
            },
        });
    });
});

test("can read document with file attachment", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const document = await TestDocument.create(session, {
        title: "Document with File",
        access: "Private",
    });

    const file = await TestFile.create(session);
    await document.attachFile(session, file);

    const response = await server.GET(`/documents/${document.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
    });

    expect(response).toMatchObject({
        status: 200,
        body: {
            document: expect.objectContaining({
                content: expect.objectContaining({
                    elements: expect.arrayContaining([
                        expect.objectContaining({
                            type: "File",
                            id: file.id,
                            contentType: "image/png",
                            contentLength: 5232,
                        }),
                    ]),
                }),
            }),
        },
    });
});
