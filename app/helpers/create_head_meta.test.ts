import {
    createHeadMetaForChannel,
    createHeadMetaForChatRoom,
    createHeadMetaForDocument,
    createHeadMetaForTask,
    createHeadMetaForTaskCollection,
    getDocumentOgDescription,
} from "~/app/helpers/create_head_meta.js";
import {newTaskCollectionNamePlaceholder} from "~/client/web/styles/tasks_shared_styles.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {AccessPolicyModel} from "~/shared/access/model/access_policy_model.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {
    MessageContent,
    MessageContentProsemirrorSchema,
} from "~/shared/content/message_content_schema.js";
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
import {documentFallbackTitle} from "~/shared/documents/document_fallback_title.js";
import {DocumentModel} from "~/shared/documents/document_model.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, ChannelId, DocumentId, SpaceId} from "~/shared/id/types/id_types.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {TaskNotesContentProsemirrorSchema} from "~/shared/tasks/task_notes_content_schema.js";

function createTestDocument(options: {
    title?: string;
    bodyText?: string;
    urlGrant?: boolean;
}): DocumentModel {
    const titleText = options.title ?? "";
    const bodyText = options.bodyText ?? "";

    const accessPolicy: AccessPolicy = {
        type: "Local",
        accountGrantById: new Map(),
        defaultGrant: null,
        urlGrant: options.urlGrant ? {level: "View"} : null,
    };

    const doc = DocumentContentProsemirrorSchema.node("doc", {accessPolicy}, [
        DocumentContentProsemirrorSchema.node(
            "title",
            null,
            titleText ? [DocumentContentProsemirrorSchema.text(titleText)] : [],
        ),
        // ProseMirror schema requires at least one paragraph after the title.
        DocumentContentProsemirrorSchema.node(
            "paragraph",
            null,
            bodyText ? [DocumentContentProsemirrorSchema.text(bodyText)] : [],
        ),
    ]) as DocumentContent;

    return new DocumentModel({
        id: generateId<DocumentId>(),
        spaceId: generateId<SpaceId>(),
        createdTime: new Date(),
        version: 1,
        content: {doc, references: emptyDocumentContentReferences},
        creator: {from: null},
    });
}

function createTestAccessPolicy(options: {urlGrant?: boolean}): AccessPolicyModel {
    return new AccessPolicyModel({
        type: "Local",
        accountGrantById: new Map(),
        defaultGrant: null,
        urlGrant: options.urlGrant ? {level: "View"} : null,
    });
}

function createTestChannel(options: {
    name?: string;
    descriptionText?: string;
    urlGrant?: boolean;
}): ChannelModel {
    const name = options.name ?? "Test Channel";
    const descriptionText = options.descriptionText ?? "";

    const accessPolicy = createTestAccessPolicy({urlGrant: options.urlGrant});

    const descriptionDoc = MessageContentProsemirrorSchema.node("doc", {}, [
        MessageContentProsemirrorSchema.node(
            "paragraph",
            {},
            descriptionText ? [MessageContentProsemirrorSchema.text(descriptionText)] : [],
        ),
    ]) as MessageContent;

    return new ChannelModel({
        id: generateId<ChannelId>(),
        spaceId: generateId<SpaceId>(),
        version: 1,
        createdTime: new Date(),
        name,
        description: {doc: descriptionDoc, references: emptyContentReferences},
        accessPolicy,
    });
}

function createTestTaskCollection(options: {name?: string; urlGrant?: boolean}): {
    name: string;
    hasUrlGrant: boolean;
} {
    return {
        name: options.name ?? "",
        hasUrlGrant: options.urlGrant ?? false,
    };
}

describe("getDocumentOgDescription", () => {
    test("returns null for empty document", () => {
        const emptyContent = createEmptyDocumentContent(generateId<AccountId>());
        const description = getDocumentOgDescription({
            doc: emptyContent,
            references: emptyDocumentContentReferences,
        });

        expect(description).toBeNull();
    });

    test("returns text content from document body", () => {
        const doc = DocumentWithOptionalTitleContentProsemirrorSchema.node("doc", null, [
            DocumentWithOptionalTitleContentProsemirrorSchema.node("title", null, [
                DocumentWithOptionalTitleContentProsemirrorSchema.text("Test Document"),
            ]),
            DocumentWithOptionalTitleContentProsemirrorSchema.node("paragraph", null, [
                DocumentWithOptionalTitleContentProsemirrorSchema.text(
                    "This is the first paragraph of the document.",
                ),
            ]),
            DocumentWithOptionalTitleContentProsemirrorSchema.node("paragraph", null, [
                DocumentWithOptionalTitleContentProsemirrorSchema.text(
                    "This is the second paragraph.",
                ),
            ]),
        ]) as DocumentContent;

        const description = getDocumentOgDescription({
            doc,
            references: emptyDocumentContentReferences,
        });

        expect(description).toContain("This is the first paragraph");
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

        const description = getDocumentOgDescription({doc, references});

        expect(description).toBe("Hello Alice");
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

        const description = getDocumentOgDescription({doc, references});

        expect(description).toBe("See Project Roadmap");
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

        const description = getDocumentOgDescription({doc, references});

        expect(description).toBe("See Private document");
    });

    test("returns null for documents with only whitespace after title", () => {
        const doc = DocumentWithOptionalTitleContentProsemirrorSchema.node("doc", null, [
            DocumentWithOptionalTitleContentProsemirrorSchema.node("title", null, [
                DocumentWithOptionalTitleContentProsemirrorSchema.text("Title Only"),
            ]),
            DocumentWithOptionalTitleContentProsemirrorSchema.node("paragraph"),
        ]) as DocumentContent;

        const description = getDocumentOgDescription({
            doc,
            references: emptyDocumentContentReferences,
        });

        expect(description).toBeNull();
    });
});

describe("createHeadMetaForDocument", () => {
    test("returns title only when document is not publicly shared", () => {
        const document = createTestDocument({title: "My Document", urlGrant: false});

        const result = createHeadMetaForDocument(document);

        expect(result).toEqual([{title: "My Document"}]);
    });

    test("returns fallback title when document is null", () => {
        const result = createHeadMetaForDocument(null);

        expect(result).toEqual([{title: documentFallbackTitle}]);
    });

    test("returns OG metadata when document is publicly shared", () => {
        const document = createTestDocument({
            title: "Public Document",
            bodyText: "This is the body content.",
            urlGrant: true,
        });

        const result = createHeadMetaForDocument(document);

        expect(result).toMatchObject([
            {title: "Public Document"},
            {property: "og:title", content: "Public Document | Alpine"},
            {property: "og:image", content: "https://alpine.inc/images/og.jpg"},
            {property: "og:description", content: "This is the body content."},
            {name: "description", content: "This is the body content."},
        ]);
    });

    test("returns no description when document has no body content", () => {
        const document = createTestDocument({title: "Empty Document", urlGrant: true});

        const result = createHeadMetaForDocument(document);

        expect(result).toEqual([
            {title: "Empty Document"},
            {property: "og:title", content: "Empty Document | Alpine"},
            {property: "og:image", content: "https://alpine.inc/images/og.jpg"},
        ]);
    });
});

describe("createHeadMetaForChannel", () => {
    test("returns title only when channel is not publicly shared", () => {
        const channel = createTestChannel({name: "My Channel", urlGrant: false});

        const result = createHeadMetaForChannel(channel);

        expect(result).toEqual([{title: "My Channel"}]);
    });

    test("returns OG metadata when channel is publicly shared", () => {
        const channel = createTestChannel({
            name: "Public Channel",
            descriptionText: "This is a public channel about engineering.",
            urlGrant: true,
        });

        const result = createHeadMetaForChannel(channel);

        expect(result).toMatchObject([
            {title: "Public Channel"},
            {property: "og:title", content: "Public Channel | Alpine"},
            {property: "og:image", content: "https://alpine.inc/images/og.jpg"},
            {property: "og:description", content: "This is a public channel about engineering."},
            {name: "description", content: "This is a public channel about engineering."},
        ]);
    });

    test("returns no description when channel has empty description", () => {
        const channel = createTestChannel({
            name: "Empty Channel",
            urlGrant: true,
        });

        const result = createHeadMetaForChannel(channel);

        expect(result).toEqual([
            {title: "Empty Channel"},
            {property: "og:title", content: "Empty Channel | Alpine"},
            {property: "og:image", content: "https://alpine.inc/images/og.jpg"},
        ]);
    });
});

describe("createHeadMetaForChatRoom", () => {
    test("returns title only when room is not publicly shared", () => {
        const result = createHeadMetaForChatRoom({
            name: "My Room",
            accessPolicy: createTestAccessPolicy({urlGrant: false}),
        });

        expect(result).toEqual([{title: "My Room"}]);
    });

    test("returns OG metadata when room is publicly shared", () => {
        const result = createHeadMetaForChatRoom({
            name: "Public Room",
            accessPolicy: createTestAccessPolicy({urlGrant: true}),
        });

        expect(result).toEqual([
            {title: "Public Room"},
            {property: "og:title", content: "Public Room | Alpine"},
            {property: "og:image", content: "https://alpine.inc/images/og.jpg"},
        ]);
    });
});

describe("createHeadMetaForTask", () => {
    test("returns title only when task is not publicly shared", () => {
        const notesDoc = TaskNotesContentProsemirrorSchema.node("doc", {}, [
            TaskNotesContentProsemirrorSchema.node("paragraph"),
        ]);

        const result = createHeadMetaForTask({
            title: "My Task",
            hasUrlGrant: false,
            notesDoc,
            notesReferences: emptyContentReferences,
        });

        expect(result).toEqual([{title: "My Task"}]);
    });

    test("returns OG metadata when task is publicly shared", () => {
        const notesDoc = TaskNotesContentProsemirrorSchema.node("doc", {}, [
            TaskNotesContentProsemirrorSchema.node("paragraph", {}, [
                TaskNotesContentProsemirrorSchema.text("These are the task notes."),
            ]),
        ]);

        const result = createHeadMetaForTask({
            title: "Public Task",
            hasUrlGrant: true,
            notesDoc,
            notesReferences: emptyContentReferences,
        });

        expect(result).toMatchObject([
            {title: "Public Task"},
            {property: "og:title", content: "Public Task | Alpine"},
            {property: "og:image", content: "https://alpine.inc/images/og.jpg"},
            {property: "og:description", content: "These are the task notes."},
            {name: "description", content: "These are the task notes."},
        ]);
    });

    test("returns no description when task has empty notes", () => {
        const notesDoc = TaskNotesContentProsemirrorSchema.node("doc", {}, [
            TaskNotesContentProsemirrorSchema.node("paragraph"),
        ]);

        const result = createHeadMetaForTask({
            title: "Public Task",
            hasUrlGrant: true,
            notesDoc,
            notesReferences: emptyContentReferences,
        });

        expect(result).toEqual([
            {title: "Public Task"},
            {property: "og:title", content: "Public Task | Alpine"},
            {property: "og:image", content: "https://alpine.inc/images/og.jpg"},
        ]);
    });
});

describe("createHeadMetaForTaskCollection", () => {
    test("returns title only when collection is not publicly shared", () => {
        const collection = createTestTaskCollection({
            name: "My Tasks",
            urlGrant: false,
        });

        const result = createHeadMetaForTaskCollection(collection);

        expect(result).toEqual([{title: "My Tasks"}]);
    });

    test("returns fallback title when collection is null", () => {
        const result = createHeadMetaForTaskCollection(null);

        expect(result).toEqual([{title: newTaskCollectionNamePlaceholder}]);
    });

    test("returns OG metadata when collection is publicly shared", () => {
        const collection = createTestTaskCollection({
            name: "Public Tasks",
            urlGrant: true,
        });

        const result = createHeadMetaForTaskCollection(collection);

        expect(result).toEqual([
            {title: "Public Tasks"},
            {property: "og:title", content: "Public Tasks | Alpine"},
            {property: "og:image", content: "https://alpine.inc/images/og.jpg"},
        ]);
    });
});
