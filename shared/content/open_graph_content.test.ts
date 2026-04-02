import {ContentMention} from "~/shared/content/content_mention.js";
import {
    defaultOpenGraphImageUrl,
    getOpenGraphContent,
} from "~/shared/content/open_graph_content.js";
import {
    DocumentContentReferences,
    emptyDocumentContentReferences,
} from "~/shared/documents/document_content_references.js";
import {
    DocumentContent,
    DocumentContentProsemirrorSchema,
    DocumentWithOptionalTitleContentProsemirrorSchema,
    createEmptyDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, DocumentId} from "~/shared/id/types/id_types.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

const ogImageUrl = defaultOpenGraphImageUrl;

describe("getOpenGraphContent", () => {
    test("returns null description for empty content", () => {
        const emptyContent = createEmptyDocumentContent(generateId<AccountId>());
        // Cut body content, skipping the title (first child).
        const bodyContent = emptyContent.cut(emptyContent.child(0).nodeSize);

        const result = getOpenGraphContent("Test", {
            doc: bodyContent,
            references: emptyDocumentContentReferences,
        });

        expect(result).toEqual({
            title: "Test | Alpine",
            description: null,
            image: ogImageUrl,
        });
    });

    test("returns text content as description", () => {
        const doc = DocumentWithOptionalTitleContentProsemirrorSchema.node("doc", null, [
            DocumentWithOptionalTitleContentProsemirrorSchema.node("title", null, [
                DocumentWithOptionalTitleContentProsemirrorSchema.text("Test Document"),
            ]),
            DocumentWithOptionalTitleContentProsemirrorSchema.node("paragraph", null, [
                DocumentWithOptionalTitleContentProsemirrorSchema.text(
                    "This is the first paragraph of the document.",
                ),
            ]),
        ]) as DocumentContent;

        // Cut body content, skipping the title.
        const bodyContent = doc.cut(doc.child(0).nodeSize);

        const result = getOpenGraphContent("Test Document", {
            doc: bodyContent,
            references: emptyDocumentContentReferences,
        });

        expect(result).toMatchObject({
            title: "Test Document | Alpine",
            description: "This is the first paragraph of the document.",
            image: ogImageUrl,
        });
    });

    test("resolves account mention using references", () => {
        const accountId = generateId<AccountId>();

        const doc = DocumentWithOptionalTitleContentProsemirrorSchema.node("doc", null, [
            DocumentWithOptionalTitleContentProsemirrorSchema.node("title", null, [
                DocumentWithOptionalTitleContentProsemirrorSchema.text("Title"),
            ]),
            DocumentWithOptionalTitleContentProsemirrorSchema.node("paragraph", null, [
                DocumentWithOptionalTitleContentProsemirrorSchema.text("Hello "),
                DocumentWithOptionalTitleContentProsemirrorSchema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "Account",
                        accountId,
                        isShort: false,
                    }),
                }),
            ]),
        ]) as DocumentContent;

        const references: DocumentContentReferences = {
            accountById: new Map([
                [
                    accountId,
                    new AccountModel({
                        id: accountId,
                        version: 1,
                        name: "Alice",
                        nameVersion: 1,
                        avatar: null,
                        reactionCharacter: null,
                        space: {
                            version: 1,
                            addedTime: new Date(),
                            state: {type: "Active", activatedTime: new Date()},
                            role: "Member",
                        },
                    }),
                ],
            ]),
            searchEntityById: emptyMap,
            commentThreadById: emptyMap,
            siteById: emptyMap,
        };

        const bodyContent = doc.cut(doc.child(0).nodeSize);

        const result = getOpenGraphContent("Title", {doc: bodyContent, references});

        expect(result).toMatchObject({description: "Hello Alice"});
    });

    test("resolves search entity mention using references", () => {
        const documentId = generateId<DocumentId>();
        const entityId = `Document:${documentId}` as SearchMentionEntityId;

        const doc = DocumentWithOptionalTitleContentProsemirrorSchema.node("doc", null, [
            DocumentWithOptionalTitleContentProsemirrorSchema.node("title", null, [
                DocumentWithOptionalTitleContentProsemirrorSchema.text("Title"),
            ]),
            DocumentWithOptionalTitleContentProsemirrorSchema.node("paragraph", null, [
                DocumentWithOptionalTitleContentProsemirrorSchema.text("See "),
                DocumentWithOptionalTitleContentProsemirrorSchema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId,
                    }),
                }),
            ]),
        ]) as DocumentContent;

        const references: DocumentContentReferences = {
            accountById: emptyMap,
            searchEntityById: new Map([
                [
                    entityId,
                    {
                        isPrivate: false as const,
                        entity: new SearchEntityModel({
                            id: `Document:${documentId}`,
                            title: "Project Roadmap",
                            titleVersion: null,
                            media: null,
                        }),
                    },
                ],
            ]),
            commentThreadById: emptyMap,
            siteById: emptyMap,
        };

        const bodyContent = doc.cut(doc.child(0).nodeSize);

        const result = getOpenGraphContent("Title", {doc: bodyContent, references});

        expect(result).toMatchObject({description: "See Project Roadmap"});
    });

    test("resolves private search entity mention as private", () => {
        const documentId = generateId<DocumentId>();
        const entityId = `Document:${documentId}` as SearchMentionEntityId;

        const doc = DocumentWithOptionalTitleContentProsemirrorSchema.node("doc", null, [
            DocumentWithOptionalTitleContentProsemirrorSchema.node("title", null, [
                DocumentWithOptionalTitleContentProsemirrorSchema.text("Title"),
            ]),
            DocumentWithOptionalTitleContentProsemirrorSchema.node("paragraph", null, [
                DocumentWithOptionalTitleContentProsemirrorSchema.text("See "),
                DocumentWithOptionalTitleContentProsemirrorSchema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId,
                    }),
                }),
            ]),
        ]) as DocumentContent;

        const references: DocumentContentReferences = {
            accountById: emptyMap,
            searchEntityById: new Map([[entityId, {isPrivate: true as const}]]),
            commentThreadById: emptyMap,
            siteById: emptyMap,
        };

        const bodyContent = doc.cut(doc.child(0).nodeSize);

        const result = getOpenGraphContent("Title", {doc: bodyContent, references});

        expect(result).toMatchObject({description: "See Private document"});
    });

    test("returns null description for content with only whitespace", () => {
        const doc = DocumentWithOptionalTitleContentProsemirrorSchema.node("doc", null, [
            DocumentWithOptionalTitleContentProsemirrorSchema.node("title", null, [
                DocumentWithOptionalTitleContentProsemirrorSchema.text("Title Only"),
            ]),
            DocumentWithOptionalTitleContentProsemirrorSchema.node("paragraph"),
        ]) as DocumentContent;

        const bodyContent = doc.cut(doc.child(0).nodeSize);

        const result = getOpenGraphContent("Title Only", {
            doc: bodyContent,
            references: emptyDocumentContentReferences,
        });

        expect(result).toEqual({
            title: "Title Only | Alpine",
            description: null,
            image: ogImageUrl,
        });
    });

    test("includes title with Alpine suffix", () => {
        const doc = DocumentContentProsemirrorSchema.node(
            "doc",
            {accessPolicy: {accountGrantById: new Map(), defaultGrant: null, urlGrant: null}},
            [
                DocumentContentProsemirrorSchema.node("title", null, [
                    DocumentContentProsemirrorSchema.text("My Doc"),
                ]),
                DocumentContentProsemirrorSchema.node("paragraph", null, [
                    DocumentContentProsemirrorSchema.text("Some content"),
                ]),
            ],
        ) as DocumentContent;

        const bodyContent = doc.cut(doc.child(0).nodeSize);

        const result = getOpenGraphContent("My Doc", {
            doc: bodyContent,
            references: emptyDocumentContentReferences,
        });

        expect(result.title).toBe("My Doc | Alpine");
    });

    test("always returns the OG image URL", () => {
        const doc = DocumentContentProsemirrorSchema.node(
            "doc",
            {accessPolicy: {accountGrantById: new Map(), defaultGrant: null, urlGrant: null}},
            [
                DocumentContentProsemirrorSchema.node("title"),
                DocumentContentProsemirrorSchema.node("paragraph"),
            ],
        ) as DocumentContent;

        const bodyContent = doc.cut(doc.child(0).nodeSize);

        const result = getOpenGraphContent("Test", {
            doc: bodyContent,
            references: emptyDocumentContentReferences,
        });

        expect(result.image).toBe(ogImageUrl);
    });
});
