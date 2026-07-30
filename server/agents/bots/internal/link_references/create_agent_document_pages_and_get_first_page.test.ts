import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {getAgentLink} from "~/server/agents/bots/internal/link_references/agent_link_collection.js";
import {putAgentLocalDocumentContent} from "~/server/agents/bots/internal/link_references/agent_local_document_content_collection.js";
import {createAgentDocumentPagesAndReturnFirstPage} from "~/server/agents/bots/internal/link_references/create_agent_document_pages_and_get_first_page.js";
import {ApiContentKeyEncoder} from "~/shared/api/content/api_content_key.js";
import type {ApiContentKey} from "~/shared/api/specification/types/api_content_key.js";
import {ApiContentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

const storage = new DurableObjectStorage(new MemoryStorage());

afterEach(async () => {
    await storage.deleteAll();
});

describe("createDocumentPagesAndGetFirstPage", () => {
    const documentId = generateId<DocumentId>();
    const mockEntityId = "Document:mock";
    const mockApiContentKeyEncoder = new ApiContentKeyEncoder({entityId: mockEntityId, version: 0});
    let nextMockApiContentKeyPos = 0;

    function createParagraphElement(text: string) {
        return {
            type: "Paragraph" as const,
            key: createMockApiContentKey(),
            elements: [{type: "Text" as const, text}],
        };
    }

    function createMockApiContentKey(): ApiContentKey {
        return mockApiContentKeyEncoder.encode({
            pos: nextMockApiContentKeyPos++,
            nodeSize: 0,
        });
    }

    test("creates single page for short document", async () => {
        const content: ApiContentResponse = {
            elements: [
                createParagraphElement("Short paragraph 1."),
                createParagraphElement("Short paragraph 2."),
            ],
        };

        const documentKey = await putAgentLocalDocumentContent(storage, documentId, {
            title: "Test Document",
            content,
        });

        const firstPage = await createAgentDocumentPagesAndReturnFirstPage(storage, {
            documentKey,
            originalLinkPathObject: {
                type: "DocumentPage",
                documentId,
                title: "Test Document",
                localDocumentPage: null,
            },
            tokenLimitFactor: 1,
        });

        expect(firstPage).toEqual({
            type: "DocumentPage",
            documentId,
            title: "Test Document",
            localDocumentPage: {
                localDocumentVersion: 1,
                pageNumber: 1,
                documentKey,
                pageStartElementIndex: 0,
                pageEndElementIndexExclusive: 2,
                previousPageAgentLinkString: null,
                nextPageAgentLinkString: null,
            },
        });
    });

    test("throws for empty document", async () => {
        const content: ApiContentResponse = {
            elements: [],
        };

        const documentKey = await putAgentLocalDocumentContent(storage, documentId, {
            title: "Empty Document",
            content,
        });

        await expect(
            createAgentDocumentPagesAndReturnFirstPage(storage, {
                documentKey,
                originalLinkPathObject: {
                    type: "DocumentPage",
                    documentId,
                    title: "Empty Document",
                    localDocumentPage: null,
                },
                tokenLimitFactor: 1,
            }),
        ).rejects.toThrow();
    });

    test("creates multiple pages for long document", async () => {
        const content: ApiContentResponse = {
            elements: [
                createParagraphElement("a".repeat(12000)), // Page 1
                createParagraphElement("a".repeat(18000)), // Page 2
                createParagraphElement("a".repeat(27000)), // Page 3
            ],
        };

        const documentKey = await putAgentLocalDocumentContent(storage, documentId, {
            title: "Long Document",
            content,
        });

        const firstPage = await createAgentDocumentPagesAndReturnFirstPage(storage, {
            documentKey,
            originalLinkPathObject: {
                type: "DocumentPage",
                documentId,
                title: "Long Document",
                localDocumentPage: null,
            },
            tokenLimitFactor: 1,
        });

        expect(firstPage).toEqual({
            type: "DocumentPage",
            documentId,
            title: "Long Document",
            localDocumentPage: {
                documentKey,
                pageNumber: 1,
                localDocumentVersion: 1,
                nextPageAgentLinkString: "/document/long-document?page=2",
                previousPageAgentLinkString: null,
                pageStartElementIndex: 0,
                pageEndElementIndexExclusive: 1,
            },
        });

        const secondPage = await getAgentLink(storage, "/document/long-document?page=2");
        expect(secondPage).toEqual({
            type: "DocumentPage",
            documentId,
            title: "Long Document",
            localDocumentPage: {
                documentKey,
                pageNumber: 2,
                localDocumentVersion: 1,
                nextPageAgentLinkString: "/document/long-document?page=3",
                previousPageAgentLinkString: null,
                pageStartElementIndex: 1,
                pageEndElementIndexExclusive: 2,
            },
        });

        const thirdPage = await getAgentLink(storage, "/document/long-document?page=3");
        expect(thirdPage).toEqual({
            type: "DocumentPage",
            documentId,
            title: "Long Document",
            localDocumentPage: {
                documentKey,
                pageNumber: 3,
                localDocumentVersion: 1,
                nextPageAgentLinkString: null,
                previousPageAgentLinkString: null,
                pageStartElementIndex: 2,
                pageEndElementIndexExclusive: 3,
            },
        });
    });

    test("creates multiple pages for long document with exponential page size growth", async () => {
        const content: ApiContentResponse = {
            elements: [
                createParagraphElement("a".repeat(6000)), // Page 1
                createParagraphElement("a".repeat(6000)), // Page 2
                createParagraphElement("a".repeat(6000)), // Page 3
            ],
        };

        const documentKey = await putAgentLocalDocumentContent(storage, documentId, {
            title: "Long Document",
            content,
        });

        const firstPage = await createAgentDocumentPagesAndReturnFirstPage(storage, {
            documentKey,
            originalLinkPathObject: {
                type: "DocumentPage",
                documentId,
                title: "Long Document",
                localDocumentPage: null,
            },
            tokenLimitFactor: 1,
        });

        expect(firstPage).toEqual({
            type: "DocumentPage",
            documentId,
            title: "Long Document",
            localDocumentPage: {
                documentKey,
                pageNumber: 1,
                localDocumentVersion: 1,
                nextPageAgentLinkString: "/document/long-document?page=2",
                previousPageAgentLinkString: null,
                pageStartElementIndex: 0,
                pageEndElementIndexExclusive: 1,
            },
        });

        const secondPage = await getAgentLink(storage, "/document/long-document?page=2");
        expect(secondPage).toEqual({
            type: "DocumentPage",
            documentId,
            title: "Long Document",
            localDocumentPage: {
                documentKey,
                pageNumber: 2,
                localDocumentVersion: 1,
                nextPageAgentLinkString: null,
                previousPageAgentLinkString: null,
                pageStartElementIndex: 1,
                pageEndElementIndexExclusive: 3,
            },
        });
    });

    test("splits document with many small elements across pages", async () => {
        // Create a document with many small elements that should split into pages
        const elements = [];
        // Each element is ~200 chars = ~50 tokens With 1000 token limit, we should get ~20
        // elements per page
        for (let i = 0; i < 25; i++) {
            elements.push(createParagraphElement(`Paragraph ${i}: ${"x".repeat(180)}`));
        }

        const content: ApiContentResponse = {elements};
        const documentKey = await putAgentLocalDocumentContent(storage, documentId, {
            title: "Many Elements",
            content,
        });

        const firstPage = await createAgentDocumentPagesAndReturnFirstPage(storage, {
            documentKey,
            originalLinkPathObject: {
                type: "DocumentPage",
                documentId,
                title: "Many Elements",
                localDocumentPage: null,
            },
            tokenLimitFactor: 1,
        });

        expect(firstPage.localDocumentPage?.pageNumber).toBe(1);
        expect(firstPage.localDocumentPage?.pageStartElementIndex).toBe(0);
        // Should have multiple elements on first page
        expect(firstPage.localDocumentPage?.pageEndElementIndexExclusive).toBe(25);
    });

    test("handles large element that exceeds token limit", async () => {
        // Create a single element that's larger than the page limit
        const veryLongText = "a".repeat(20000); // ~2500 tokens
        const content: ApiContentResponse = {
            elements: [
                createParagraphElement(veryLongText),
                createParagraphElement("Next element"),
            ],
        };

        const documentKey = await putAgentLocalDocumentContent(storage, documentId, {
            title: "Large Element",
            content,
        });

        const firstPage = await createAgentDocumentPagesAndReturnFirstPage(storage, {
            documentKey,
            originalLinkPathObject: {
                type: "DocumentPage",
                documentId,
                title: "Large Element",
                localDocumentPage: null,
            },
            tokenLimitFactor: 1,
        });

        // First page should contain only the large element
        expect(firstPage.localDocumentPage?.pageStartElementIndex).toBe(0);
        expect(firstPage.localDocumentPage?.pageEndElementIndexExclusive).toBe(1);
        expect(firstPage.localDocumentPage?.nextPageAgentLinkString).toBe(
            "/document/large-element?page=2",
        );
    });

    test("handles single large element that exceeds token limit", async () => {
        // Create a single element that's larger than the page limit
        const veryLongText = "a".repeat(5000); // ~1250 tokens
        const content: ApiContentResponse = {
            elements: [createParagraphElement(veryLongText)],
        };

        const documentKey = await putAgentLocalDocumentContent(storage, documentId, {
            title: "Large Element",
            content,
        });

        const firstPage = await createAgentDocumentPagesAndReturnFirstPage(storage, {
            documentKey,
            originalLinkPathObject: {
                type: "DocumentPage",
                documentId,
                title: "Large Element",
                localDocumentPage: null,
            },
            tokenLimitFactor: 1,
        });

        // First page should contain only the large element
        expect(firstPage.localDocumentPage?.pageStartElementIndex).toBe(0);
        expect(firstPage.localDocumentPage?.pageEndElementIndexExclusive).toBe(1);
        expect(firstPage.localDocumentPage?.nextPageAgentLinkString).toBeNull();
    });

    test("handles document with one element", async () => {
        const content: ApiContentResponse = {
            elements: [createParagraphElement("Single paragraph")],
        };

        const documentKey = await putAgentLocalDocumentContent(storage, documentId, {
            title: "Single Element",
            content,
        });

        const firstPage = await createAgentDocumentPagesAndReturnFirstPage(storage, {
            documentKey,
            originalLinkPathObject: {
                type: "DocumentPage",
                documentId,
                title: "Single Element",
                localDocumentPage: null,
            },
            tokenLimitFactor: 1,
        });

        expect(firstPage.localDocumentPage?.pageNumber).toBe(1);
        expect(firstPage.localDocumentPage?.pageStartElementIndex).toBe(0);
        expect(firstPage.localDocumentPage?.pageEndElementIndexExclusive).toBe(1);
        expect(firstPage.localDocumentPage?.previousPageAgentLinkString).toBe(null);
        expect(firstPage.localDocumentPage?.nextPageAgentLinkString).toBe(null);
    });

    test("preserves correct document version in page links", async () => {
        const content: ApiContentResponse = {
            elements: [
                createParagraphElement("a".repeat(2000)),
                createParagraphElement("b".repeat(2000)),
            ],
        };

        const documentKey = await putAgentLocalDocumentContent(storage, documentId, {
            title: "Version Document",
            content,
        });

        const firstPage = await createAgentDocumentPagesAndReturnFirstPage(storage, {
            documentKey,
            originalLinkPathObject: {
                type: "DocumentPage",
                documentId,
                title: "Version Document",
                localDocumentPage: null,
            },
            tokenLimitFactor: 1,
        });

        expect(firstPage.localDocumentPage?.localDocumentVersion).toBe(1);
        expect(firstPage.localDocumentPage?.documentKey).toBe(`/local/document/${documentId}-1`);
    });

    test("creates correct page numbers for 5-page document", async () => {
        // Create content for 5 pages
        const longText = "a".repeat(4000);
        const content: ApiContentResponse = {
            elements: [
                createParagraphElement(longText),
                createParagraphElement(longText),
                createParagraphElement(longText),
                createParagraphElement(longText),
                createParagraphElement(longText),
            ],
        };

        const documentKey = await putAgentLocalDocumentContent(storage, documentId, {
            title: "Five Pages",
            content,
        });

        const firstPage = await createAgentDocumentPagesAndReturnFirstPage(storage, {
            documentKey,
            originalLinkPathObject: {
                type: "DocumentPage",
                documentId,
                title: "Five Pages",
                localDocumentPage: null,
            },
            tokenLimitFactor: 1,
        });

        expect(firstPage.localDocumentPage?.pageNumber).toBe(1);
        expect(firstPage.localDocumentPage?.nextPageAgentLinkString).toBe(
            "/document/five-pages?page=2",
        );
    });

    describe("document versions", () => {
        test("handles multiple versions of same document", async () => {
            const content1: ApiContentResponse = {
                elements: [createParagraphElement("Version 1 content")],
            };

            const content2: ApiContentResponse = {
                elements: [createParagraphElement("Version 2 content with more text")],
            };

            const documentKey1 = await putAgentLocalDocumentContent(storage, documentId, {
                title: "Versioned Document",
                content: content1,
            });
            const documentKey2 = await putAgentLocalDocumentContent(storage, documentId, {
                title: "Versioned Document",
                content: content2,
            });

            expect(documentKey1).toBe(`/local/document/${documentId}-1`);
            expect(documentKey2).toBe(`/local/document/${documentId}-2`);

            const firstPage1 = await createAgentDocumentPagesAndReturnFirstPage(storage, {
                documentKey: documentKey1,
                originalLinkPathObject: {
                    type: "DocumentPage",
                    documentId,
                    title: "Versioned Document",
                    localDocumentPage: null,
                },
                tokenLimitFactor: 1,
            });

            const firstPage2 = await createAgentDocumentPagesAndReturnFirstPage(storage, {
                documentKey: documentKey2,
                originalLinkPathObject: {
                    type: "DocumentPage",
                    documentId,
                    title: "Versioned Document",
                    localDocumentPage: null,
                },
                tokenLimitFactor: 1,
            });

            expect(firstPage1.localDocumentPage?.localDocumentVersion).toBe(1);
            expect(firstPage2.localDocumentPage?.localDocumentVersion).toBe(2);
        });
    });

    describe("serialization", () => {
        test("serialized page can be reconstructed", async () => {
            const content: ApiContentResponse = {
                elements: [createParagraphElement("Test content for serialization")],
            };

            const documentKey = await putAgentLocalDocumentContent(storage, documentId, {
                title: "Serialize Document",
                content,
            });

            const firstPage = await createAgentDocumentPagesAndReturnFirstPage(storage, {
                documentKey,
                originalLinkPathObject: {
                    type: "DocumentPage",
                    documentId,
                    title: "Serialize Document",
                    localDocumentPage: null,
                },
                tokenLimitFactor: 1,
            });

            expect(firstPage.type).toBe("DocumentPage");
            expect(firstPage.documentId).toBe(documentId);
            expect(firstPage.localDocumentPage?.pageNumber).toBe(1);
            expect(firstPage.localDocumentPage?.pageStartElementIndex).toBe(0);
            expect(firstPage.localDocumentPage?.pageEndElementIndexExclusive).toBe(1);
        });
    });
});
