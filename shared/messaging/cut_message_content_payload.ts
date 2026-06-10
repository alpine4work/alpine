import {Node} from "prosemirror-model";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {cutContent} from "~/shared/content/cut_content.js";
import {isContentBodyEmpty} from "~/shared/content/is_content_empty.js";
import {
    MessageContent,
    MessageContentProsemirrorSchema,
    MessageContentWithReferences,
    assertMessageContent,
} from "~/shared/content/message_content_schema.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {MessageStream} from "~/shared/messaging/message_schema.js";

/**
 * Cut the message content. If the message is a stream then we include stream parts
 * in the cut content.
 */
export function cutMessageContentPayload(
    message: {
        payload: {
            type: "Content";
            content:
                | MessageContentWithReferences
                | (MessageContent & {doc?: undefined; references?: undefined});
        };
        stream: MessageStream | null;
    },
    from?: number,
    to?: number,
): MessageContent {
    const {payload, stream} = message;

    const content = payload.content.doc ?? payload.content;

    if (stream === null) {
        return assertMessageContent(
            cutContent(
                content,
                clamp(0, from ?? 0, content.content.size),
                clamp(0, to ?? content.content.size, content.content.size),
            ),
        );
    }

    const nodes: Array<Node> = [];

    if (!isContentBodyEmpty(content)) {
        for (const node of content.content.content) {
            nodes.push(node);
        }
    }

    for (const part of stream.parts) {
        if (part.payload.type === "Content") {
            for (const node of part.payload.content.content.content) {
                nodes.push(node);
            }
        }
    }

    const contentWithStream = MessageContentProsemirrorSchema.nodes.doc.create({}, nodes);

    return assertMessageContent(
        cutContent(
            contentWithStream,
            clamp(0, from ?? 0, contentWithStream.content.size),
            clamp(0, to ?? contentWithStream.content.size, contentWithStream.content.size),
        ),
    );
}

/**
 * Cut the message content. If the message is a stream then we include stream parts
 * in the cut content. Behaves the same as `cutMessageContentPayload` but also
 * returns any references from the message payload.
 */
export function cutMessageContentPayloadWithReferences(
    message: {
        payload: {
            type: "Content";
            content:
                | MessageContentWithReferences
                | (MessageContent & {doc?: undefined; references?: undefined});
        };
        stream: MessageStream | null;
    },
    from?: number,
    to?: number,
): MessageContentWithReferences {
    return {
        doc: cutMessageContentPayload(message, from, to),
        references: message.payload.content.references ?? emptyContentReferences,
    };
}
