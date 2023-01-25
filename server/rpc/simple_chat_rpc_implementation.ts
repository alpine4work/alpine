import {
    createSimpleChatMessage,
    getSimpleChatMessagesFromEnd,
    getSimpleChatMessagesFromStart,
} from "~/server/dynamo/simple_chat_table";
import {implementRpc} from "~/server/rpc/internal/implement_rpc";
import * as definition from "~/shared/rpc/simple_chat_rpc_definitions";

implementRpc(definition.createSimpleChatMessage, async (context, input) => {
    await createSimpleChatMessage(await context.auth.authenticate(), input);
    return {};
});

implementRpc(definition.getSimpleChatMessagesFromStart, async (context, input) => {
    return getSimpleChatMessagesFromStart(await context.auth.authenticate(), input);
});

implementRpc(definition.getSimpleChatMessagesFromEnd, async (context, input) => {
    return getSimpleChatMessagesFromEnd(await context.auth.authenticate(), input);
});
