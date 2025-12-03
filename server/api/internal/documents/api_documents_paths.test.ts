import {Fragment, Mark, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {apiDocumentsPaths} from "~/server/api/internal/documents/api_documents_paths.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {DocumentContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

const context = createTestContext({
    documentsInjection,
});

const server = createTestApiServer(context, apiDocumentsPaths);

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

test("can’t read document content without access", async () => {
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
                message: expect.stringMatching("You aren’t allowed"),
            }),
        },
    });
});

test("can’t read document content for non-existent document", async () => {
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
                message: expect.stringMatching("doesn’t exist"),
            }),
        },
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

    test.todo("returns empty content if snippet is empty");
});
