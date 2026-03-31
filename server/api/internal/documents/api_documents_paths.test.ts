import {Fragment, Mark, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {TestLocalEdgeServiceContextModule} from "~/admin/environment/test/unit/test_local_edge_service_context_module.js";
import {apiDocumentsPaths} from "~/server/api/internal/documents/api_documents_paths.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {DocumentContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

const context = createTestContext({
    chatInjection,
    documentsInjection,
    tasksInjection,
}).cloneWithHelpers({
    edge: new TestLocalEdgeServiceContextModule({
        // We don't need to broadcast anything in these tests.
        pushDurableObjectBroadcast: () => {},
        // Swap out the actual durable object request with a mock that returns a known
        // version number.
        pushDurableObjectRequest: () => {
            return {
                newVersion: 1,
            };
        },
    }),
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

    test("returns 400 when version is stale", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const document = await TestDocument.create(session, {
            title: "Stale Version Test",
            body: "Some content.",
            access: "Public",
        });

        const response = await server.PUT(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                document: {
                    title: "Stale Version Test",
                    version: (await document.getVersion()) + 1,
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Some content."}],
                            },
                        ],
                    },
                },
            },
        });

        expect(response).toMatchObject({
            status: 400,
            body: expect.objectContaining({
                error: expect.objectContaining({
                    message: expect.stringMatching(
                        "Can’t update a previous document version. Re-fetch the document and try again.",
                    ),
                }),
            }),
        });
    });
});
