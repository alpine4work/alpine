import {authorizeChatAccess} from "~/server/chat/data/authorize_chat_access.js";
import {
    backfillChatMessages,
    deleteChatMessage,
    deleteChatMessageReaction,
    getChatMessageAtVersion,
    getChatMessagesFromEnd,
    getChatMessagesFromStart,
    putChatMessageApprovalDecisions,
    sendChatMessage,
    setChatMessageReaction,
    updateChatMessageContent,
} from "~/server/chat/data/chat_messaging.js";
import {convertDirectChatToRoomChat} from "~/server/chat/data/convert_direct_chat_to_room_chat.js";
import {FileChatAuthorizer} from "~/server/chat/data/file_chat_authorizer.js";
import {getChat} from "~/server/chat/data/get_chat.js";
import {isSubscribedToRoomChat} from "~/server/chat/data/is_subscribed_to_room_chat.js";
import {
    subscribeToRoomChat,
    unsubscribeFromRoomChat,
} from "~/server/chat/data/subscribe_to_room_chat.js";
import {updateRoomChatAccessPolicy} from "~/server/chat/data/update_room_chat_access_policy.js";
import {updateRoomChatName} from "~/server/chat/data/update_room_chat_name.js";
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
                "View",
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
            return await updateChatMessageContent(context.actor.authorizeSession(), input);
        },
    },

    deleteChatMessage: {
        visibility: ["ChatRealtimeService"],
        execute: (context, input) => {
            return deleteChatMessage(context.actor.authorizeSession(), input);
        },
    },

    setChatMessageReaction: {
        visibility: ["ChatRealtimeService"],
        execute: (context, input) => {
            return setChatMessageReaction(context.actor.authorizeSession(), input);
        },
    },

    deleteChatMessageReaction: {
        visibility: ["ChatRealtimeService"],
        execute: (context, input) => {
            return deleteChatMessageReaction(context.actor.authorizeSession(), input);
        },
    },

    putChatMessageApprovalDecisions: {
        visibility: ["ChatRealtimeService"],
        execute: async (context, input) => {
            const sessionContext = context.actor.authorizeSession();
            const {approvals, partIndex, version, createdTime, completedTime} =
                await putChatMessageApprovalDecisions(sessionContext, {
                    chatId: input.chatId,
                    messageIndex: input.messageIndex,
                    payload: input.payload,
                });
            return {approvals, partIndex, version, createdTime, completedTime};
        },
    },

    backfillChatMessages: {
        visibility: ["ChatRealtimeService"],
        execute: (context, input) => {
            return backfillChatMessages(context.actor.authorizeSession(), input);
        },
    },

    getChatMessageAtVersion: {
        visibility: ["ChatRealtimeService"],
        execute: async (context, input) => {
            const message = await getChatMessageAtVersion(context.actor.authorizeSession(), input);
            return {message};
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

    convertDirectChatToRoomChat: {
        // Must be called from `ChatRealtimeService` which is also responsible for sending
        // the realtime udpate.
        visibility: ["ChatRealtimeService"],
        execute: async (context, input) => {
            const chat = await convertDirectChatToRoomChat(context.actor.authorizeSession(), input);
            return {chat: await chat.get(context)};
        },
    },

    updateRoomChatName: {
        // Must be called from `ChatRealtimeService` which is also responsible for sending
        // the realtime udpate.
        visibility: ["ChatRealtimeService"],
        execute: async (context, input) => {
            const chat = await updateRoomChatName(context.actor.authorizeSession(), input);
            return {chat: await chat.get(context)};
        },
    },

    updateRoomChatAccessPolicy: {
        // Must be called from `ChatRealtimeService` which is also responsible for sending
        // the realtime udpate.
        visibility: ["ChatRealtimeService"],
        execute: async (context, input) => {
            const chat = await updateRoomChatAccessPolicy(context.actor.authorizeSession(), input);
            return {chat: await chat.get(context)};
        },
    },

    getChat: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const chat = await getChat(context, input.chatId);
            return {chat};
        },
    },

    getChatWithStrongReadConsistency: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const chat = await getChat(context, input.chatId, {consistency: "StrongWithinCache"});
            return {chat};
        },
    },

    subscribeToRoomChat: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await subscribeToRoomChat(context.actor.authorizeSession(), input.chatId);
            return {};
        },
    },

    unsubscribeFromRoomChat: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await unsubscribeFromRoomChat(context.actor.authorizeSession(), input.chatId);
            return {};
        },
    },

    isSubscribedToRoomChat: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const isSubscribed = await isSubscribedToRoomChat(
                context.actor.authorizeSession(),
                input.chatId,
            );
            return {isSubscribed};
        },
    },
});
