import {Node, Schema as ProsemirrorSchema} from "prosemirror-model";
import {
    ContentReferencesSchema,
    emptyContentReferences,
} from "~/shared/content/content_references.js";
import {
    contentBaseProsemirrorSchemaSpec,
    createProsemirrorSchemaSpec,
} from "~/shared/content/content_schema.js";
import {contentMentionProsemirrorNodeSpecs} from "~/shared/content/content_schema_extra.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {createSchemaForProsemirrorSchema} from "~/shared/prosemirror/create_schema_for_prosemirror_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

const messageContentProsemirrorSchemaSpec = createProsemirrorSchemaSpec({
    nodes: {
        ...contentBaseProsemirrorSchemaSpec.nodes,
        ...contentMentionProsemirrorNodeSpecs,
    },
    marks: {
        ...contentBaseProsemirrorSchemaSpec.marks,
    },
});

export type MessageContent = Node & {_MessageContent: never};

export function isMessageContent(node: Node): node is MessageContent {
    return node.type.schema === MessageContentProsemirrorSchema && node.type.name === "doc";
}

export function assertMessageContent(node: Node): MessageContent {
    assert(isMessageContent(node));
    return node;
}

export function createSimpleMessageContent(text?: string): MessageContent {
    return assertMessageContent(
        MessageContentProsemirrorSchema.node("doc", {}, [
            MessageContentProsemirrorSchema.node(
                "paragraph",
                {},
                text ? [MessageContentProsemirrorSchema.text(text)] : [],
            ),
        ]),
    );
}

export const MessageContentProsemirrorSchema = new ProsemirrorSchema(
    messageContentProsemirrorSchemaSpec,
);

// Property `isMessageContentSchema()` looks for to tell if a ProseMirror schema is
// the `MessageContent` schema.
(MessageContentProsemirrorSchema as any)._isMessageContent = true;

const messageContentSchemas = createSchemaForProsemirrorSchema(MessageContentProsemirrorSchema);

export const MessageContentSchema =
    messageContentSchemas.TopNodeType as Schema<any> as Schema<MessageContent>;

export const MessageContentStepSchema = messageContentSchemas.createStepSchema();

export const emptyMessageContent = MessageContentProsemirrorSchema.node("doc", {}, [
    MessageContentProsemirrorSchema.node("paragraph"),
]) as MessageContent;

export const MessageContentWithReferencesSchema = Schema.object({
    doc: MessageContentSchema,
    references: ContentReferencesSchema,
});

export type MessageContentWithReferences = SchemaType<typeof MessageContentWithReferencesSchema>;

export const emptyMessageContentWithReferences: MessageContentWithReferences = {
    doc: emptyMessageContent,
    references: emptyContentReferences,
};
