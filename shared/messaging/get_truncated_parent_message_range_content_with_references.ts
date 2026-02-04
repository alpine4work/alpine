import {
    ContentReferences,
    emptyContentReferences,
    mergeContentReferences,
} from "~/shared/content/content_references.js";
import {
    MessageContent,
    MessageContentProsemirrorSchema,
    MessageContentWithReferences,
    assertMessageContent,
    createSimpleMessageContent,
} from "~/shared/content/message_content_schema.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {cutMessageContentPayload} from "~/shared/messaging/cut_message_content_payload.js";
import {mapMessagePosFromContentVersion} from "~/shared/messaging/map_message_pos_from_content_version.js";
import {
    MessageContentPayloadContentUpdate,
    MessageStream,
} from "~/shared/messaging/message_schema.js";

export function getTruncatedParentMessagesRangeContentWithReferences({
    messages,
    messageNoun,
    startContentVersion,
    startPos,
    endContentVersion,
    endPos,
}: {
    messages: ReadonlyArray<{
        index: number;
        payload:
            | {type: "Deleted"}
            | {
                  type: "Content";
                  content:
                      | (MessageContent & {references?: undefined; doc?: undefined})
                      | MessageContentWithReferences;
                  contentUpdate: MessageContentPayloadContentUpdate | null;
              };
        stream: MessageStream | null;
    }>;
    messageNoun: string;
    startContentVersion: number;
    startPos: number;
    endContentVersion: number;
    endPos: number;
}): MessageContentWithReferences {
    const startMessage = messages[0]!;
    const endMessage = messages[messages.length - 1]!;

    let startPayload: {type: "Deleted"} | {type: "Content"; content: MessageContentWithReferences};

    let endPayload:
        | {type: "Deleted"}
        | {type: "Content"; content: MessageContentWithReferences}
        | undefined;

    if (startMessage.index === endMessage.index) {
        switch (startMessage.payload.type) {
            case "Deleted": {
                startPayload = startMessage.payload;
                break;
            }
            case "Content": {
                const actualStartPos = mapMessagePosFromContentVersion(
                    startMessage.payload,
                    startContentVersion,
                    startPos,
                    1,
                );

                const actualEndPos = mapMessagePosFromContentVersion(
                    startMessage.payload,
                    startContentVersion,
                    endPos,
                    -1,
                );

                startPayload = {
                    type: "Content",
                    content: {
                        doc: cutMessageContentPayload(
                            {payload: startMessage.payload, stream: startMessage.stream},
                            actualStartPos,
                            actualEndPos,
                        ),
                        references:
                            startMessage.payload.content.references ?? emptyContentReferences,
                    },
                };
                break;
            }
            default:
                throw exhaustive(startMessage.payload);
        }
    } else {
        switch (startMessage.payload.type) {
            case "Deleted": {
                startPayload = startMessage.payload;
                break;
            }
            case "Content": {
                const pos = mapMessagePosFromContentVersion(
                    startMessage.payload,
                    startContentVersion,
                    startPos,
                    1,
                );

                startPayload = {
                    type: "Content",
                    content: {
                        doc: cutMessageContentPayload(
                            {payload: startMessage.payload, stream: startMessage.stream},
                            pos,
                        ),
                        references:
                            startMessage.payload.content.references ?? emptyContentReferences,
                    },
                };
                break;
            }
            default:
                throw exhaustive(startMessage.payload);
        }

        switch (endMessage.payload.type) {
            case "Deleted": {
                endPayload = endMessage.payload;
                break;
            }
            case "Content": {
                const pos = mapMessagePosFromContentVersion(
                    endMessage.payload,
                    endContentVersion,
                    endPos,
                    -1,
                );

                endPayload = {
                    type: "Content",
                    content: {
                        doc: cutMessageContentPayload(
                            {payload: endMessage.payload, stream: endMessage.stream},
                            0,
                            pos,
                        ),
                        references: endMessage.payload.content.references ?? emptyContentReferences,
                    },
                };
                break;
            }
            default:
                throw exhaustive(endMessage.payload);
        }
    }

    const payloads = [startPayload, ...messages.slice(1, -1).map(message => message.payload)];

    if (endPayload !== undefined) payloads.push(endPayload);

    const docs: Array<MessageContent> = [];
    let references: ContentReferences | null = null;

    for (const payload of payloads) {
        switch (payload.type) {
            case "Content": {
                docs.push(payload.content.doc ?? payload.content);
                if (references === null) {
                    references = payload.content.references ?? emptyContentReferences;
                } else {
                    references = mergeContentReferences(
                        references,
                        payload.content.references ?? emptyContentReferences,
                    );
                }
                break;
            }
            case "Deleted": {
                docs.push(createSimpleMessageContent(`Deleted ${messageNoun}`));
                break;
            }
            default:
                throw exhaustive(payload);
        }
    }

    return {
        doc: assertMessageContent(
            MessageContentProsemirrorSchema.nodes.doc.create(
                null,
                docs.flatMap(doc => doc.content.content),
            ),
        ),
        references: references ?? emptyContentReferences,
    };
}

export function getTruncatedParentMessagesRangeContentWithoutReferences(options: {
    messages: ReadonlyArray<{
        index: number;
        payload:
            | {type: "Deleted"}
            | {
                  type: "Content";
                  content:
                      | (MessageContent & {references?: undefined; doc?: undefined})
                      | MessageContentWithReferences;
                  contentUpdate: MessageContentPayloadContentUpdate | null;
              };
        stream: MessageStream | null;
    }>;
    messageNoun: string;
    startContentVersion: number;
    startPos: number;
    endContentVersion: number;
    endPos: number;
}): MessageContent {
    return getTruncatedParentMessagesRangeContentWithReferences(options).doc;
}
