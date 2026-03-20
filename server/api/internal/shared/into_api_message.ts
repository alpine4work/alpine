import {getApiAccount} from "~/server/api/internal/shared/get_api_account.js";
import {intoApiMessageContentWithReferences} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {intoApiMessageStreamPartPayload} from "~/server/api/internal/shared/into_api_message_stream_part_payload.js";
import {ServerBotActionContext} from "~/server/context/server_action_context.js";
import {MessageItem} from "~/server/messaging/helpers/process_messages_query.js";
import {
    ApiMessageContentPayloadParentResponse,
    ApiMessagePayloadResponse,
    ApiMessageResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {MessageContentPayloadParent, MessagePayload} from "~/shared/messaging/message_schema.js";

export async function intoApiMessage(
    context: ServerBotActionContext,
    spaceId: SpaceId,
    message: MessageItem,
    intoContentPayloadParent: (
        parent: MessageContentPayloadParent,
    ) => Promise<ApiMessageContentPayloadParentResponse | null>,
): Promise<ApiMessageResponse> {
    const [author, payload, streamParts] = await runAllPromises([
        getApiAccount(context, spaceId, message.authorId, {consistency: "StrongWithinCache"}),
        intoApiMessagePayload(context, spaceId, message.payload, intoContentPayloadParent),
        message.stream
            ? runAllPromises(
                  message.stream.parts.map(part =>
                      intoApiMessageStreamPartPayload(context, spaceId, part.payload),
                  ),
              )
            : null,
    ]);

    if (!streamParts) {
        return {
            index: message.index,
            author,
            createdTime: serializeDateString(message.createdTime),
            createdTimeZone: message.createdTimeZone,
            payload,
        };
    }

    // Only content messages can have a stream.
    assert(payload.type === "Content");

    const contentElements =
        // If the original message has empty content then ignore it.
        payload.content.elements.length === 1 &&
        payload.content.elements[0]!.type === "Paragraph" &&
        payload.content.elements[0]!.elements.length === 0
            ? []
            : [...payload.content.elements];

    for (const streamPart of streamParts) {
        switch (streamPart.type) {
            case "ToolCall": {
                // TODO(calebmer, #api): Find a way to represent tool calls in the API. I'm
                // imagining we have a `stream` property on messages with a `parts` array. If the
                // `parts` array has content we've already added to `content` then we reference
                // that content with an index.
                break;
            }
            case "Reasoning": {
                // TODO(ifitzsimmons, #api): Don't show Reasoning summaries in the returned message
                // content. This ultimately will get loaded in Agent Conversation context and is a
                // bad use of tokens. We should expose a way to fetch a message along with _all_ of
                // its stream parts.
                break;
            }
            case "Content": {
                // Concatenate all the streamed content into the content we return from the API.
                // That way in rendering code developers don't have to worry about whether this is
                // a streamed message or not. They can render the content all the same.
                for (const element of streamPart.content.elements) {
                    contentElements.push(element);
                }
                break;
            }
            default:
                throw exhaustive(streamPart);
        }
    }

    if (contentElements.length === 0) {
        contentElements.push({type: "Paragraph", elements: []});
    }

    return {
        index: message.index,
        author,
        createdTime: serializeDateString(message.createdTime),
        createdTimeZone: message.createdTimeZone,
        payload: {
            ...payload,
            content: {elements: contentElements},
        },
    };
}

async function intoApiMessagePayload(
    context: ServerBotActionContext,
    spaceId: SpaceId,
    payload: MessagePayload,
    intoContentPayloadParent: (
        parent: MessageContentPayloadParent,
    ) => Promise<ApiMessageContentPayloadParentResponse | null>,
): Promise<ApiMessagePayloadResponse> {
    switch (payload.type) {
        case "Deleted": {
            return {type: "Deleted"};
        }
        case "Content":
            const [contentWithReferences, parent] = await runAllPromises([
                intoApiMessageContentWithReferences(context, spaceId, payload.content),
                payload.parent ? intoContentPayloadParent(payload.parent) : undefined,
            ]);

            return {
                type: "Content",
                parent: parent ?? undefined,
                content: contentWithReferences,
            };
        default:
            throw exhaustive(payload);
    }
}
