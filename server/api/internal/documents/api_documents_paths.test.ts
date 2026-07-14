import {jest} from "@jest/globals";
import {Fragment, Mark, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
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
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {
    DocumentCollaborationUpdateContentWithDiffRequestBodySchema,
    DocumentCollaborationUpdateContentWithDiffResponseBodySchema,
} from "~/shared/documents/document_collaboration_protocol.js";
import {
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {assertId, generateId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";
import {diffProsemirrorNodes} from "~/shared/prosemirror/diff_prosemirror_nodes.js";

const context = createTestContext({
    chatInjection,
    documentsInjection,
    tasksInjection,

    // Reimplement the Durable Object `/update-content-with-diff` route in tests so we
    // can test the API endpoint. The actual route in
    // `DocumentCollaborationDurableObject` isn't that dissimilar from what you see
    // here.
    sendRequestToDurableObject: async (actualContext, request) => {
        const match = request.url.match(
            /^\/api\/durable-objects\/documents\/([^/]+)\/update-content-with-diff/,
        );
        if (!match) return;

        const context = (actualContext as ApiServiceBotActionContext).dynamo
            // Strong consistency isn't required since this logic is test-only. So all requests
            // will be strong consistency implicitly.
            .unexpectStrongReadConsistency();

        const documentId = assertId<DocumentId>(match[1]!);

        const requestBody = DocumentCollaborationUpdateContentWithDiffRequestBodySchema.deserialize(
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

        return DocumentCollaborationUpdateContentWithDiffResponseBodySchema.serialize({
            ok: true,
            spaceId: document.spaceId,
            creatorId: document.creator.id,
            newVersion,
            newContent,
        });
    },
});

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

describe("/documents/{id}/reference", () => {
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
            await server.GET(`/documents/${document.id}/reference`, {
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
            await server.GET(`/documents/${document.id}/reference`, {
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
            await server.GET(`/documents/${generateId<DocumentId>()}/reference`, {
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
            await server.GET(`/documents/${document.id}/reference`, {
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
                thread: expect.objectContaining({
                    id: commentThread.id,
                    isResolved: false,
                    totalMessageCount: 1,
                    marked: {
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
                    },
                }),
                document: expect.objectContaining({id: document.id}),
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

        const response = await server.GET(`/documents/${document.id}/threads/${commentThread.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        });
        assert(response.status === 200);

        const snippetElements = response.body.thread.marked.preview.contentSnippet.elements;
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
            `/documents/${document.id}/threads/${commentThread.id}`,
            {headers: {authorization: `bearer ${apiKey}`}},
        );
        assert(threadResponse.status === 200);

        const documentElements = documentResponse.body.document.content.elements;
        const snippetElements = threadResponse.body.thread.marked.preview.contentSnippet.elements;
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
            await server.GET(`/documents/${document.id}/threads/${commentThread.id}`, {
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
                    marked: {
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
                    },
                }),
                document: expect.objectContaining({id: document.id}),
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

        const response = await server.GET(`/documents/${document.id}/threads/${commentThread.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        });
        assert(response.status === 200);

        expect(response.body.thread.marked.preview.version).toBe(fallbackVersion);
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
                thread: expect.objectContaining({
                    id: commentThread.id,
                    isResolved: true,
                    totalMessageCount: 1,
                    marked: {
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
            await server.GET(`/documents/${document.id}/threads/${commentThread.id}`, {
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
                    marked: {
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
                    },
                }),
                document: expect.objectContaining({id: document.id}),
            },
        });
    });
});

describe("PATCH /documents/{id}", () => {
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
                document: {
                    title: "Keyed Input Test",
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

        expect(patchResponse.status).toBe(200);
        expect(getResponse.status).toBe(200);
        expect(patchResponse.body.document.title).toBe("Renamed Title");
        expect(getResponse.body.document.title).toBe("Renamed Title");
        expect(patchResponse.body.document.content).toEqual({
            elements: [
                {
                    type: "Paragraph",
                    key: expect.any(String),
                    elements: [{type: "Text", text: "Original body. Concurrent tail."}],
                },
            ],
        });
        expect(getResponse.body.document.content).toEqual({
            elements: [
                {
                    type: "Paragraph",
                    key: expect.any(String),
                    elements: [{type: "Text", text: "Original body. Concurrent tail."}],
                },
            ],
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
        const staleBodyResponse = await server.PATCH(`/documents/${document.id}`, {
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

        expect(concurrentTitleResponse.status).toBe(200);
        expect(staleBodyResponse.status).toBe(200);
        expect(staleBodyResponse.body.document.title).toBe("Concurrent Title");
        expect(staleBodyResponse.body.document.content).toEqual({
            elements: [
                {
                    type: "Paragraph",
                    key: expect.any(String),
                    elements: [{type: "Text", text: "Updated body."}],
                },
            ],
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
        const staleBodyResponse = await server.PATCH(`/documents/${document.id}`, {
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

        expect(concurrentBodyResponse.status).toBe(200);
        expect(staleBodyResponse.status).toBe(200);
        expect(staleBodyResponse.body.document.title).toBe("Body Rebase");
        expect(staleBodyResponse.body.document.content).toEqual({
            elements: [
                {
                    type: "Paragraph",
                    key: expect.any(String),
                    elements: [{type: "Text", text: "Start Alpha Beta"}],
                },
            ],
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

        expect(response.status).toBe(200);
        expect(response.body.document.title).toBe("Renamed Across Snapshot");
        expect(response.body.document.content).toEqual({
            elements: [
                {
                    type: "Paragraph",
                    key: expect.any(String),
                    elements: [{type: "Text", text: "Base one two three four"}],
                },
            ],
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
                document: {
                    title: "",
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
