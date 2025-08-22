import {
    FileChatAuthorizer,
    authorizeChatAccess,
    backfillChatMessages,
    deleteChatMessage,
    getChatMessagesFromEnd,
    getChatMessagesFromStart,
    sendChatMessage,
    updateChatMessageContent,
} from "~/server/chat/data/chat_actions.js";
import {getMessageReferences} from "~/server/messaging/helpers/get_message_references.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
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

            const {index, createdTime} = await sendChatMessage(context, input);

            return {
                index,
                createdTime,
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
