import {
    FileChatAuthorizer,
    authorizeChatAccess,
    backfillChatMessages,
    deleteChatMessage,
    getChatMessagesFromEnd,
    getChatMessagesFromStart,
    sendChatMessage,
    updateChatMessageContent,
} from "~/server/chat/data/chat_table.js";
import {getContentReferencesForNode} from "~/server/content/get_content_references.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import {getAccount} from "~/server/spaces/spaces_table.js";
import {ChatMessageModel} from "~/shared/chat/chat_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import * as definitions from "~/shared/rpc/chat_rpc_definitions.js";

export default implementRpcs(definitions, {
    getChatMessagesFromStart: {
        visibility: ["AppClient"],
        execute: (context, input) => {
            return getChatMessagesFromStart(context.actor.authorizeSession(), input);
        },
    },

    getChatMessagesFromEnd: {
        visibility: ["AppClient"],
        execute: (context, input) => {
            return getChatMessagesFromEnd(context.actor.authorizeSession(), input);
        },
    },

    authorizeChatAccess: {
        visibility: ["ChatRealtimeService"],
        execute: async (context, input) => {
            const {spaceId} = await authorizeChatAccess(
                context.actor.authorizeSession(),
                input.chatId,
            );
            return {
                spaceId,
            };
        },
    },

    sendChatMessage: {
        visibility: ["ChatRealtimeService"],
        execute: async (unknownContext, input) => {
            const context = unknownContext.actor.authorizeSession();

            const {spaceId, index, createdTime} = await sendChatMessage(context, input);

            const [author, contentReferences] = await runAllPromises([
                getAccount(context, spaceId, context.actor.getAccountId()),
                getContentReferencesForNode(
                    context,
                    spaceId,
                    FileChatAuthorizer.bind({
                        type: "ChatMessage",
                        chatId: input.chatId,
                        messageIndex: index,
                    }),
                    input.content,
                ),
            ]);

            const message = new ChatMessageModel({
                chatId: input.chatId,
                index,
                createdTime,
                author,
                payload: {
                    type: "Content",
                    parentMessageIndex: input.parentMessageIndex,
                    content: {
                        doc: input.content,
                        references: contentReferences,
                    },
                    contentUpdatedTime: null,
                },
            });

            return {
                message,
            };
        },
    },

    updateChatMessageContent: {
        visibility: ["ChatRealtimeService"],
        execute: async (context, input) => {
            const [{contentUpdatedTime}, contentReferences] = await runAllPromises([
                updateChatMessageContent(context.actor.authorizeSession(), input),
                authorizeChatAccess(context.actor.authorizeSession(), input.chatId).then(
                    ({spaceId}) =>
                        getContentReferencesForNode(
                            context,
                            spaceId,
                            FileChatAuthorizer.bind({
                                type: "ChatMessage",
                                chatId: input.chatId,
                                messageIndex: input.messageIndex,
                            }),
                            input.content,
                        ),
                ),
            ]);

            return {
                contentUpdatedTime,
                contentReferences,
            };
        },
    },

    deleteChatMessage: {
        visibility: ["ChatRealtimeService"],
        execute: (context, input) => {
            return deleteChatMessage(context.actor.authorizeSession(), input);
        },
    },

    backfillChatMessages: {
        visibility: ["ChatRealtimeService"],
        execute: (context, input) => {
            return backfillChatMessages(context.actor.authorizeSession(), input);
        },
    },
});
