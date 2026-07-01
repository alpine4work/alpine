import {getApiAccount} from "~/server/api/internal/shared/get_api_account.js";
import {
    getSearchEntityMentionTitleForApi,
    intoApiMessageContentWithReferences,
} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {intoApiMessageStreamPartPayload} from "~/server/api/internal/shared/into_api_message_stream_part_payload.js";
import {getContentFileReferenceWithoutSignedUrlSearch} from "~/server/content/get_content_references.js";
import {ServerBotActionContext} from "~/server/context/server_action_context.js";
import {FileAuthorizer} from "~/server/files/data/file_authorizer.js";
import {MessageItem} from "~/server/messaging/helpers/process_messages_query.js";
import {ApiContentKeyEncoder} from "~/shared/api/content/closed_source/api_content_key_encoder.js";
import {computeApiContentFileRowWidths} from "~/shared/api/content/closed_source/compute_api_content_file_row_widths.js";
import {intoApiTaskStatus} from "~/shared/api/content/closed_source/into_api_task_status.js";
import {getApiMentionReferenceNoun} from "~/shared/api/content/get_api_mention_reference_noun.js";
import {
    ApiMessageContentPayloadFileElementResponse,
    ApiMessageContentPayloadFileResponse,
    ApiMessageContentPayloadParentResponse,
    ApiMessageContentPayloadPreviewElementResponse,
    ApiMessagePayloadResponse,
    ApiMessageResponse,
    ApiPreviewReferenceResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {fileRowMaxFileCount} from "~/shared/content/compute_file_row_layout.js";
import {isContentBodyEmpty} from "~/shared/content/is_content_empty.js";
import {FileEntityId, parseFileEntityId} from "~/shared/files/file_entity_id.js";
import {FileModelData} from "~/shared/files/file_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {isId} from "~/shared/id/id.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {
    MessageContentPayload,
    MessageContentPayloadParent,
    MessagePayload,
    MessageStream,
    getMessageContentVersion,
} from "~/shared/messaging/message_schema.js";
import {SearchDynamicEntityId} from "~/shared/search/search_entity_id.js";
import {TaskDisplayStatus} from "~/shared/tasks/task_display_status.js";

export async function intoApiMessage(
    context: ServerBotActionContext,
    {
        spaceId,
        entityId,
        fileAuthorizer,
        message,
        intoContentPayloadParent,
    }: {
        spaceId: SpaceId;
        entityId: SearchDynamicEntityId;
        fileAuthorizer: FileAuthorizer;
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
            fileAuthorizer,
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
        fileAuthorizer,
        payload,
        intoContentPayloadParent,
        entityId,
    }: {
        spaceId: SpaceId;
        fileAuthorizer: FileAuthorizer;
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
                    content: payload.content,
                    contentKeyEncoder,
                }),
                payload.parent ? intoContentPayloadParent(payload.parent) : undefined,
                intoApiMessagePayloadFiles(context, {
                    spaceId,
                    fileAuthorizer,
                    fileIds: payload.fileIds,
                }),
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

// NOCOMMIT: Test with `FileId`s and `FileEntityId`s
async function intoApiMessagePayloadFiles(
    context: ServerBotActionContext,
    {
        spaceId,
        fileAuthorizer,
        fileIds,
    }: {
        spaceId: SpaceId;
        fileAuthorizer: FileAuthorizer;
        fileIds: ReadonlyArray<FileId | FileEntityId>;
    },
) {
    type Element =
        | ApiMessageContentPayloadFileElementResponse
        | ApiMessageContentPayloadPreviewElementResponse;

    const fileById = new Map<FileId, FileModelData>();

    const elements = await runAllPromises(
        mapIterable(fileIds, async (fileOrEntityId): Promise<Element> => {
            // IMPORTANT: This code is copied from `into_api_content.ts`, specifically
            // `intoApiContentFileOrPreviewElement()`. If you make a change to this code you
            // probably need to make a change there too.

            if (isId<FileId>(fileOrEntityId)) {
                const file = await getContentFileReferenceWithoutSignedUrlSearch(
                    context,
                    fileOrEntityId,
                    fileAuthorizer,
                );

                if (file) fileById.set(fileOrEntityId, file.initialData);

                // IMPORTANT: This code is copied to `into_api_message.ts`, specifically
                // `intoApiMessagePayloadFiles()`. If you make a change to this code you probably
                // need to make a change there too.
                return {
                    type: "File",
                    id: fileOrEntityId,
                    contentType: file?.contentType ?? "application/octet-stream",
                    contentLength: file?.contentLength ?? 0,
                };
            }

            const entityResult = await context.searchInjection.getSearchMentionEntityIfPossible(
                spaceId,
                fileOrEntityId,
            );

            const entityIdObject = parseFileEntityId(fileOrEntityId);

            // IMPORTANT: This code is copied to `into_api_message.ts`, specifically
            // `intoApiMessagePayloadFiles()`. If you make a change to this code you probably
            // need to make a change there too.
            const title =
                getSearchEntityMentionTitleForApi(fileOrEntityId, entityResult) ??
                `Unknown ${getApiMentionReferenceNoun(entityIdObject.type)}`;

            let reference: ApiPreviewReferenceResponse;

            switch (entityIdObject.type) {
                case "Channel": {
                    reference = {
                        type: "Channel",
                        id: entityIdObject.channelId,
                        title,
                    };
                    break;
                }
                case "Chat": {
                    reference = {
                        type: "Chat",
                        id: entityIdObject.chatId,
                        title,
                    };
                    break;
                }
                case "Document": {
                    reference = {
                        type: "Document",
                        id: entityIdObject.documentId,
                        title,
                    };
                    break;
                }
                case "Post": {
                    reference = {
                        type: "Post",
                        id: entityIdObject.postId,
                        title,
                    };
                    break;
                }
                case "Task": {
                    let displayStatus: TaskDisplayStatus | undefined;

                    if (entityResult && !entityResult.isPrivate) {
                        assert(entityResult.entity.initialData.type === "Task");
                        displayStatus = entityResult.entity.initialData.task.displayStatus.value;
                    }

                    reference = {
                        type: "Task",
                        id: entityIdObject.taskId,
                        title,
                        status: intoApiTaskStatus(displayStatus ?? "Closed"),
                    };
                    break;
                }
                case "TaskCollection": {
                    reference = {
                        type: "TaskCollection",
                        id: entityIdObject.collectionId,
                        title,
                    };
                    break;
                }
                case "Site": {
                    reference = {
                        type: "Site",
                        id: entityIdObject.siteId,
                        title,
                    };
                    break;
                }
                default:
                    throw exhaustive(entityIdObject);
            }

            // IMPORTANT: This code is copied to `into_api_message.ts`, specifically
            // `intoApiMessagePayloadFiles()`. If you make a change to this code you probably
            // need to make a change there too.
            return {
                type: "Preview",
                reference,
            };
        }),
    );

    const files: Array<ApiMessageContentPayloadFileResponse> = [];

    for (let rowIndex = 0; rowIndex * fileRowMaxFileCount < elements.length; rowIndex++) {
        const rowElements = elements.slice(
            rowIndex * fileRowMaxFileCount,
            (rowIndex + 1) * fileRowMaxFileCount,
        );

        const widths = computeApiContentFileRowWidths(rowElements, {
            getFileIfExists: fileId => fileById.get(fileId),
        });

        for (let fileIndex = 0; fileIndex < rowElements.length; fileIndex++) {
            files.push({
                rowIndex,
                width: widths[fileIndex]!,
                element: rowElements[fileIndex]!,
            });
        }
    }

    return files;
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
