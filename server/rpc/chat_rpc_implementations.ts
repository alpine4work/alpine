import {
    getChatMessagesFromEnd,
    getChatMessagesFromStart,
    sendChatMessage,
} from "~/server/dynamo/chat_table";
import {implementRpc} from "~/server/rpc/internal/implement_rpc";
import * as definition from "~/shared/rpc/chat_rpc_definitions";

implementRpc(definition.getChatMessagesFromStart, async (context, input) => {
    return getChatMessagesFromStart(await context.actor.authenticate(), input);
});

implementRpc(definition.getChatMessagesFromEnd, async (context, input) => {
    return getChatMessagesFromEnd(await context.actor.authenticate(), input);
});

implementRpc(definition.sendChatMessage, async (context, input) => {
    return sendChatMessage(await context.actor.authenticate(), input);
});
