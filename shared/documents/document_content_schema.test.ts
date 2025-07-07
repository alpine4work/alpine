import {ContentMention} from "~/shared/content/content_mention.js";
import {assertContentTypeNamesCoverProsemirrorSchema} from "~/shared/content/content_node_type_name.js";
import {
    DocumentContentProsemirrorSchema,
    DocumentContentSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

test("content type names cover schema", () => {
    assertContentTypeNamesCoverProsemirrorSchema(DocumentContentProsemirrorSchema);
});

test("mention with mark survives schema serialization/deserialization", () => {
    const documentId = generateId<DocumentId>();

    const doc = assertDocumentContent(
        DocumentContentProsemirrorSchema.nodeFromJSON({
            type: "doc",
            attrs: {
                accessPolicy: {
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
    });
});
