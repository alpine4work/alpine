import {DocAttrStep} from "prosemirror-transform";
import {ContentMention} from "~/shared/content/content_mention.js";
import {assertContentTypeNamesCoverProsemirrorSchema} from "~/shared/content/content_node_type_name.js";
import {DocumentContentCover} from "~/shared/documents/document_content_cover.js";
import {
    DocumentContentProsemirrorSchema,
    DocumentContentSchema,
    DocumentContentStepSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {cast} from "~/shared/helpers/control/cast.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {DocumentId} from "~/shared/id/types/id_types.open_source.js";

test("content type names cover schema", () => {
    assertContentTypeNamesCoverProsemirrorSchema(DocumentContentProsemirrorSchema);
});

test("cover document attribute steps survive schema serialization", () => {
    const cover = {
        type: "Blobs",
        seed: "history-cover",
        themeColor: "indigo",
        hueSpread: 45,
    } satisfies DocumentContentCover;
    const step = new DocAttrStep("cover", cover);

    const deserializedStep = DocumentContentStepSchema.deserialize(
        DocumentContentStepSchema.serialize(step),
    );

    expect(deserializedStep.toJSON()).toEqual(step.toJSON());
});

test("mention with mark survives schema serialization/deserialization", () => {
    const documentId = generateId<DocumentId>();

    const doc = assertDocumentContent(
        DocumentContentProsemirrorSchema.nodeFromJSON({
            type: "doc",
            attrs: {
                accessPolicy: {
                    type: "Local",
                    accountGrantById: new Map(),
                    defaultGrant: null,
                    urlGrant: null,
                },
                hasPresentShortcut: false,
                cover: null,
            },
            content: [
                {type: "title"},
                {
                    type: "paragraph",
                    content: [
                        {
                            type: "text",
                            marks: [{type: "highlight", attrs: {color: "orange"}}],
                            text: "Test ",
                        },
                        {
                            type: "mention",
                            attrs: {
                                mention: cast<ContentMention>({
                                    type: "SearchEntity",
                                    entityId: `Document:${documentId}`,
                                }),
                            },
                            marks: [{type: "highlight", attrs: {color: "orange"}}],
                        },
                    ],
                },
            ],
        }),
    );

    doc.check();

    const serializedDoc = DocumentContentSchema.serialize(doc);
    const deserializedDoc = DocumentContentSchema.deserialize(serializedDoc);

    expect(deserializedDoc.toJSON()).toEqual({
        type: "doc",
        attrs: {
            accessPolicy: {
                type: "Local",
                accountGrantById: new Map(),
                defaultGrant: null,
                urlGrant: null,
            },
            hasPresentShortcut: false,
            cover: null,
            deletedTime: null,
        },
        content: [
            {type: "title"},
            {
                type: "paragraph",
                content: [
                    {
                        type: "text",
                        marks: [{type: "highlight", attrs: {color: "orange"}}],
                        text: "Test ",
                    },
                    {
                        type: "mention",
                        attrs: {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: `Document:${documentId}`,
                            }),
                        },
                        marks: [{type: "highlight", attrs: {color: "orange"}}],
                    },
                ],
            },
        ],
    });
});
