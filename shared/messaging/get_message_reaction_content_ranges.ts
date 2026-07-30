import {Node} from "prosemirror-model";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {MessageContentPayload, MessageStream} from "~/shared/messaging/message_schema.js";

/**
 * Builds reaction target ranges over the message's base content followed by all
 * content-bearing stream parts.
 */
export function getMessageReactionContentRanges(message: {
    payload: MessageContentPayload;
    stream: MessageStream;
}): ReadonlyArray<{from: number; to: number}> {
    const ranges: Array<{from: number; to: number}> = [];
    let pos = 0;

    if (!isContentEmpty(message.payload.content)) {
        pos = addMessageReactionContentRanges(ranges, pos, message.payload.content);
    }

    for (const part of message.stream.parts) {
        if (part.payload.type !== "Content") continue;
        pos = addMessageReactionContentRanges(ranges, pos, part.payload.content);
    }

    return ranges;
}

/**
 * Appends one reaction range per top-level content block and returns the next
 * global position after the appended content.
 */
function addMessageReactionContentRanges(
    ranges: Array<{from: number; to: number}>,
    startPos: number,
    content: Node,
): number {
    let pos = startPos;

    for (let i = 0; i < content.childCount; i++) {
        const node = content.child(i);
        const from = pos;
        const to = from + node.nodeSize;

        ranges.push({from, to});

        pos = to;
    }

    return pos;
}
