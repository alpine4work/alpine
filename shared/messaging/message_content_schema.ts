import {Node, Schema as ProsemirrorSchema} from "prosemirror-model";
import {
    contentBaseProsemirrorSchemaSpec,
    createProsemirrorSchemaSpec,
} from "~/shared/content/content_schema";
import {assert} from "~/shared/helpers/control/assert";
import {createSchemaForProsemirrorSchema} from "~/shared/prosemirror/create_schema_for_prosemirror_schema";
import {Schema} from "~/shared/schema/schema";

const messageContentProsemirrorSchemaSpec = createProsemirrorSchemaSpec({
    nodes: {
        ...contentBaseProsemirrorSchemaSpec.nodes,
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

export function createSimpleMessageContent(text: string): MessageContent {
    return assertMessageContent(
        MessageContentProsemirrorSchema.node("doc", {}, [
            MessageContentProsemirrorSchema.node("paragraph", {}, [
                MessageContentProsemirrorSchema.text(text),
            ]),
        ]),
    );
}

export const MessageContentProsemirrorSchema = new ProsemirrorSchema(
    messageContentProsemirrorSchemaSpec,
);

const messageContentSchemas = createSchemaForProsemirrorSchema(MessageContentProsemirrorSchema);

export const MessageContentSchema =
    messageContentSchemas.TopNodeType as Schema<any> as Schema<MessageContent>;

export const emptyMessageContent = MessageContentProsemirrorSchema.node("doc", {}, [
    MessageContentProsemirrorSchema.node("paragraph"),
]) as MessageContent;
