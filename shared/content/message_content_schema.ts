import {Node, Schema as ProsemirrorSchema} from "prosemirror-model";
import {
    contentBaseProsemirrorSchemaSpec,
    createProsemirrorSchemaSpec,
} from "~/shared/content/content_schema";
import {assert} from "~/shared/helpers/control/assert";
import {Schema, SchemaDeserializationError} from "~/shared/schema/schema";

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

export const MessageContentSchema = Schema.unknown.transform<MessageContent>({
    serialize: content => content.toJSON(),
    deserialize: unknownValue => {
        let content;
        try {
            content = MessageContentProsemirrorSchema.nodeFromJSON(unknownValue);
        } catch {
            throw new SchemaDeserializationError("Invalid message content");
        }

        if (!isMessageContent(content))
            throw new SchemaDeserializationError("Invalid message content");

        return content;
    },
});

export const emptyMessageContent = MessageContentProsemirrorSchema.node("doc", {}, [
    MessageContentProsemirrorSchema.node("paragraph"),
]) as MessageContent;
