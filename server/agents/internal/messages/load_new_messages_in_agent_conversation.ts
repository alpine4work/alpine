import {AgentWebhookRequest} from "~/server/agents/internal/agent_durable_object_base.js";
import {AgentConversationStore} from "~/server/agents/internal/conversation/agent_conversation_store.js";
import {getAgentMessagesBetweenIndexes} from "~/server/agents/internal/messages/get_agent_messages_between_indexes.js";
import {printAgentMessagesLog} from "~/server/agents/internal/messages/print_agent_messages_log.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

export async function loadNewMessagesInAgentConversation(
    tracer: TracerBase,
    transaction: DurableObjectTransaction,
    // We don't want to use `request.event.index` in this function. So omit it from
    // the type.
    request: Omit<AgentWebhookRequest, "event">,
    conversation: AgentConversationStore,
    newMessageIndex: number,
): Promise<void> {
    const {lastMessageIndex} = conversation.getState();
    if (lastMessageIndex === null) return;

    const messages = await getAgentMessagesBetweenIndexes(
        tracer,
        transaction,
        request,
        lastMessageIndex,
        newMessageIndex,
    );
    if (messages === null) return;

    const agentMessagesLog = printAgentMessagesLog(messages);
    await conversation.insertMessages(transaction, newMessageIndex, agentMessagesLog.trimEnd());
}
