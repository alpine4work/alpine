import {getApiAccount} from "~/server/api/internal/shared/get_api_account.js";
import {intoApiMessageContentWithReferences} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {intoApiMessageStreamPartPayload} from "~/server/api/internal/shared/into_api_message_stream_part_payload.js";
import {ServerBotActionContext} from "~/server/context/server_action_context.js";
import {resolveFilesForApiResponse} from "~/server/files/data/resolve_files_for_api_response.js";
import {MessageItem} from "~/server/messaging/helpers/process_messages_query.js";
import {ApiContentKeyEncoder} from "~/shared/api/content/closed_source/api_content_key_encoder.js";
import {
    ApiMessageContentPayloadParentResponse,
    ApiMessagePayloadResponse,
    ApiMessageResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {isContentBodyEmpty} from "~/shared/content/is_content_empty.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {
    MessageContentPayload,
    MessageContentPayloadParent,
    MessagePayload,
    MessageStream,
    getMessageContentVersion,
} from "~/shared/messaging/message_schema.js";
import {SearchDynamicEntityId} from "~/shared/search/search_entity_id.js";

export async function intoApiMessage(
    context: ServerBotActionContext,
    {
        spaceId,
        entityId,
        message,
        intoContentPayloadParent,
    }: {
        spaceId: SpaceId;
        entityId: SearchDynamicEntityId;
        message: MessageItem;
        intoContentPayloadParent: (
            parent: MessageContentPayloadParent,
        ) => Promise<ApiMessageContentPayloadParentResponse | null>;
    },
): Promise<ApiMessageResponse> {
    const referencesContext = context.dynamo.unexpectStrongReadConsistency();

    const stream = message.stream;
    let streamPartsPromise: Promise<
        Array<Awaited<ReturnType<typeof intoApiMessageStreamPartPayload>>>
    > | null = null;

    if (stream !== null) {
        assert(message.payload.type === "Content");
        const contentKeyEncoder = new ApiContentKeyEncoder({
            entityId,
            version: getMessageContentVersion(message.payload),
        });

        const streamPartPosOffsets = getMessageStreamPartPosOffsets({
            payload: message.payload,
            stream,
        });

        streamPartsPromise = runAllPromises(
            stream.parts.map((part, partIndex) =>
                intoApiMessageStreamPartPayload(referencesContext, {
                    spaceId,
                    payload: part.payload,
                    contentKeyEncoder,
                    posOffset: streamPartPosOffsets[partIndex],
                }),
            ),
        );
    }

    const [author, payload, streamParts] = await runAllPromises([
        getApiAccount(referencesContext, spaceId, message.authorId),
        intoApiMessagePayload(referencesContext, {
            spaceId,
            payload: message.payload,
            intoContentPayloadParent,
            entityId,
        }),
        streamPartsPromise,
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
    assert(message.payload.type === "Content");

    const firstElement = payload.content.elements[0];
    // If the original message has empty content then ignore it. It'll be replaced with
    // the stream parts or restored below if the stream has no content.
    const contentElements = isContentBodyEmpty(message.payload.content)
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
        assert(firstElement?.type === "Paragraph");
        contentElements.push(firstElement);
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
    {
        spaceId,
        payload,
        intoContentPayloadParent,
        entityId,
    }: {
        spaceId: SpaceId;
        payload: MessagePayload;
        intoContentPayloadParent: (
            parent: MessageContentPayloadParent,
        ) => Promise<ApiMessageContentPayloadParentResponse | null>;
        entityId: SearchDynamicEntityId;
    },
): Promise<ApiMessagePayloadResponse> {
    switch (payload.type) {
        case "Deleted": {
            return {type: "Deleted"};
        }
        case "Content": {
            const referencesContext = context.dynamo.unexpectStrongReadConsistency();

            const contentKeyEncoder = new ApiContentKeyEncoder({
                entityId,
                version: getMessageContentVersion(payload),
            });
            const [contentWithReferences, parent, files] = await runAllPromises([
                intoApiMessageContentWithReferences(referencesContext, {
                    spaceId,
                    node: payload.content,
                    encoder: contentKeyEncoder,
                }),
                payload.parent ? intoContentPayloadParent(payload.parent) : undefined,
                resolveFilesForApiResponse(
                    referencesContext,
                    spaceId,
                    payload.fileIds,
                    contentKeyEncoder,
                ),
            ]);

            return {
                type: "Content",
                parent: parent ?? undefined,
                content: contentWithReferences,
                files,
            };
        }
        default:
            throw exhaustive(payload);
    }
}

/**
 * Computes the top-level ProseMirror position where each stream part's content
 * begins in the merged message content.
 */
function getMessageStreamPartPosOffsets({
    payload,
    stream,
}: {
    payload: MessageContentPayload;
    stream: MessageStream;
}): ReadonlyArray<number> {
    const posOffsetByPartIndex: Array<number> = [];
    let posOffset = isContentBodyEmpty(payload.content) ? 0 : payload.content.content.size;

    for (const [partIndex, part] of stream.parts.entries()) {
        posOffsetByPartIndex[partIndex] = posOffset;

        if (part.payload.type === "Content") {
            posOffset += part.payload.content.content.size;
        }
    }

    return posOffsetByPartIndex;
}
