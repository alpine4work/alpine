import {
    ApiOperation200JsonResponseType,
    ApiPaths,
} from "~/server/api/internal/shared/api_paths_type.js";
import {fromApiContent} from "~/server/api/internal/shared/from_api_content.js";
import {intoApiMessage} from "~/server/api/internal/shared/into_api_message.js";
import {
    getChatMessagePayload,
    getChatMessagePayloadsFromEnd,
    getChatMessagePayloadsFromStart,
    sendChatMessage,
} from "~/server/chat/data/chat_actions.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {MessageContentPayload} from "~/shared/messaging/message_model.js";
import {MessagingRealtimeBroadcastNewMessageRequestSchema} from "~/shared/messaging/messaging_realtime_protocol.js";

export const apiChatPaths: Pick<ApiPaths, keyof ApiPaths & `/chats/${string}`> = {
    "/chats/{id}/messages/{index}": {
        get: async (context, {pathParameters, url}) => {
            const {spaceId, authorId, createdTime, payload} = await getChatMessagePayload(context, {
                chatId: pathParameters.id,
                messageIndex: pathParameters.index,
                consistency: "StrongWithinCache",
            });

            const content: ApiOperation200JsonResponseType<"/chats/{id}/messages/{index}", "get"> =
                {
                    spaceId,
                    message: await intoApiMessage(context, {
                        spaceId,
                        index: pathParameters.index,
                        authorId,
                        createdTime,
                        payload,
                    }),
                };

            // We want to test that response schemas are validated in a Jest unit test. So
            // allow adding a search param to trigger a response validation failure.
            if (import.meta.jest && url.searchParams.has("test-additional-property")) {
                (content as any).additionalProperty = url.searchParams.get(
                    "test-additional-property",
                );
            }

            return {
                content,
            };
        },
    },

    "/chats/{id}/messages": {
        get: async (context, {pathParameters, queryParameters}) => {
            const {spaceId, messageCount, messages} =
                queryParameters.from === "end"
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
                if (queryParameters.from === "end") {
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
                                index: message.index,
                                authorId: message.authorId,
                                createdTime: message.createdTime,
                                payload: message.payload,
                            }),
                        ),
                    ),
                },
            };
        },
        post: async (context, {pathParameters, requestBody}) => {
            const content = assertMessageContent(
                fromApiContent(MessageContentProsemirrorSchema, requestBody.content),
            );

            const {spaceId, index, createdTime} = await sendChatMessage(context, {
                chatId: pathParameters.id,
                parentMessageIndex: null,
                content,
                fileIds: [],
                consistency: "StrongWithinCache",
            });

            const payload: MessageContentPayload = {
                type: "Content",
                parentMessageIndex: null,
                content,
                contentUpdatedTime: null,
                fileIds: [],
            };

            // If this broadcast fails (or it's never sent, say if the process dies) then
            // users connected to this messaging room won't see this message appear in
            // realtime. The realtime connection will be "stuck". Any future messages will
            // be placed in a queue (since the connection is waiting on a previous message)
            // and will never be flushed to the client.
            //
            // To get out of this state, the user can reload the page. Or navigate to
            // another page then navigate back. We hope this won't be too big of an issue
            // since the user should still receive a realtime inbox update telling them
            // they have a new message.
            //
            // NOTE(calebmer): The best fix for this is probably to send the broadcast
            // event in a DynamoDB Streams listener that reacts to the update. We plan to
            // move `NotificationEvent`, `IndexSearchEntity`, and other processing that
            // needs to reliably run after an updates to DynamoDB Stream.
            context.process.waitUntil(
                context.edge.broadcastToDurableObject(
                    `/api/durable-objects/chat/${pathParameters.id}/broadcast-new-message`,
                    {
                        serviceName: "ChatRealtimeService",
                        route: "/api/durable-objects/chat/:chatId/broadcast-new-message",
                        body: MessagingRealtimeBroadcastNewMessageRequestSchema.serialize({
                            index,
                            authorId: context.actor.getBotAccountId(),
                            createdTime,
                            payload,
                        }),
                    },
                ),
            );

            return {
                content: {
                    spaceId,
                    message: await intoApiMessage(context, {
                        spaceId,
                        index,
                        authorId: context.actor.getBotAccountId(),
                        createdTime,
                        payload: payload,
                    }),
                },
            };
        },
    },
};
