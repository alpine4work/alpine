import {
    authorizeChatAccess,
    backfillChatMessages,
    deleteChatMessage,
    getChatMessagesFromEnd,
    getChatMessagesFromStart,
    sendChatMessage,
    updateChatMessageContent,
} from "~/server/dynamo/chat_table.js";
import {implementRpc} from "~/server/rpc/internal/implement_rpc.js";
import * as definition from "~/shared/rpc/chat_rpc_definitions.js";

implementRpc(definition.getChatMessagesFromStart, {visibility: ["AppClient"]}, (context, input) => {
    return getChatMessagesFromStart(context.actor.authorizeSession(), input);
});

implementRpc(definition.getChatMessagesFromEnd, {visibility: ["AppClient"]}, (context, input) => {
    return getChatMessagesFromEnd(context.actor.authorizeSession(), input);
});

implementRpc(
    definition.authorizeChatAccess,
    {visibility: ["ChatRealtimeService"]},
    async (context, input) => {
        const {spaceId} = await authorizeChatAccess(context.actor.authorizeSession(), input.chatId);
        return {spaceId};
    },
);

implementRpc(
    definition.sendChatMessage,
    {visibility: ["ChatRealtimeService"]},
    (context, input) => {
        return sendChatMessage(context.actor.authorizeSession(), input);
    },
);

implementRpc(
    definition.updateChatMessageContent,
    {visibility: ["ChatRealtimeService"]},
    (context, input) => {
        return updateChatMessageContent(context.actor.authorizeSession(), input);
    },
);

implementRpc(
    definition.deleteChatMessage,
    {visibility: ["ChatRealtimeService"]},
    (context, input) => {
        return deleteChatMessage(context.actor.authorizeSession(), input);
    },
);

implementRpc(
    definition.backfillChatMessages,
    {visibility: ["ChatRealtimeService"]},
    (context, input) => {
        return backfillChatMessages(context.actor.authorizeSession(), input);
    },
);
