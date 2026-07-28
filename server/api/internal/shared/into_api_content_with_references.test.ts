import {
    intoApiContentWithReferences,
    intoApiContentWithReferencesAndReturnReferences,
} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {
    ApiContentKeyDecoder,
    ApiContentKeyEncoder,
} from "~/shared/api/content/closed_source/api_content_key_encoder.js";
import {
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";

const context = createTestContext({});
const schema = DocumentContentProsemirrorSchema;

describe("intoApiContentWithReferences", () => {
    test("adds keys to paragraph and heading blocks when a version is provided", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const documentId = generateId<DocumentId>();
        const documentEntityId: `Document:${DocumentId}` = `Document:${documentId}`;

        const content = assertDocumentContent(
            schema.node(
                "doc",
                {
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session.account.id, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
                [
                    schema.node("title"),
                    schema.node("paragraph", {}, [schema.text("Hello")]),
                    schema.node("quoteBlock", {}, [
                        schema.node("paragraph", {}, [schema.text("Quoted")]),
                    ]),
                    schema.node("heading", {level: 1}, [schema.text("Heading")]),
                ],
            ),
        );

        const result = await intoApiContentWithReferences(session.action(), {
            spaceId: space.id,
            fileAuthorizer: "AssertHasNoFiles",
            content,
            contentKeyEncoder: new ApiContentKeyEncoder({entityId: documentEntityId, version: 17}),
        });

        expect(result).toMatchObject({
            elements: [
                {type: "Paragraph", key: expect.any(String)},
                {
                    type: "Quote",
                    elements: [{type: "Paragraph", key: expect.any(String)}],
                },
                {type: "Heading", key: expect.any(String)},
            ],
        });

        const paragraph = result.elements[0]!;
        assert(paragraph.type === "Paragraph");
        assert(paragraph.key !== undefined);

        const quote = result.elements[1]!;
        assert(quote.type === "Quote");
        const quotedParagraph = quote.elements[0]!;
        assert(quotedParagraph.type === "Paragraph");
        assert(quotedParagraph.key !== undefined);

        const heading = result.elements[2]!;
        assert(heading.type === "Heading");
        assert(heading.key !== undefined);

        const decoder = new ApiContentKeyDecoder(documentEntityId);

        expect([
            decoder.decode(paragraph.key),
            decoder.decode(quotedParagraph.key),
            decoder.decode(heading.key),
        ]).toEqual([
            expect.objectContaining({version: 17}),
            expect.objectContaining({version: 17}),
            expect.objectContaining({version: 17}),
        ]);
    });

    test("returns loaded mention references alongside keyed content", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});
        const documentId = generateId<DocumentId>();
        const documentEntityId: `Document:${DocumentId}` = `Document:${documentId}`;

        const content = assertDocumentContent(
            schema.node(
                "doc",
                {
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session.account.id, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
                [
                    schema.node("title"),
                    schema.node("paragraph", {}, [
                        schema.node("mention", {
                            mention: {
                                type: "Account",
                                accountId: session.account.id,
                                isShort: false,
                            },
                        }),
                    ]),
                ],
            ),
        );

        const result = await intoApiContentWithReferencesAndReturnReferences(session.action(), {
            spaceId: space.id,
            fileAuthorizer: "AssertHasNoFiles",
            content,
            contentKeyEncoder: new ApiContentKeyEncoder({entityId: documentEntityId, version: 23}),
        });

        expect(result.content).toEqual({
            elements: [
                {
                    type: "Paragraph",
                    key: expect.any(String),
                    elements: [
                        {
                            type: "Mention",
                            reference: {
                                type: "Account",
                                id: session.account.id,
                                title: "Alice Smith",
                                shortName: "Alice",
                            },
                        },
                    ],
                },
            ],
        });
        expect(result.references.accountById.get(session.account.id)?.id).toBe(session.account.id);
        expect(result.references.searchEntityById.size).toBe(0);
        expect(result.references.fileById.size).toBe(0);
    });

    test("loads, deduplicates, and returns FileEntityId references", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const existingDocumentId = generateId<DocumentId>();
        const privateDocumentId = generateId<DocumentId>();
        const missingDocumentId = generateId<DocumentId>();
        const existingDocumentEntityId = `Document:${existingDocumentId}` as const;
        const privateDocumentEntityId = `Document:${privateDocumentId}` as const;
        const missingDocumentEntityId = `Document:${missingDocumentId}` as const;
        const loadedRequests: Array<{spaceId: string; entityId: string}> = [];

        const sessionContext = session.action();
        const contextWithSearchInjection = sessionContext.clone({
            searchInjection: sessionContext.searchInjection.cloneForTest({
                getSearchMentionEntityIfPossible: async (_context, spaceId, entityId) => {
                    loadedRequests.push({spaceId, entityId});

                    if (entityId === existingDocumentEntityId) {
                        return {
                            isPrivate: false,
                            entity: new SearchEntityModel({
                                type: "Document",
                                title: "Quarterly Roadmap",
                                document: {id: existingDocumentId, version: 7},
                            }),
                        };
                    }

                    if (entityId === privateDocumentEntityId) {
                        return {isPrivate: true};
                    }

                    return null;
                },
            }),
        });

        const content = assertDocumentContent(
            schema.node(
                "doc",
                {
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session.account.id, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
                [
                    schema.node("title"),
                    schema.node("paragraph", {}, [
                        schema.node("mention", {
                            mention: {
                                type: "SearchEntity",
                                entityId: existingDocumentEntityId,
                            },
                        }),
                    ]),
                    schema.node("fileRow", {}, [
                        schema.node("file", {fileId: existingDocumentEntityId}),
                    ]),
                    schema.node("fileRow", {}, [
                        schema.node("file", {fileId: privateDocumentEntityId}),
                    ]),
                    schema.node("fileRow", {}, [
                        schema.node("file", {fileId: missingDocumentEntityId}),
                    ]),
                ],
            ),
        );

        const result = await intoApiContentWithReferencesAndReturnReferences(
            contextWithSearchInjection,
            {
                spaceId: space.id,
                fileAuthorizer: "AssertHasNoFiles",
                content,
                contentKeyEncoder: null,
            },
        );

        expect({
            content: result.content,
            loadedRequests,
            accountReferenceCount: result.references.accountById.size,
            searchReferenceIds: Array.from(result.references.searchEntityById.keys()),
            fileReferenceCount: result.references.fileById.size,
        }).toEqual({
            content: {
                elements: [
                    {
                        type: "Paragraph",
                        elements: [
                            {
                                type: "Mention",
                                reference: {
                                    type: "Document",
                                    id: existingDocumentId,
                                    title: "Quarterly Roadmap",
                                },
                            },
                        ],
                    },
                    {
                        type: "FileGallery",
                        rows: [
                            {
                                items: [
                                    {
                                        width: 1,
                                        element: {
                                            type: "Preview",
                                            reference: {
                                                type: "Document",
                                                id: existingDocumentId,
                                                title: "Quarterly Roadmap",
                                            },
                                        },
                                    },
                                ],
                            },
                            {
                                items: [
                                    {
                                        width: 1,
                                        element: {
                                            type: "Preview",
                                            reference: {
                                                type: "Document",
                                                id: privateDocumentId,
                                                title: "Private document",
                                            },
                                        },
                                    },
                                ],
                            },
                            {
                                items: [
                                    {
                                        width: 1,
                                        element: {
                                            type: "Preview",
                                            reference: {
                                                type: "Document",
                                                id: missingDocumentId,
                                                title: "Unknown document",
                                            },
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            loadedRequests: [
                {spaceId: space.id, entityId: existingDocumentEntityId},
                {spaceId: space.id, entityId: privateDocumentEntityId},
                {spaceId: space.id, entityId: missingDocumentEntityId},
            ],
            accountReferenceCount: 0,
            searchReferenceIds: [existingDocumentEntityId, privateDocumentEntityId],
            fileReferenceCount: 0,
        });
    });
});
