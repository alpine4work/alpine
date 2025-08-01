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
import {createMessagePayloadModel} from "~/server/messaging/helpers/create_message_payload_model.js";
import {getMessageReferences} from "~/server/messaging/helpers/get_message_references.js";
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

            const [author, payload] = await runAllPromises([
                getAccount(context, spaceId, context.actor.getAccountId()),
                createMessagePayloadModel(
                    context,
                    spaceId,
                    FileChatAuthorizer.bind({type: "ChatMessages", chatId: input.chatId}),
                    {
                        type: "Content",
                        parentMessageIndex: input.parentMessageIndex,
                        content: input.content,
                        contentUpdatedTime: null,
                        fileIds: input.fileIds,
                    },
                ),
            ]);

            const message = new ChatMessageModel({
                chatId: input.chatId,
                index,
                createdTime,
                author,
                payload,
            });

            return {
                message,
            };
        },
    },

    updateChatMessageContent: {
        visibility: ["ChatRealtimeService"],
        execute: async (context, input) => {
            const {contentUpdatedTime} = await updateChatMessageContent(
                context.actor.authorizeSession(),
                input,
            );

            return {contentUpdatedTime};
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

    getChatMessageReferences: {
        visibility: ["ChatRealtimeService"],
        execute: async (context, {spaceId, chatId, referencedIds}) => {
            const references = await getMessageReferences(
                context.actor.authorizeSession(),
                spaceId,
                FileChatAuthorizer.bind({type: "ChatMessages", chatId}),
                referencedIds,
            );
            return {references};
        },
    },
});
