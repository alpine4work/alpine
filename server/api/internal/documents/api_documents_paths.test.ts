import {jest} from "@jest/globals";
import {Fragment, Mark, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {ApiServiceBotActionContext} from "~/server/api/internal/shared/api_service_context.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {createTestWorkerContextFromBaseContext} from "~/server/cloudflare/test_helpers/create_test_worker_context.js";
import {SearchInjection} from "~/server/context/injection_context_module.js";
import {DocumentCollaborationDurableObject} from "~/server/documents/collaboration/document_collaboration_durable_object.js";
import {
    FileDocumentAuthorizer,
    getDocumentPreviewIfPossible,
    updateDocumentSnapshotForTest,
} from "~/server/documents/data/documents_actions.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {attachFileAsUploader, getFileFromAttachment} from "~/server/files/data/files_actions.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {ApiContentKeyEncoder} from "~/shared/api/content/closed_source/api_content_key_encoder.js";
import {DocumentContentProsemirrorSchema as schema} from "~/shared/documents/document_content_schema.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {assertId, generateId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, DocumentId, FileId} from "~/shared/id/types/id_types.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";

const searchInjection: Partial<SearchInjection> = {
    getSearchMentionEntityIfPossible: async (context, spaceId, entityId) => {
        assert(entityId.startsWith("Document:"));
        const documentId = assertId<DocumentId>(entityId.slice("Document:".length));

        const documentResult = await getDocumentPreviewIfPossible(context, documentId, {
            consistency: "StrongWithinCache",
        });
        if (!documentResult) return null;
        if (!documentResult.ok) return {isPrivate: true};
        const document = documentResult.value;

        return {
            isPrivate: false,
            entity: new SearchEntityModel({
                type: "Document",
                title: document.getTitle(),
                document: {
                    id: documentId,
                    version: document.version,
                },
            }),
        };
    },
};

const context = createTestContext({
    chatInjection,
    documentsInjection,
    tasksInjection,
    searchInjection,

    sendRequestToDurableObject: async (actualContext, request) => {
        const match = request.url.match(/^\/api\/durable-objects\/documents\/([^/]+)\//);
        if (!match) return;

        const context = (actualContext as ApiServiceBotActionContext).dynamo
            // Strong consistency isn't required since this logic is test-only. So all requests
            // will be strong consistency implicitly.
            .unexpectStrongReadConsistency();

        return await TestDocumentCollaborationDurableObject.fetchForTest(
            workerContext.botAction(context.actor.getSpaceId(), context.actor.getBotAccountId()),
            match[1]!,
            new Request(request.url, {
                method: "POST",
                body: request.body != null ? JSON.stringify(request.body) : request.body,
            }),
        );
    },
});

const workerContext = createTestWorkerContextFromBaseContext(context);

const TestDocumentCollaborationDurableObject =
    DocumentCollaborationDurableObject.test(workerContext);

// Mock content conversion so an individual test can force it to throw and assert
// the document endpoints translate the failure into a 400 instead of a 500. This
// is more robust than crafting content that happens to be invalid today, since the
// schema may accept more shapes over time. The mocks default to the real
// implementations so every other test is unaffected.
const actualFromApiContentModule =
    await import("../../../../shared/api/content/closed_source/from_api_content.js");
const fromApiContentMock = jest.fn(actualFromApiContentModule.fromApiContent);
const fromApiContentToDocumentChildNodesMock = jest.fn(
    actualFromApiContentModule.fromApiContentToDocumentChildNodes,
);
jest.unstable_mockModule(
    "../../../../shared/api/content/closed_source/from_api_content.js",
    () => ({
        ...actualFromApiContentModule,
        fromApiContent: fromApiContentMock,
        fromApiContentToDocumentChildNodes: fromApiContentToDocumentChildNodesMock,
    }),
);

// Must be dynamically imported after the mock so the handlers use the mocked
// content conversion functions.
const {apiDocumentsPaths} = await import("./api_documents_paths.js");

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

    test("returns a 400 when the document body content can\u2019t be parsed", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        // Force content conversion to fail so we exercise the error-translation path
        // independently of which content shapes the schema accepts.
        fromApiContentToDocumentChildNodesMock.mockImplementationOnce(() => {
            throw new InternalError("Simulated content conversion failure");
        });

        const response = await server.POST("/documents", {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                spaceId: space.id,
                document: {
                    title: "Document with Invalid Body Content",
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

        expect(response).toMatchObject({
            status: 400,
            body: {
                error: expect.objectContaining({
                    message: expect.stringMatching("The document content you provided is invalid."),
                }),
            },
        });
    });

    test("can create a document with an empty title string", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        // An empty title string is represented as a `title` node with no text children, so
        // creating the document succeeds and reads back an empty title.
        const response = await server.POST("/documents", {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                spaceId: space.id,
                document: {
                    title: "",
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

        expect(response).toMatchObject({
            status: 200,
            body: {
                document: expect.objectContaining({
                    title: "",
                }),
            },
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

describe("/documents/{id}-reference", () => {
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
            await server.GET(`/documents/${document.id}-reference`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                reference: {
                    type: "Document",
                    id: document.id,
                    title: "Test Document Title",
                },
            },
        });
    });

    test("can\u2019t read document mention without access", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const session2 = await space.createSession();

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey(session1);

        const document = await TestDocument.create(session2, {access: "Private"});

        expect(
            await server.GET(`/documents/${document.id}-reference`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 403,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message: expect.stringMatching(
                        "You aren\u2019t allowed to access this document.",
                    ),
                }),
            },
        });
    });

    test("can\u2019t read document mention for non-existent document", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        expect(
            await server.GET(`/documents/${generateId<DocumentId>()}-reference`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 404,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message: expect.stringMatching("This document doesn\u2019t exist"),
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
            await server.GET(`/documents/${document.id}-reference`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                reference: {
                    type: "Document",
                    id: document.id,
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
    function textSlice(text: string, marks: ReadonlyArray<Mark> = []) {
        if (text.length === 0) return Slice.empty;
        return new Slice(Fragment.from(schema.text(text, marks)), 0, 0);
    }

    async function getFirstParagraphFromApiDocument(args: {
        documentId: DocumentId;
        apiKey: string;
    }) {
        const response = await server.GET(`/documents/${args.documentId}`, {
            headers: {authorization: `bearer ${args.apiKey}`},
        });

        expect(response.status).toBe(200);

        const paragraph = response.body.document.content.elements[0]!;
        expect(paragraph.type).toBe("Paragraph");
        expect(paragraph.key).toEqual(expect.any(String));

        return paragraph;
    }

    test("returns thread metadata without loading a document preview", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const document = await TestDocument.create(session, {access: "Public"});
        const {range} = await document.type(session, "Commented text");
        const commentThread = await document.createCommentThread(session, range, "Comment");
        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const response = await server.GET(`/documents/${document.id}/threads/${commentThread.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect({
            response,
            hasDocument: "document" in response.body,
            hasPreview: "preview" in response.body.thread,
        }).toMatchObject({
            response: {
                status: 200,
                body: {
                    spaceId: space.id,
                    thread: {
                        id: commentThread.id,
                        isResolved: false,
                        totalMessageCount: 1,
                    },
                },
            },
            hasDocument: false,
            hasPreview: false,
        });
    });

    test("resolves a comment thread", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const document = await TestDocument.create(session, {access: "Public"});
        const {range} = await document.type(session, "Commented text");
        const commentThread = await document.createCommentThread(session, range, "Comment");
        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const response = await server.PATCH(
            `/documents/${document.id}/threads/${commentThread.id}`,
            {
                headers: {authorization: `bearer ${apiKey}`},
                body: {patches: [{type: "Resolve"}]},
            },
        );

        expect({response, commentThread: await commentThread.get()}).toMatchObject({
            response: {
                status: 200,
                body: {
                    spaceId: space.id,
                    thread: {id: commentThread.id, isResolved: true},
                },
            },
            commentThread: {isResolved: true},
        });
    });

    test("unresolves a comment thread", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const document = await TestDocument.create(session, {access: "Public"});
        const {range} = await document.type(session, "Commented text");
        const commentThread = await document.createCommentThread(session, range, "Comment");
        await commentThread.resolve(session);
        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const response = await server.PATCH(
            `/documents/${document.id}/threads/${commentThread.id}`,
            {
                headers: {authorization: `bearer ${apiKey}`},
                body: {patches: [{type: "Unresolve"}]},
            },
        );

        expect({response, commentThread: await commentThread.get()}).toMatchObject({
            response: {
                status: 200,
                body: {
                    spaceId: space.id,
                    thread: {id: commentThread.id, isResolved: false},
                },
            },
            commentThread: {isResolved: false},
        });
    });

    test("applies resolution patches in request order", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const document = await TestDocument.create(session, {access: "Public"});
        const {range} = await document.type(session, "Commented text");
        const commentThread = await document.createCommentThread(session, range, "Comment");
        const oldVersion = (await document.get()).version;
        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const response = await server.PATCH(
            `/documents/${document.id}/threads/${commentThread.id}`,
            {
                headers: {authorization: `bearer ${apiKey}`},
                body: {patches: [{type: "Resolve"}, {type: "Unresolve"}]},
            },
        );

        expect({response, documentVersion: (await document.get()).version}).toMatchObject({
            response: {
                status: 200,
                body: {thread: {id: commentThread.id, isResolved: false}},
            },
            documentVersion: oldVersion,
        });
    });

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
            await server.GET(`/documents/${document.id}/threads/${commentThread.id}-with-preview`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                thread: expect.objectContaining({
                    id: commentThread.id,
                    isResolved: false,
                    totalMessageCount: 1,
                    preview: {
                        version: await document.getVersion(),
                        contentSnippet: {
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
                                                    thread: {id: commentThread.id},
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
                    },
                }),
                document: expect.objectContaining({id: document.id}),
            },
        });
    });

    test("returns other overlapping comment marks in the current document snippet", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const document = await TestDocument.create(session);
        const {range} = await document.type(session, "Shared text");

        const commentThread = await document.createCommentThread(
            session,
            {from: range.from, to: range.from + 6},
            "First comment",
        );
        const overlappingCommentThread = await document.createCommentThread(
            session,
            {from: range.from + 3, to: range.to},
            "Overlapping comment",
        );

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey({type: "Document", documentId: document.id});

        const response = await server.GET(
            `/documents/${document.id}/threads/${commentThread.id}-with-preview`,
            {headers: {authorization: `bearer ${apiKey}`}},
        );

        expect(response).toMatchObject({
            status: 200,
            body: {
                thread: {
                    id: commentThread.id,
                    preview: {
                        contentSnippet: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {
                                            type: "Text",
                                            text: "Sha",
                                            marks: [
                                                {
                                                    type: "Comment",
                                                    thread: {id: commentThread.id},
                                                },
                                            ],
                                        },
                                        {
                                            type: "Text",
                                            text: "red",
                                            marks: expect.arrayContaining([
                                                {
                                                    type: "Comment",
                                                    thread: {id: commentThread.id},
                                                },
                                                {
                                                    type: "Comment",
                                                    thread: {
                                                        id: overlappingCommentThread.id,
                                                    },
                                                },
                                            ]),
                                        },
                                        {
                                            type: "Text",
                                            text: " text",
                                            marks: [
                                                {
                                                    type: "Comment",
                                                    thread: {
                                                        id: overlappingCommentThread.id,
                                                    },
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    },
                },
            },
        });
    });

    test("returns snippet cut to the lines around the commented block", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        // Surround the commented paragraph with paragraphs long enough to overflow the
        // snippet line budget in both directions. The snippet should start and end in the
        // middle of the document and expand to whole paragraphs.
        const document = await TestDocument.create(session, {
            content: [
                schema.node("title", {}, [schema.text("Test Document")]),
                schema.node("paragraph", {}, [schema.text("First paragraph.")]),
                schema.node("paragraph", {}, [
                    schema.text("a".repeat(300)),
                    schema.text("b".repeat(300), [schema.mark("bold")]),
                    schema.text("c".repeat(300)),
                ]),
                schema.node("paragraph", {}, [schema.text("Commented paragraph.")]),
                schema.node("paragraph", {}, [schema.text("d".repeat(2500))]),
                schema.node("paragraph", {}, [schema.text("Last paragraph.")]),
            ],
        });

        const documentContent = await document.getContent();

        let commentRange: {from: number; to: number} | undefined;
        documentContent.descendants((node, pos) => {
            if (node.isText && node.text === "Commented paragraph.") {
                commentRange = {from: pos, to: pos + node.nodeSize};
            }
        });

        const commentThread = await document.createCommentThread(
            session,
            assertExists(commentRange),
            "test1",
        );

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey({type: "Document", documentId: document.id});

        const response = await server.GET(
            `/documents/${document.id}/threads/${commentThread.id}-with-preview`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );
        assert(response.status === 200);

        const snippetElements = response.body.thread.preview.contentSnippet.elements;
        assert(Array.isArray(snippetElements));

        const elementText = (element: {elements: Array<{text: string}>}) =>
            element.elements.map(inlineElement => inlineElement.text).join("");

        // The snippet is cut to a couple lines above the commented block and a few lines
        // below it. The lines above cover the whole previous paragraph while the long
        // trailing paragraph is cut mid-paragraph before the following "Last paragraph."
        // block. Content snippets don't include keys.
        expect(
            snippetElements.map(element => ({
                type: element.type,
                text: elementText(element),
                isCut: elementText(element).length < 2500,
            })),
        ).toEqual([
            {
                type: "Paragraph",
                text: "a".repeat(300) + "b".repeat(300) + "c".repeat(300),
                isCut: true,
            },
            {
                type: "Paragraph",
                text: "Commented paragraph.",
                isCut: true,
            },
            {
                type: "Paragraph",
                text: expect.stringMatching(/^d+$/),
                isCut: true,
            },
        ]);
    });

    test("returns the same content in the snippet as the document content", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        // The two leading long paragraphs overflow the snippet line budget so the snippet
        // starts at the second paragraph instead of the document start.
        const document = await TestDocument.create(session, {
            content: [
                schema.node("title", {}, [schema.text("Test Document")]),
                schema.node("paragraph", {}, [schema.text("x".repeat(700))]),
                schema.node("paragraph", {}, [schema.text("y".repeat(700))]),
                schema.node("paragraph", {}, [schema.text("Commented paragraph.")]),
                schema.node("paragraph", {}, [schema.text("Last paragraph.")]),
            ],
        });

        const documentContent = await document.getContent();

        let commentRange: {from: number; to: number} | undefined;
        documentContent.descendants((node, pos) => {
            if (node.isText && node.text === "Commented paragraph.") {
                commentRange = {from: pos, to: pos + node.nodeSize};
            }
        });

        const commentThread = await document.createCommentThread(
            session,
            assertExists(commentRange),
            "test1",
        );

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey({type: "Document", documentId: document.id});

        const documentResponse = await server.GET(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        });
        assert(documentResponse.status === 200);

        const threadResponse = await server.GET(
            `/documents/${document.id}/threads/${commentThread.id}-with-preview`,
            {headers: {authorization: `bearer ${apiKey}`}},
        );
        assert(threadResponse.status === 200);

        const documentElements = documentResponse.body.document.content.elements;
        const snippetElements = threadResponse.body.thread.preview.contentSnippet.elements;
        assert(Array.isArray(documentElements));
        assert(Array.isArray(snippetElements));

        const elementText = (element: {elements: Array<{text: string}>}) =>
            element.elements.map(inlineElement => inlineElement.text.slice(0, 12)).join("");

        // The snippet skips the first paragraph and contains the rest of the document.
        expect(snippetElements.map(elementText)).toEqual(
            documentElements.slice(1).map(elementText),
        );
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
            await server.GET(`/documents/${document.id}/threads/${commentThread.id}-with-preview`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                thread: expect.objectContaining({
                    id: commentThread.id,
                    isResolved: false,
                    totalMessageCount: 1,
                    preview: {
                        version: (await document.getVersion()) - 1,
                        contentSnippet: {
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
                                                    thread: {id: commentThread.id},
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
                    },
                }),
                document: expect.objectContaining({id: document.id}),
            },
        });
    });

    test("returns other overlapping comment marks in a fallback snippet", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const document = await TestDocument.create(session);
        const {range} = await document.type(session, "Shared text");

        const overlappingCommentThread = await document.createCommentThread(
            session,
            {from: range.from + 3, to: range.to},
            "Overlapping comment",
        );
        const commentThread = await document.createCommentThread(
            session,
            {from: range.from, to: range.from + 6},
            "First comment",
        );

        await document.update(session, [
            new ReplaceStep(range.from, range.from + 6, textSlice("")),
        ]);

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey({type: "Document", documentId: document.id});

        const response = await server.GET(
            `/documents/${document.id}/threads/${commentThread.id}-with-preview`,
            {headers: {authorization: `bearer ${apiKey}`}},
        );

        expect(response).toMatchObject({
            status: 200,
            body: {
                thread: {
                    id: commentThread.id,
                    preview: {
                        contentSnippet: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {
                                            type: "Text",
                                            text: "Sha",
                                            marks: [
                                                {
                                                    type: "Comment",
                                                    thread: {id: commentThread.id},
                                                },
                                            ],
                                        },
                                        {
                                            type: "Text",
                                            text: "red",
                                            marks: expect.arrayContaining([
                                                {
                                                    type: "Comment",
                                                    thread: {
                                                        id: overlappingCommentThread.id,
                                                    },
                                                },
                                                {
                                                    type: "Comment",
                                                    thread: {id: commentThread.id},
                                                },
                                            ]),
                                        },
                                        {
                                            type: "Text",
                                            text: " text",
                                            marks: [
                                                {
                                                    type: "Comment",
                                                    thread: {
                                                        id: overlappingCommentThread.id,
                                                    },
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    },
                },
            },
        });
    });

    test("returns fallback snippet with the version the snippet was saved from", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        // Remove the commented text so the comment thread falls back to the snippet saved
        // from the version before the removal.
        await document.update(session, [new ReplaceStep(range.from, range.to, textSlice(""))]);
        const fallbackVersion = (await document.getVersion()) - 1;

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey({type: "Document", documentId: document.id});

        const response = await server.GET(
            `/documents/${document.id}/threads/${commentThread.id}-with-preview`,
            {
                headers: {authorization: `bearer ${apiKey}`},
            },
        );
        assert(response.status === 200);

        expect(response.body.thread.preview.version).toBe(fallbackVersion);
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
            await server.GET(`/documents/${document.id}/threads/${commentThread.id}-with-preview`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                thread: expect.objectContaining({
                    id: commentThread.id,
                    isResolved: true,
                    totalMessageCount: 1,
                    preview: {
                        version: expect.any(Number),
                        contentSnippet: {
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
                                                    thread: {id: commentThread.id},
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
                    },
                }),
                document: expect.objectContaining({id: document.id}),
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
            await server.GET(`/documents/${document.id}/threads/${commentThread.id}-with-preview`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                thread: expect.objectContaining({
                    id: commentThread.id,
                    isResolved: true,
                    totalMessageCount: 1,
                    preview: {
                        version: expect.any(Number),
                        contentSnippet: {
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
                                                    thread: {id: commentThread.id},
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
                    },
                }),
                document: expect.objectContaining({id: document.id}),
            },
        });
    });

    test("can add a comment to document text from inline API positions", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const document = await TestDocument.create(session);
        const emoji = "👨‍👩‍👧‍👦";
        await document.type(session, `A${emoji}B`);

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey({type: "Document", documentId: document.id});

        const getDocumentResponse = await server.GET(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect(getDocumentResponse.status).toBe(200);

        const paragraph = getDocumentResponse.body.document.content.elements[0]!;
        expect(paragraph.type).toBe("Paragraph");
        expect(paragraph.key).toEqual(expect.any(String));

        const emojiStartIndex = Array.from("A").length;
        const emojiEndIndex = emojiStartIndex + Array.from(emoji).length - 1;

        const createThreadResponse = await server.POST(`/documents/${document.id}/threads`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                thread: {
                    range: {
                        start: {type: "Inline", key: paragraph.key, index: emojiStartIndex},
                        end: {type: "Inline", key: paragraph.key, index: emojiEndIndex},
                    },
                    firstMessage: {
                        content: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "grapheme comment"}],
                                },
                            ],
                        },
                    },
                },
            },
        });

        expect(createThreadResponse.status).toBe(200);
        expect(createThreadResponse.headers).toEqual(
            expect.objectContaining({"content-type": "application/json"}),
        );
        expect(createThreadResponse.body.spaceId).toBe(space.id);
        expect(createThreadResponse.body.document).toEqual({
            id: document.id,
            version: expect.any(Number),
        });
        expect(createThreadResponse.body.thread).toEqual(
            expect.objectContaining({
                id: expect.any(String),
                isResolved: false,
                commentCount: 1,
                documentContentSnippet: {
                    elements: [
                        {
                            type: "Paragraph",
                            key: expect.any(String),
                            elements: [
                                {type: "Text", text: "A"},
                                {
                                    type: "Text",
                                    text: emoji,
                                    marks: [
                                        {
                                            type: "Comment",
                                            threadId: expect.any(String),
                                        },
                                    ],
                                },
                                {type: "Text", text: "B"},
                            ],
                        },
                    ],
                },
            }),
        );
        expect(createThreadResponse.body.message).toEqual(
            expect.objectContaining({
                index: 0,
                payload: expect.objectContaining({
                    type: "Content",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                key: expect.any(String),
                                elements: [{type: "Text", text: "grapheme comment"}],
                            },
                        ],
                    },
                }),
            }),
        );

        const createdCommentThreadId = createThreadResponse.body.thread.id;

        expect((await document.get()).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [
                        schema.text("A"),
                        schema.text("👨‍👩‍👧‍👦", [
                            schema.mark("comment", {
                                commentThreadId: createdCommentThreadId,
                            }),
                        ]),
                        schema.text("B"),
                    ]),
                ])
                .toJSON(),
        );
    });

    test("creates back-to-back comments across varied document content", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const [file1, file2, file3] = await runAllPromises([
            TestFile.create(session),
            TestFile.create(session),
            TestFile.create(session),
        ]);
        const document = await TestDocument.create(session, {
            content: [
                schema.node("title", {}, [schema.text("Test Document")]),
                schema.node("heading", {level: 2}, [schema.text("Section heading")]),
                schema.node("paragraph", {}, [schema.text("First paragraph")]),
                schema.node("paragraph", {}, [schema.text("Second paragraph")]),
                schema.node("table", {}, [
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("Cell one")]),
                        ]),
                        schema.node("tableCell", {}, [
                            schema.node("paragraph", {}, [schema.text("Cell two")]),
                        ]),
                    ]),
                ]),
                schema.node("paragraph", {}, [schema.text("After table")]),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1.id}),
                    schema.node("file", {fileId: file2.id}),
                    schema.node("file", {fileId: file3.id}),
                ]),
                schema.node("paragraph", {}, [schema.text("After files")]),
            ],
        });
        await runAllPromises(
            [file1, file2, file3].map(file =>
                attachFileAsUploader(
                    session.action(),
                    file.id,
                    FileDocumentAuthorizer.bind({type: "Document", documentId: document.id}),
                ),
            ),
        );

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey({type: "Document", documentId: document.id});
        const getDocumentResponse = await server.GET(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        });
        assert(getDocumentResponse.status === 200);

        const [
            heading,
            firstParagraph,
            secondParagraph,
            table,
            afterTable,
            fileGallery,
            afterFiles,
        ] = getDocumentResponse.body.document.content.elements;
        assert(heading?.type === "Heading");
        assert(firstParagraph?.type === "Paragraph");
        assert(secondParagraph?.type === "Paragraph");
        assert(table?.type === "Table");
        assert(afterTable?.type === "Paragraph");
        assert(fileGallery?.type === "FileGallery");
        assert(afterFiles?.type === "Paragraph");

        const cellOne = table.rows[0]?.cells[0]?.elements[0];
        const cellTwo = table.rows[0]?.cells[1]?.elements[0];
        assert(cellOne?.type === "Paragraph");
        assert(cellTwo?.type === "Paragraph");

        const firstFile = fileGallery.rows[0]?.items[0]?.element;
        const secondFile = fileGallery.rows[0]?.items[1]?.element;
        const thirdFile = fileGallery.rows[0]?.items[2]?.element;
        assert(firstFile?.type === "File" && firstFile.id === file1.id);
        assert(secondFile?.type === "File" && secondFile.id === file2.id);
        assert(thirdFile?.type === "File" && thirdFile.id === file3.id);

        // Every request intentionally uses keys from the initial GET. Each preceding
        // comment makes those keys stale and exercises collaboration rebasing. Together
        // the ranges cover single blocks, overlapping marks, nested table content, and
        // every direction across the inline-to-leaf-node boundary.
        const comments = [
            {
                text: "Heading comment",
                range: {
                    start: {type: "Inline" as const, key: heading.key, index: 0},
                    end: {
                        type: "Inline" as const,
                        key: heading.key,
                        index: "Section heading".length - 1,
                    },
                },
            },
            {
                text: "First overlapping comment",
                range: {
                    start: {type: "Inline" as const, key: firstParagraph.key, index: 0},
                    end: {type: "Inline" as const, key: firstParagraph.key, index: 4},
                },
            },
            {
                text: "Second overlapping comment",
                range: {
                    start: {type: "Inline" as const, key: firstParagraph.key, index: 2},
                    end: {type: "Inline" as const, key: firstParagraph.key, index: 7},
                },
            },
            {
                text: "Multiple paragraphs",
                range: {
                    start: {type: "Inline" as const, key: firstParagraph.key, index: 0},
                    end: {
                        type: "Inline" as const,
                        key: secondParagraph.key,
                        index: "Second paragraph".length - 1,
                    },
                },
            },
            {
                text: "Table cell comment",
                range: {
                    start: {type: "Inline" as const, key: cellOne.key, index: 0},
                    end: {
                        type: "Inline" as const,
                        key: cellOne.key,
                        index: "Cell one".length - 1,
                    },
                },
            },
            {
                text: "Text through table to text",
                range: {
                    start: {type: "Inline" as const, key: secondParagraph.key, index: 0},
                    end: {
                        type: "Inline" as const,
                        key: afterTable.key,
                        index: "After table".length - 1,
                    },
                },
            },
            {
                text: "Multiple files",
                range: {
                    start: {type: "Before" as const, key: firstFile.key},
                    end: {type: "After" as const, key: thirdFile.key},
                },
            },
            {
                text: "Text to file",
                range: {
                    start: {type: "Inline" as const, key: afterTable.key, index: 0},
                    end: {type: "After" as const, key: firstFile.key},
                },
            },
            {
                text: "File to text",
                range: {
                    start: {type: "Before" as const, key: secondFile.key},
                    end: {
                        type: "Inline" as const,
                        key: afterFiles.key,
                        index: "After files".length - 1,
                    },
                },
            },
        ];

        const responses = [];
        for (const comment of comments) {
            responses.push(
                await server.POST(`/documents/${document.id}/threads`, {
                    headers: {authorization: `bearer ${apiKey}`},
                    body: {
                        thread: {
                            range: comment.range,
                            firstMessage: {
                                content: {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: comment.text}],
                                        },
                                    ],
                                },
                            },
                        },
                    },
                }),
            );
        }

        for (const response of responses) assert(response.status === 200);

        const [
            headingId,
            firstOverlapId,
            secondOverlapId,
            multipleParagraphsId,
            tableCellId,
            textTableTextId,
            multipleFilesId,
            textToFileId,
            fileToTextId,
        ] = responses.map(response => response.body.thread.id);
        assert(
            headingId !== undefined &&
                firstOverlapId !== undefined &&
                secondOverlapId !== undefined &&
                multipleParagraphsId !== undefined &&
                tableCellId !== undefined &&
                textTableTextId !== undefined &&
                multipleFilesId !== undefined &&
                textToFileId !== undefined &&
                fileToTextId !== undefined,
        );

        const commentThreadIdsByText = new Map<string, Set<DocumentCommentThreadId>>();
        const commentThreadIdsByFileId = new Map<FileId, Set<DocumentCommentThreadId>>();
        (await document.get()).content.doc.descendants((node, _pos, parent) => {
            const commentThreadIds = node.marks
                .filter(mark => mark.type.name === "comment")
                .map(mark =>
                    assertId<DocumentCommentThreadId>(mark.attrs.commentThreadId as string),
                );

            if (
                node.isText &&
                (parent?.type.name === "paragraph" || parent?.type.name === "heading")
            ) {
                const ids = commentThreadIdsByText.get(parent.textContent) ?? new Set();
                for (const commentThreadId of commentThreadIds) ids.add(commentThreadId);
                commentThreadIdsByText.set(parent.textContent, ids);
            }

            if (node.type.name === "file") {
                const fileId = assertId<FileId>(node.attrs.fileId as string);
                const ids = commentThreadIdsByFileId.get(fileId) ?? new Set();
                for (const commentThreadId of commentThreadIds) ids.add(commentThreadId);
                commentThreadIdsByFileId.set(fileId, ids);
            }
        });

        const sortedIds = (ids: Iterable<DocumentCommentThreadId> | undefined) =>
            Array.from(ids ?? []).sort();

        expect({
            responses: responses.map(response => ({
                status: response.status,
                messageIndex: response.body.message.index,
                hasSnippet: response.body.thread.documentContentSnippet.elements.length > 0,
            })),
            text: Object.fromEntries(
                Array.from(commentThreadIdsByText, ([text, ids]) => [text, sortedIds(ids)]),
            ),
            files: Object.fromEntries(
                Array.from(commentThreadIdsByFileId, ([fileId, ids]) => [fileId, sortedIds(ids)]),
            ),
        }).toEqual({
            responses: comments.map(() => ({
                status: 200,
                messageIndex: 0,
                hasSnippet: true,
            })),
            text: {
                "Section heading": [headingId],
                "First paragraph": sortedIds([
                    firstOverlapId,
                    secondOverlapId,
                    multipleParagraphsId,
                ]),
                "Second paragraph": sortedIds([multipleParagraphsId, textTableTextId]),
                "Cell one": sortedIds([tableCellId, textTableTextId]),
                "Cell two": [textTableTextId],
                "After table": sortedIds([textTableTextId, textToFileId]),
                "After files": [fileToTextId],
            },
            files: {
                [file1.id]: sortedIds([multipleFilesId, textToFileId]),
                [file2.id]: sortedIds([multipleFilesId, fileToTextId]),
                [file3.id]: sortedIds([multipleFilesId, fileToTextId]),
            },
        });
    });

    test("can create a document comment thread with file attachments", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const document = await TestDocument.create(session);
        await document.type(session, "Hello");

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey({type: "Document", documentId: document.id});

        const paragraph = await getFirstParagraphFromApiDocument({
            documentId: document.id,
            apiKey,
        });

        const file = await TestFile.create(session);
        await document.attachFile(session, file);

        const response = await server.POST(`/documents/${document.id}/threads`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                thread: {
                    range: {
                        start: {type: "Inline", key: paragraph.key, index: 0},
                        end: {type: "Inline", key: paragraph.key, index: 4},
                    },
                    firstMessage: {
                        content: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Comment with file"}],
                                },
                            ],
                        },
                        files: [{element: {type: "File", id: file.id}}],
                    },
                },
            },
        });

        expect(response).toMatchObject({
            status: 200,
            body: {
                message: expect.objectContaining({
                    index: 0,
                    payload: expect.objectContaining({
                        type: "Content",
                        files: [
                            expect.objectContaining({
                                rowIndex: 0,
                                width: 1,
                                element: {
                                    type: "File",
                                    id: file.id,
                                    contentType: expect.any(String),
                                    contentLength: expect.any(Number),
                                },
                            }),
                        ],
                    }),
                }),
            },
        });
    });

    test("does not attach files to document comments without comment access", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const viewerSession = await space.createSession();

        const bot = await TestBot.createAndInstantiate(session);
        const document = await TestDocument.create(session, {access: "Private"});
        await document.type(session, "Hello");
        await document.access.grant(session, viewerSession, "View");

        const apiKey = await bot.createApiKey(viewerSession);

        const encoder = new ApiContentKeyEncoder({
            entityId: `Document:${document.id}`,
            version: await document.getVersion(),
        });
        let paragraphKey = null;
        (await document.getContent()).descendants((node, pos) => {
            if (node.type.name !== "paragraph") return;
            paragraphKey = encoder.encode({pos, nodeSize: node.nodeSize});
            return false;
        });
        assert(paragraphKey !== null);

        const file = await TestFile.create(session);
        await document.attachFile(session, file);

        expect(
            await server.POST(`/documents/${document.id}/threads`, {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    thread: {
                        range: {
                            start: {type: "Inline", key: paragraphKey, index: 0},
                            end: {type: "Inline", key: paragraphKey, index: 4},
                        },
                        firstMessage: {
                            content: {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Comment with file"}],
                                    },
                                ],
                            },
                            files: [{element: {type: "File", id: file.id}}],
                        },
                    },
                },
            }),
        ).toEqual({
            status: 403,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message: expect.stringContaining("comment"),
                }),
            },
        });

        await expect(
            getFileFromAttachment(
                space.systemAction(),
                file.id,
                FileDocumentAuthorizer.bind({
                    type: "DocumentComments",
                    documentId: document.id,
                }),
                {consistency: "Strong"},
            ),
        ).rejects.toThrow("File isn\u2019t attached to target");
    });

    test("does not attach files when target range validation fails", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const document = await TestDocument.create(session);
        await document.type(session, "Hello");

        const apiKey = await bot.createApiKey({type: "Document", documentId: document.id});
        const paragraph = await getFirstParagraphFromApiDocument({
            documentId: document.id,
            apiKey,
        });

        const file = await TestFile.create(session);
        await document.attachFile(session, file);

        expect(
            await server.POST(`/documents/${document.id}/threads`, {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    thread: {
                        range: {
                            start: {type: "Inline", key: paragraph.key, index: 1},
                            end: {type: "Inline", key: paragraph.key, index: 0},
                        },
                        firstMessage: {
                            content: {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Comment with file"}],
                                    },
                                ],
                            },
                            files: [{element: {type: "File", id: file.id}}],
                        },
                    },
                },
            }),
        ).toMatchObject({
            status: 400,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message: expect.stringContaining(
                        "Item target range start must be before the end",
                    ),
                }),
            },
        });

        await expect(
            getFileFromAttachment(
                space.systemAction(),
                file.id,
                FileDocumentAuthorizer.bind({
                    type: "DocumentComments",
                    documentId: document.id,
                }),
                {consistency: "Strong"},
            ),
        ).rejects.toThrow("File isn\u2019t attached to target");
    });

    test("returns collaboration service range validation errors as a 400", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const document = await TestDocument.create(session);
        await document.type(session, "Hello");

        const apiKey = await bot.createApiKey({type: "Document", documentId: document.id});
        const paragraph = await getFirstParagraphFromApiDocument({
            documentId: document.id,
            apiKey,
        });

        expect(
            await server.POST(`/documents/${document.id}/threads`, {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    thread: {
                        range: {
                            start: {type: "Inline", key: paragraph.key, index: 4},
                            end: {type: "Inline", key: paragraph.key, index: 0},
                        },
                        firstMessage: {
                            content: {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Comment"}],
                                    },
                                ],
                            },
                        },
                    },
                },
            }),
        ).toMatchObject({
            status: 400,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message: expect.stringContaining(
                        "Item target range start must be before the end",
                    ),
                }),
            },
        });
    });

    test("can create a document comment thread on a file node", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const document = await TestDocument.create(session);
        const file = await TestFile.create(session);
        await document.attachFile(session, file);

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey({type: "Document", documentId: document.id});

        const getDocumentResponse = await server.GET(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect(getDocumentResponse.status).toBe(200);

        let fileElement = null;
        for (const element of getDocumentResponse.body.document.content.elements) {
            if (element.type === "File" && element.id === file.id) {
                fileElement = element;
                break;
            }
        }
        assert(fileElement?.type === "File");
        assert(fileElement.key !== undefined);

        const createThreadResponse = await server.POST(`/documents/${document.id}/threads`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                thread: {
                    range: {
                        start: {type: "Before", key: fileElement.key},
                        end: {type: "After", key: fileElement.key},
                    },
                    firstMessage: {
                        content: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "file comment"}],
                                },
                            ],
                        },
                    },
                },
            },
        });

        expect(createThreadResponse.status).toBe(200);

        const createdCommentThreadId = createThreadResponse.body.thread.id;
        let fileCommentThreadId = null;
        (await document.get()).content.doc.descendants(node => {
            if (node.type.name !== "file" || node.attrs.fileId !== file.id) return;

            fileCommentThreadId =
                node.marks.find(mark => mark.type.name === "comment")?.attrs.commentThreadId ??
                null;
        });

        expect(fileCommentThreadId).toBe(createdCommentThreadId);
    });

    test("can create a document comment thread from a stale API range version", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const document = await TestDocument.create(session);
        await document.type(session, "Hello");

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey({type: "Document", documentId: document.id});

        const staleParagraph = await getFirstParagraphFromApiDocument({
            documentId: document.id,
            apiKey,
        });

        await document.type(session, " world");

        const createThreadResponse = await server.POST(`/documents/${document.id}/threads`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                thread: {
                    range: {
                        start: {type: "Inline", key: staleParagraph.key, index: 0},
                        end: {type: "Inline", key: staleParagraph.key, index: 4},
                    },
                    firstMessage: {
                        content: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "stale range comment"}],
                                },
                            ],
                        },
                    },
                },
            },
        });

        expect(createThreadResponse.status).toBe(200);

        const createdCommentThreadId = createThreadResponse.body.thread.id;

        expect((await document.get()).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [
                        schema.text("Hello", [
                            schema.mark("comment", {
                                commentThreadId: createdCommentThreadId,
                            }),
                        ]),
                        schema.text(" world"),
                    ]),
                ])
                .toJSON(),
        );
    });

    test("trims whitespace from a document comment range", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const document = await TestDocument.create(session);
        await document.type(session, "  hello  ");

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey({type: "Document", documentId: document.id});

        const paragraph = await getFirstParagraphFromApiDocument({
            documentId: document.id,
            apiKey,
        });

        const createThreadResponse = await server.POST(`/documents/${document.id}/threads`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                thread: {
                    range: {
                        start: {type: "Inline", key: paragraph.key, index: 0},
                        end: {type: "Inline", key: paragraph.key, index: 8},
                    },
                    firstMessage: {
                        content: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "whitespace range comment"}],
                                },
                            ],
                        },
                    },
                },
            },
        });

        expect(createThreadResponse.status).toBe(200);

        const createdCommentThreadId = createThreadResponse.body.thread.id;

        expect((await document.get()).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [
                        schema.text("  "),
                        schema.text("hello", [
                            schema.mark("comment", {
                                commentThreadId: createdCommentThreadId,
                            }),
                        ]),
                        schema.text("  "),
                    ]),
                ])
                .toJSON(),
        );
    });

    test("rejects document comment target ranges from different document versions", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const document = await TestDocument.create(session);
        await document.type(session, "Hello");

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey({type: "Document", documentId: document.id});

        const staleParagraph = await getFirstParagraphFromApiDocument({
            documentId: document.id,
            apiKey,
        });

        await document.type(session, " world");

        const currentParagraph = await getFirstParagraphFromApiDocument({
            documentId: document.id,
            apiKey,
        });

        expect(
            await server.POST(`/documents/${document.id}/threads`, {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    thread: {
                        range: {
                            start: {type: "Inline", key: staleParagraph.key, index: 0},
                            end: {type: "Inline", key: currentParagraph.key, index: 4},
                        },
                        firstMessage: {
                            content: {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "mixed version comment"}],
                                    },
                                ],
                            },
                        },
                    },
                },
            }),
        ).toEqual({
            status: 400,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message: expect.stringContaining("same item version"),
                }),
            },
        });
    });

    test("rejects document comment target ranges from a different document", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const document = await TestDocument.create(session, {
            id: assertId<DocumentId>("2hxv0y1b6zye9q87w2bt7fks3g"),
        });
        await document.type(session, "Hello");

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey({type: "Document", documentId: document.id});
        const otherDocumentContentKey = "6Z47u2ZI";

        expect(
            await server.POST(`/documents/${document.id}/threads`, {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    thread: {
                        range: {
                            start: {type: "Inline", key: otherDocumentContentKey, index: 0},
                            end: {type: "Inline", key: otherDocumentContentKey, index: 4},
                        },
                        firstMessage: {
                            content: {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "wrong document comment"}],
                                    },
                                ],
                            },
                        },
                    },
                },
            }),
        ).toEqual({
            status: 400,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message:
                        "Content key is for a different document. Try again with a string from an `element.key` in the document you\u2019re trying to reference.",
                }),
            },
        });
    });

    test("rejects whitespace-only document comment ranges", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const document = await TestDocument.create(session);
        await document.type(session, "  hello");

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey({type: "Document", documentId: document.id});

        const paragraph = await getFirstParagraphFromApiDocument({
            documentId: document.id,
            apiKey,
        });

        expect(
            await server.POST(`/documents/${document.id}/threads`, {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    thread: {
                        range: {
                            start: {type: "Inline", key: paragraph.key, index: 0},
                            end: {type: "Inline", key: paragraph.key, index: 1},
                        },
                        firstMessage: {
                            content: {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "whitespace comment"}],
                                    },
                                ],
                            },
                        },
                    },
                },
            }),
        ).toMatchObject({
            status: 400,
            body: {
                error: expect.objectContaining({
                    message: expect.stringContaining("non-space character"),
                }),
            },
        });
    });

    test("rejects reversed document comment target ranges", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const document = await TestDocument.create(session);
        await document.type(session, "Hello");

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey({type: "Document", documentId: document.id});

        const paragraph = await getFirstParagraphFromApiDocument({
            documentId: document.id,
            apiKey,
        });

        expect(
            await server.POST(`/documents/${document.id}/threads`, {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    thread: {
                        range: {
                            start: {type: "Inline", key: paragraph.key, index: 2},
                            end: {type: "Inline", key: paragraph.key, index: 1},
                        },
                        firstMessage: {
                            content: {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "collapsed range comment"}],
                                    },
                                ],
                            },
                        },
                    },
                },
            }),
        ).toEqual({
            status: 400,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message: expect.stringContaining("start must be before the end"),
                }),
            },
        });
    });

    test("rejects document comment target ranges with out-of-bounds API indexes", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const document = await TestDocument.create(session);
        await document.type(session, "Hi");

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey({type: "Document", documentId: document.id});

        const paragraph = await getFirstParagraphFromApiDocument({
            documentId: document.id,
            apiKey,
        });

        expect(
            await server.POST(`/documents/${document.id}/threads`, {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    thread: {
                        range: {
                            start: {type: "Inline", key: paragraph.key, index: 0},
                            end: {type: "Inline", key: paragraph.key, index: 5},
                        },
                        firstMessage: {
                            content: {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "out of bounds comment"}],
                                    },
                                ],
                            },
                        },
                    },
                },
            }),
        ).toEqual({
            status: 400,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message: expect.stringContaining("out of bounds"),
                }),
            },
        });
    });

    test("counts a mention as one API index in document comment target ranges", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const document = await TestDocument.create(session, {
            content: [
                schema.node("title"),
                schema.node("paragraph", {}, [
                    schema.node("mention", {
                        mention: {
                            type: "Account",
                            accountId: session.account.id,
                            isShort: false,
                        },
                    }),
                    schema.text(" says hi"),
                ]),
            ],
        });

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey({type: "Document", documentId: document.id});

        const paragraph = await getFirstParagraphFromApiDocument({
            documentId: document.id,
            apiKey,
        });

        expect(paragraph.elements[0]!.type).toBe("Mention");
        expect(paragraph.elements[0]!.title!.length).toBeGreaterThan(2);

        const createThreadResponse = await server.POST(`/documents/${document.id}/threads`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                thread: {
                    range: {
                        start: {type: "Inline", key: paragraph.key, index: 0},
                        end: {type: "Inline", key: paragraph.key, index: 0},
                    },
                    firstMessage: {
                        content: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "mention comment"}],
                                },
                            ],
                        },
                    },
                },
            },
        });

        expect(createThreadResponse.status).toBe(200);

        const createdCommentThreadId = createThreadResponse.body.thread.id;

        expect((await document.get()).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [
                        schema.node(
                            "mention",
                            {
                                mention: {
                                    type: "Account",
                                    accountId: session.account.id,
                                    isShort: false,
                                },
                            },
                            [],
                            [
                                schema.mark("comment", {
                                    commentThreadId: createdCommentThreadId,
                                }),
                            ],
                        ),
                        schema.text(" says hi"),
                    ]),
                ])
                .toJSON(),
        );
    });
});

describe("PATCH /documents/{id}", () => {
    test("rejects more than one SetTitle patch with a helpful message", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);
        const document = await TestDocument.create(session);

        const response = await server.PATCH(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [
                    {type: "SetTitle", version: 0, title: "First title"},
                    {type: "SetTitle", version: 0, title: "Second title"},
                ],
            },
        });

        expect(response).toMatchObject({
            status: 400,
            body: {
                error: expect.objectContaining({
                    message: expect.stringMatching(
                        "You can only include one `SetTitle` patch when updating a document",
                    ),
                }),
            },
        });
    });

    test("rejects more than one SetContent patch with a helpful message", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);
        const document = await TestDocument.create(session);

        const response = await server.PATCH(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [
                    {type: "SetContent", version: 0, content: {elements: []}},
                    {type: "SetContent", version: 0, content: {elements: []}},
                ],
            },
        });

        expect(response).toMatchObject({
            status: 400,
            body: {
                error: expect.objectContaining({
                    message: expect.stringMatching(
                        "You can only include one `SetContent` patch when updating a document",
                    ),
                }),
            },
        });
    });

    test("rejects title and content patches with different versions", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);
        const document = await TestDocument.create(session);

        const response = await server.PATCH(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [
                    {type: "SetTitle", version: 0, title: "Updated title"},
                    {type: "SetContent", version: 1, content: {elements: []}},
                ],
            },
        });

        expect(response).toMatchObject({
            status: 400,
            body: {
                error: expect.objectContaining({
                    message: expect.stringMatching(
                        "the `SetTitle` and `SetContent` patches must use the same `version`",
                    ),
                }),
            },
        });
    });

    test("no-op PATCH returns the unchanged document", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const document = await TestDocument.create(session, {
            title: "No-op Test",
            body: "Stable content.",
            access: "Public",
        });

        const response = await server.PATCH(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [
                    {
                        type: "SetContent",
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
                ],
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

    test("PATCH returns the updated document", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const document = await TestDocument.create(session, {
            title: "Updated Test",
            body: "Original content.",
            access: "Public",
        });

        const response = await server.PATCH(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [
                    {
                        type: "SetContent",
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
                ],
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

    test("PATCH accepts and ignores content keys from input", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const document = await TestDocument.create(session, {
            title: "Keyed Input Test",
            body: "Original content.",
            access: "Public",
        });

        const response = await server.PATCH(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [
                    {
                        type: "SetContent",
                        version: await document.getVersion(),
                        content: {
                            elements: [
                                {
                                    type: "Heading",
                                    key: "client-heading-key",
                                    level: 2,
                                    elements: [{type: "Text", text: "Updated heading"}],
                                },
                                {
                                    type: "Paragraph",
                                    key: "client-paragraph-key",
                                    elements: [{type: "Text", text: "Updated body."}],
                                },
                            ],
                        },
                    },
                ],
            },
        });

        expect(response).toMatchObject({
            status: 200,
            body: {
                spaceId: space.id,
                document: expect.objectContaining({
                    content: {
                        elements: [
                            {
                                type: "Heading",
                                key: expect.stringMatching(/^(?!client-heading-key$).+/),
                                level: 2,
                                elements: [{type: "Text", text: "Updated heading"}],
                            },
                            {
                                type: "Paragraph",
                                key: expect.stringMatching(/^(?!client-paragraph-key$).+/),
                                elements: [{type: "Text", text: "Updated body."}],
                            },
                        ],
                    },
                }),
            },
        });
    });

    test("PATCH updates the document title via ProseMirror steps", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const document = await TestDocument.create(session, {
            title: "Original API Title",
            body: "Body stays the same.",
            access: "Public",
        });

        const response = await server.PATCH(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [
                    {
                        type: "SetTitle",
                        title: "Renamed Via API",
                        version: await document.getVersion(),
                    },
                ],
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

    test("PATCH rebases title updates from a previous version over concurrent body updates", async () => {
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

        const patchResponse = await server.PATCH(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [
                    {
                        type: "SetTitle",
                        title: "Renamed Title",
                        version: previousVersion,
                    },
                ],
            },
        });
        const getResponse = await server.GET(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect({patchResponse, getResponse}).toMatchObject({
            patchResponse: {
                status: 200,
                body: {
                    document: expect.objectContaining({
                        title: "Renamed Title",
                        content: expect.objectContaining({
                            elements: [
                                {
                                    type: "Paragraph",
                                    key: expect.any(String),
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
                                    key: expect.any(String),
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

    test("PATCH rebases body updates from a previous version over concurrent title updates", async () => {
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

        const concurrentTitleResponse = await server.PATCH(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [
                    {
                        type: "SetTitle",
                        title: "Concurrent Title",
                        version: previousVersion,
                    },
                ],
            },
        });
        const staleBodyResponse = await server.PATCH(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [
                    {
                        type: "SetContent",
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
                ],
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
                                    key: expect.any(String),
                                    elements: [{type: "Text", text: "Updated body."}],
                                },
                            ],
                        }),
                    }),
                },
            },
        });
    });

    test("PATCH rebases non-conflicting body updates from a previous version", async () => {
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

        const concurrentBodyResponse = await server.PATCH(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [
                    {
                        type: "SetContent",
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
                ],
            },
        });
        const staleBodyResponse = await server.PATCH(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [
                    {
                        type: "SetContent",
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
                ],
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
                                    key: expect.any(String),
                                    elements: [{type: "Text", text: "Start Alpha Beta"}],
                                },
                            ],
                        }),
                    }),
                },
            },
        });
    });

    test("PATCH rebases previous version updates across the document snapshot boundary", async () => {
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

        const response = await server.PATCH(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [
                    {
                        type: "SetTitle",
                        title: "Renamed Across Snapshot",
                        version: previousVersion,
                    },
                ],
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
                                key: expect.any(String),
                                elements: [{type: "Text", text: "Base one two three four"}],
                            },
                        ],
                    }),
                }),
            },
        });
    });
    test("can update a document with an empty title string", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const document = await TestDocument.create(session, {
            title: "Valid Title",
            body: "Original content.",
            access: "Public",
        });

        const response = await server.PATCH(`/documents/${document.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [
                    {
                        type: "SetTitle",
                        title: "",
                        version: await document.getVersion(),
                    },
                    {
                        type: "SetContent",
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
                ],
            },
        });

        expect(response).toMatchObject({
            status: 200,
            body: {
                document: expect.objectContaining({
                    title: "",
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
                            key: expect.any(String),
                            file: {
                                id: file.id,
                                contentType: "image/png",
                                contentLength: 5232,
                            },
                        }),
                    ]),
                }),
            }),
        },
    });
});

test("can create document comment with file attachments", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const document = await TestDocument.create(session);
    const {range} = await document.type(session, "Hello");
    const commentThread = await document.createCommentThread(session, range, "test");

    // Upload and attach the file to the document so the bot can access it through the
    // attachment authorizer.
    const file = await TestFile.create(session);
    await document.attachFile(session, file);

    const response = await server.POST(
        `/documents/${document.id}/threads/${commentThread.id}/messages`,
        {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "Comment with file"}],
                        },
                    ],
                },
                files: [{element: {type: "File", file: {id: file.id}}}],
            },
        },
    );

    expect(response).toMatchObject({
        status: 200,
        body: {
            message: expect.objectContaining({
                payload: expect.objectContaining({
                    type: "Content",
                    files: [
                        expect.objectContaining({
                            rowIndex: 0,
                            width: 1,
                            element: {
                                type: "File",
                                file: {
                                    id: file.id,
                                    contentType: expect.any(String),
                                    contentLength: expect.any(Number),
                                },
                            },
                        }),
                    ],
                }),
            }),
        },
    });
});

test("document comment with invalid file object returns 400", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const document = await TestDocument.create(session);
    const {range} = await document.type(session, "Hello");
    const commentThread = await document.createCommentThread(session, range, "test");

    const response = await server.POST(
        `/documents/${document.id}/threads/${commentThread.id}/messages`,
        {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "Bad file"}],
                        },
                    ],
                },
                files: [{element: {type: "File", file: {id: "not-a-valid-id"}}}],
            },
        },
    );

    expect(response).toMatchObject({status: 400});
});

test("document preview in response", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const document1 = await TestDocument.create(session);
    const document2 = await TestDocument.create(session, {title: "Lorem Ipsum"});

    await document1.update(session, lastUpdatePos => [
        new ReplaceStep(
            lastUpdatePos + 1,
            lastUpdatePos + 1,
            new Slice(
                Fragment.from(
                    schema.node("fileRow", {}, [
                        schema.node("file", {fileId: `Document:${document2.id}`}),
                    ]),
                ),
                0,
                0,
            ),
        ),
    ]);

    const response = await server.GET(`/documents/${document1.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
    });

    expect(response).toMatchObject({
        status: 200,
        body: {
            document: expect.objectContaining({
                content: expect.objectContaining({
                    elements: expect.arrayContaining([
                        expect.objectContaining({
                            type: "Preview",
                            reference: {
                                type: "Document",
                                id: document2.id,
                                title: "Lorem Ipsum",
                            },
                        }),
                    ]),
                }),
            }),
        },
    });
});

test("untitled document preview in response", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const document1 = await TestDocument.create(session);
    const document2 = await TestDocument.create(session);

    await document1.update(session, lastUpdatePos => [
        new ReplaceStep(
            lastUpdatePos + 1,
            lastUpdatePos + 1,
            new Slice(
                Fragment.from(
                    schema.node("fileRow", {}, [
                        schema.node("file", {fileId: `Document:${document2.id}`}),
                    ]),
                ),
                0,
                0,
            ),
        ),
    ]);

    const response = await server.GET(`/documents/${document1.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
    });

    expect(response).toMatchObject({
        status: 200,
        body: {
            document: expect.objectContaining({
                content: expect.objectContaining({
                    elements: expect.arrayContaining([
                        expect.objectContaining({
                            type: "Preview",
                            reference: {
                                type: "Document",
                                id: document2.id,
                                title: "Untitled",
                            },
                        }),
                    ]),
                }),
            }),
        },
    });
});

test("private document preview in response", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const otherSession = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const document1 = await TestDocument.create(session);
    const document2 = await TestDocument.create(otherSession, {title: "Lorem Ipsum"});

    await document1.update(session, lastUpdatePos => [
        new ReplaceStep(
            lastUpdatePos + 1,
            lastUpdatePos + 1,
            new Slice(
                Fragment.from(
                    schema.node("fileRow", {}, [
                        schema.node("file", {fileId: `Document:${document2.id}`}),
                    ]),
                ),
                0,
                0,
            ),
        ),
    ]);

    const response = await server.GET(`/documents/${document1.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
    });

    expect(response).toMatchObject({
        status: 200,
        body: {
            document: expect.objectContaining({
                content: expect.objectContaining({
                    elements: expect.arrayContaining([
                        expect.objectContaining({
                            type: "Preview",
                            reference: {
                                type: "Document",
                                id: document2.id,
                                title: "Private document",
                            },
                        }),
                    ]),
                }),
            }),
        },
    });
});
