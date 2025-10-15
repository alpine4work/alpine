import {AgentWebhookRequest} from "~/server/agents/internal/agent_durable_object_base.js";
import {AgentConversationStateStore} from "~/server/agents/internal/conversation_state/agent_converstaion_state.js";
import {AgentMessage} from "~/server/agents/internal/messages/agent_message.js";
import {getAgentMessagesFromStartUntilTokenLimit} from "~/server/agents/internal/messages/get_agent_messages_from_start_until_token_limit.js";
import {OrderKey, generateOrderKeyBetween} from "~/shared/helpers/sort/order_key.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

export async function loadNewMessagesInAgentConversation(
    tracer: TracerBase,
    transaction: DurableObjectTransaction,
    // We don't want to use `request.event.index` in this function. So omit it from
    // the type.
    request: Omit<AgentWebhookRequest, "event">,
    state: AgentConversationStateStore,
    insertItemIntoConversationItemCollection: (
        transaction: DurableObjectTransaction,
        orderKey: OrderKey,
        messages: Array<AgentMessage>,
    ) => Promise<void>,
    newMessageIndex: number,
): Promise<void> {
    const messages = await getAgentMessagesFromStartUntilTokenLimit(
        tracer,
        transaction,
        request,
        state,
        newMessageIndex,
    );
    if (messages === null) return;

    const orderKey = generateOrderKeyBetween(state.get().lastOrderKey, null);

    await insertItemIntoConversationItemCollection(transaction, orderKey, messages);

    await state.set(transaction, {
        lastOrderKey: orderKey,
        lastMessageIndex: newMessageIndex,
    });
}
