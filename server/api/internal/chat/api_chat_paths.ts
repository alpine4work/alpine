import {createIntoApiChatMessageContentPayloadParent} from "~/server/api/internal/chat/internal/create_into_api_chat_message_content_payload_parent.js";
import {
    ApiOperation200JsonResponseType,
    ApiPaths,
} from "~/server/api/internal/shared/api_paths_type.js";
import {fromApiMessageContentPayloadParent} from "~/server/api/internal/shared/from_api_message_content_payload_parent.js";
import {fromApiMessageStreamPartPayload} from "~/server/api/internal/shared/from_api_message_stream_part_payload.js";
import {getApiAccount} from "~/server/api/internal/shared/get_api_account.js";
import {getFileIdOrFileEntityIdFromApiMessageContentPayloadFile} from "~/server/api/internal/shared/get_file_id_or_file_entity_id_from_api_message_content_payload_file.js";
import {getApiMentionTitleWithStrongConsistency} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {intoApiMessage} from "~/server/api/internal/shared/into_api_message.js";
import {intoApiMessageExperimentalApproval} from "~/server/api/internal/shared/into_api_message_stream_part_payload.js";
import {
    broadcastPutChatMessageStreamPart,
    completeChatMessageStream,
    getChatMessageApprovals,
    getChatMessagePayload,
    getChatMessagePayloadsFromEnd,
    getChatMessagePayloadsFromStart,
    pingChatMessageStream,
    putChatMessageApprovalDecisions,
    putChatMessageStreamPart,
    sendChatMessage,
} from "~/server/chat/data/chat_messaging.js";
import {FileChatAuthorizer} from "~/server/chat/data/file_chat_authorizer.js";
import {getChatDefinition} from "~/server/chat/data/get_chat_definition.js";
import {getOrCreateChatForAccounts} from "~/server/chat/data/get_or_create_chat_for_accounts.js";
import {attachFileToTargetAsBot} from "~/server/files/data/attach_file_to_target_as_bot.js";
import {getSearchDirectChatEntityTitleAndMedia} from "~/server/search/data/index/search_entity_index.js";
import {fromApiContent} from "~/shared/api/content/closed_source/from_api_content.js";
import {ApiDirectChat} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/content/message_content_schema.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {isId} from "~/shared/id/id.js";
import {FileId} from "~/shared/id/types/id_types.js";
import {MessageContentPayload} from "~/shared/messaging/message_schema.js";
import {MessagingRealtimeBroadcastNewMessageRequestSchema} from "~/shared/messaging/messaging_realtime_protocol.js";
import {emptyReactionSet} from "~/shared/reactions/reaction_set.js";

export const apiChatPaths: Pick<ApiPaths, (keyof ApiPaths & `/chats/${string}`) | "/chats"> = {
    "/chats": {
        post: async (context, {requestBody}) => {
            switch (requestBody.chat.type) {
                case "Direct": {
                    const accountIds = new Set(
                        mapIterable(requestBody.chat.members, member => member.account.id),
                    );

                    if (!accountIds.has(context.actor.getPossiblyBotAccountId())) {
                        throw new UnimplementedError(
                            "Getting direct chats that don\u2019t include the bot account isn\u2019t implemented (but it could be)",
                            {
                                displayMessage: errorDisplayMessage`Must include the current bot in \`accountIds\`. We may add support for creating a chat by \`accountIds\` that doesn\u2019t include the current bot in the future because bots are allowed to read chats they aren\u2019t in if the chat is within their access scope.`,
                            },
                        );
                    }

                    const chatId = await getOrCreateChatForAccounts(context, {
                        consistency: "StrongWithinCache",
                        spaceId: requestBody.spaceId,
                        otherAccountIds: Array.from(
                            filterIterable(
                                accountIds,
                                accountId => accountId !== context.actor.getPossiblyBotAccountId(),
                            ),
                        ),
                    });

                    const {title, sortedAccountIds} = await getSearchDirectChatEntityTitleAndMedia(
                        context,
                        requestBody.spaceId,
                        chatId,
                        accountIds,
                    );

                    const chat = {
                        type: "Direct" as const,
                        id: chatId,
                        members: await runAllPromises(
                            mapIterable(sortedAccountIds, async accountId => ({
                                account: await getApiAccount(
                                    context,
                                    requestBody.spaceId,
                                    accountId,
                                    {consistency: "StrongWithinCache"},
                                ),
                            })),
                        ),
                        reference: {title},
                    };

                    return {
                        content: {
                            spaceId: requestBody.spaceId,
                            chat,
                        },
                    };
                }
                case "Room": {
                    // TODO(#public-api-blocking, #agents-web): We support creating room chats in the
                    // types but we don't actually implement it yet. That's because we'd want to
                    // implement the whole `creator.from` setup and proper access policy for a bot
                    // created thing. For now while I'm supposed to be working on agent web changes I
                    // won't implement this.
                    throw new UnimplementedError(
                        "Creating room chats from the API isn\u2019t implemented yet",
                    );
                }
                default:
                    throw exhaustive(requestBody.chat);
            }
        },
    },

    "/chats/{id}": {
        get: async (context, {pathParameters}) => {
            const chatDefinition = await getChatDefinition(context, pathParameters.id, {
                consistency: "StrongWithinCache",
            });

            switch (chatDefinition.definition.type) {
                case "Direct": {
                    const {title, sortedAccountIds} = await getSearchDirectChatEntityTitleAndMedia(
                        context,
                        chatDefinition.spaceId,
                        pathParameters.id,
                        chatDefinition.definition.accountIds,
                    );

                    const chat: ApiDirectChat = {
                        type: "Direct",
                        id: pathParameters.id,
                        members: await runAllPromises(
                            mapIterable(sortedAccountIds, async accountId => ({
                                account: await getApiAccount(
                                    context,
                                    chatDefinition.spaceId,
                                    accountId,
                                    {consistency: "StrongWithinCache"},
                                ),
                            })),
                        ),
                        // NOCOMMIT: Test!!
                        reference: {title},
                    };

                    return {
                        content: {
                            spaceId: chatDefinition.spaceId,
                            chat,
                        },
                    };
                }
                case "Room": {
                    return {
                        content: {
                            spaceId: chatDefinition.spaceId,
                            chat: {
                                type: "Room",
                                id: pathParameters.id,
                                name: chatDefinition.definition.name,
                            },
                        },
                    };
                }
                default:
                    throw exhaustive(chatDefinition.definition);
            }
        },
    },

    "/chats/{id}/reference": {
        get: async (context, {pathParameters}) => {
            const spaceId = context.actor.getSpaceId();

            const {title} = await getApiMentionTitleWithStrongConsistency(
                context,
                spaceId,
                `Chat:${pathParameters.id}`,
            );

            return {
                content: {
                    spaceId,
                    reference: {
                        type: "Chat",
                        id: pathParameters.id,
                        title,
                    },
                },
            };
        },
    },

    "/chats/{id}/messages/{index}": {
        get: async (context, {pathParameters, url}) => {
            const message = await getChatMessagePayload(context, {
                chatId: pathParameters.id,
                messageIndex: pathParameters.index,
                consistency: "StrongWithinCache",
            });

            let content: ApiOperation200JsonResponseType<"/chats/{id}/messages/{index}", "get"> = {
                spaceId: message.spaceId,
                message: await intoApiMessage(context, {
                    spaceId: message.spaceId,
                    entityId: `ChatMessage:${pathParameters.id}-${pathParameters.index}`,
                    fileAuthorizer: FileChatAuthorizer.bind({
                        type: "ChatMessages",
                        chatId: pathParameters.id,
                    }),
                    message,
                    intoContentPayloadParent: createIntoApiChatMessageContentPayloadParent(
                        context,
                        message.spaceId,
                        pathParameters.id,
                    ),
                }),
            };

            // We want to test that response schemas are validated in a Jest unit test. So
            // allow adding a search param to trigger a response validation failure.
            if (import.meta.jest && url.searchParams.has("test-additional-property")) {
                (content as any).additionalProperty = url.searchParams.get(
                    "test-additional-property",
                );
            }

            // We also test that object key order is validated in a Jest unit test. So allow
            // adding a search param to trigger order validation failures.
            if (import.meta.jest) {
                switch (url.searchParams.get("test-property-order")) {
                    case null: {
                        break;
                    }
                    case "top-level": {
                        content = {
                            message: content.message,
                            spaceId: content.spaceId,
                        } as any;
                        break;
                    }
                    case "nested": {
                        (content as any).message = {
                            author: content.message.author,
                            index: content.message.index,
                            createdTime: content.message.createdTime,
                            createdTimeZone: content.message.createdTimeZone,
                            payload: content.message.payload,
                        };
                        break;
                    }
                    case "array": {
                        if (content.message.payload.type === "Content") {
                            const firstElement = content.message.payload.content.elements[0];

                            if (firstElement) {
                                (content.message.payload.content.elements as any)[0] = {
                                    elements: (firstElement as any).elements,
                                    ...omitObject(firstElement as any, ["elements"]),
                                };
                            }
                        }
                        break;
                    }
                    case "union": {
                        if (content.message.payload.type === "Content") {
                            const {payload} = content.message;

                            (content as any).message.payload = {
                                content: payload.content,
                                ...omitObject(payload, ["content"]),
                            };
                        }
                        break;
                    }
                }
            }

            return {
                content,
            };
        },
    },

    "/chats/{id}/messages": {
        get: async (context, {pathParameters, queryParameters}) => {
            const {spaceId, messageCount, messages} =
                queryParameters.from === "End"
                    ? await getChatMessagePayloadsFromEnd(context, {
                          chatId: pathParameters.id,
                          limit: queryParameters.limit ?? 10,
                          afterMessageIndex: null,
                          beforeMessageIndex: queryParameters.cursor ?? null,
                          consistency: "StrongWithinCache",
                      })
                    : await getChatMessagePayloadsFromStart(context, {
                          chatId: pathParameters.id,
                          limit: queryParameters.limit ?? 10,
                          afterMessageIndex: queryParameters.cursor ?? null,
                          beforeMessageIndex: null,
                          consistency: "StrongWithinCache",
                      });

            let nextCursor: number | null;

            if (messages.length === 0) {
                nextCursor = null;
            } else {
                if (queryParameters.from === "End") {
                    const firstMessage = messages[0]!;
                    if (firstMessage.index > 0) {
                        nextCursor = firstMessage.index;
                    } else {
                        nextCursor = null;
                    }
                } else {
                    const lastMessage = messages[messages.length - 1]!;
                    if (lastMessage.index < messageCount - 1) {
                        nextCursor = lastMessage.index;
                    } else {
                        nextCursor = null;
                    }
                }
            }

            return {
                content: {
                    spaceId,
                    totalMessageCount: messageCount,
                    nextCursor,
                    messages: await runAllPromises(
                        messages.map(message =>
                            intoApiMessage(context, {
                                spaceId,
                                entityId: `ChatMessage:${pathParameters.id}-${message.index}`,
                                fileAuthorizer: FileChatAuthorizer.bind({
                                    type: "ChatMessages",
                                    chatId: pathParameters.id,
                                }),
                                message,
                                intoContentPayloadParent:
                                    createIntoApiChatMessageContentPayloadParent(
                                        context,
                                        spaceId,
                                        pathParameters.id,
                                    ),
                            }),
                        ),
                    ),
                },
            };
        },
        post: async (context, {pathParameters, requestBody}) => {
            const parent = fromApiMessageContentPayloadParent(requestBody.parent);

            const content = assertMessageContent(
                fromApiContent(MessageContentProsemirrorSchema, requestBody.content),
            );

            const createdTimeZone = requestBody.createdTimeZone ?? defaultTimeZone;
            const fileIds = (requestBody.files ?? []).map(
                getFileIdOrFileEntityIdFromApiMessageContentPayloadFile,
            );
            const attachmentFileIds = fileIds.filter((id): id is FileId => isId(id));

            // Attach files before creating the message, matching the app client flow. The
            // service function validates attachments exist.
            await runAllPromises(
                attachmentFileIds.map(fileId =>
                    attachFileToTargetAsBot(
                        context,
                        fileId,
                        FileChatAuthorizer.bind({
                            type: "ChatMessages",
                            chatId: pathParameters.id,
                        }),
                    ),
                ),
            );

            const {spaceId, index, createdTime} = await sendChatMessage(
                context.dynamo.unexpectStrongReadConsistency(),
                {
                    chatId: pathParameters.id,
                    parent,
                    content,
                    fileIds,
                    createdTimeZone,
                    consistency: "StrongWithinCache",
                    isStream: requestBody.isStream,
                },
            );

            const payload: MessageContentPayload = {
                type: "Content",
                parent,
                content,
                contentUpdate: null,
                fileIds,
                reactionsByPos: emptyMap,
                filesReactions: emptyReactionSet,
            };

            // If this broadcast fails (or it's never sent, say if the process dies) then users
            // connected to this messaging room won't see this message appear in realtime. The
            // realtime connection will be "stuck". Any future messages will be placed in a
            // queue (since the connection is waiting on a previous message) and will never be
            // flushed to the client.
            //
            // To get out of this state, the user can reload the page. Or navigate to another
            // page then navigate back. We hope this won't be too big of an issue since the
            // user should still receive a realtime inbox update telling them they have a new
            // message.
            //
            // NOTE(calebmer): The best fix for this is probably to send the broadcast event in
            // a DynamoDB Streams listener that reacts to the update. We plan to move
            // `NotificationEvent`, `IndexSearchEntity`, and other processing that needs to
            // reliably run after an updates to DynamoDB Stream.
            context.process.waitUntil(
                context.edge.broadcastToDurableObject(
                    `/api/durable-objects/chat/${pathParameters.id}/broadcast-new-message`,
                    {
                        serviceName: "ChatRealtimeService",
                        route: "/api/durable-objects/chat/:chatId/broadcast-new-message",
                        body: MessagingRealtimeBroadcastNewMessageRequestSchema.serialize({
                            index,
                            version: 0,
                            authorId: context.actor.getBotAccountId(),
                            createdTime,
                            createdTimeZone,
                            payload,
                            stream: requestBody.isStream
                                ? {createdTime, completedTime: null, parts: []}
                                : null,
                        }),
                    },
                ),
            );

            return {
                content: {
                    spaceId,
                    message: await intoApiMessage(context, {
                        spaceId,
                        entityId: `ChatMessage:${pathParameters.id}-${index}`,
                        fileAuthorizer: FileChatAuthorizer.bind({
                            type: "ChatMessages",
                            chatId: pathParameters.id,
                        }),
                        message: {
                            index,
                            version: 0,
                            authorId: context.actor.getBotAccountId(),
                            createdTime,
                            createdTimeZone,
                            payload,
                            stream: requestBody.isStream
                                ? {createdTime, completedTime: null, parts: [], lastPingTime: null}
                                : null,
                        },
                        intoContentPayloadParent: createIntoApiChatMessageContentPayloadParent(
                            context,
                            spaceId,
                            pathParameters.id,
                        ),
                    }),
                },
            };
        },
    },

    "/chats/{id}/messages/{index}/stream/completion": {
        put: async (context, {pathParameters}) => {
            const {spaceId, completedTime} = await completeChatMessageStream(context, {
                chatId: pathParameters.id,
                messageIndex: pathParameters.index,
                consistency: "StrongWithinCache",
            });

            return {
                content: {
                    spaceId,
                    completion: {completedTime: serializeDateString(completedTime)},
                },
            };
        },
    },

    "/chats/{id}/messages/{index}/stream/ping": {
        put: async (context, {pathParameters}) => {
            const {spaceId, lastPingTime} = await pingChatMessageStream(context, {
                chatId: pathParameters.id,
                messageIndex: pathParameters.index,
                consistency: "StrongWithinCache",
            });

            return {
                content: {
                    spaceId,
                    ping: {
                        lastUpdatedTime: serializeDateString(lastPingTime),
                    },
                },
            };
        },
    },

    "/chats/{id}/messages/{index}/stream/parts": {
        post: async (context, {pathParameters, requestBody}) => {
            const payload = fromApiMessageStreamPartPayload(requestBody.payload);

            const {spaceId} = await putChatMessageStreamPart(context, {
                chatId: pathParameters.id,
                messageIndex: pathParameters.index,
                partIndex: "Create",
                payload,
                consistency: "StrongWithinCache",
            });

            return {content: {spaceId}};
        },
    },

    "/chats/{id}/messages/{index}/stream/parts/{partIndex}": {
        put: async (context, {pathParameters, requestBody}) => {
            const payload = fromApiMessageStreamPartPayload(requestBody.payload);

            const {spaceId} = await putChatMessageStreamPart(context, {
                chatId: pathParameters.id,
                messageIndex: pathParameters.index,
                partIndex: pathParameters.partIndex,
                payload,
                consistency: "StrongWithinCache",
            });

            return {content: {spaceId}};
        },
    },

    "/chats/{id}/messages/{index}/experimental-approvals": {
        get: async (context, {pathParameters}) => {
            const {spaceId, approvals} = await getChatMessageApprovals(context, {
                chatId: pathParameters.id,
                messageIndex: pathParameters.index,
                consistency: "StrongWithinCache",
            });

            const referenceContext = context.dynamo.unexpectStrongReadConsistency();
            return {
                content: {
                    spaceId,
                    approvals: await runAllPromises(
                        approvals.map(approval =>
                            intoApiMessageExperimentalApproval(referenceContext, {
                                spaceId,
                                approval,
                            }),
                        ),
                    ),
                },
            };
        },
        patch: async (context, {pathParameters, requestBody}) => {
            const {spaceId, approvals, partIndex, version, createdTime, completedTime} =
                await putChatMessageApprovalDecisions(context, {
                    chatId: pathParameters.id,
                    messageIndex: pathParameters.index,
                    payload: {
                        type: "ExperimentalDecisions",
                        decisions: requestBody.patches.map(patch => ({
                            index: patch.index,
                            value: patch.decision.value,
                        })),
                    },
                    consistency: "StrongWithinCache",
                });

            broadcastPutChatMessageStreamPart(context, {
                chatId: pathParameters.id,
                messageIndex: pathParameters.index,
                partIndex,
                version,
                payload: {type: "ExperimentalApprovals", approvals},
                createdTime,
                completedTime,
            });

            const referenceContext = context.dynamo.unexpectStrongReadConsistency();
            return {
                content: {
                    spaceId,
                    approvals: await runAllPromises(
                        approvals.map(approval =>
                            intoApiMessageExperimentalApproval(referenceContext, {
                                spaceId,
                                approval,
                            }),
                        ),
                    ),
                },
            };
        },
    },
};
