import {AgentWebhookRequest} from "~/server/agents/internal/agent_durable_object_base.js";
import {agentInitializeMessagesTokenLimitCount} from "~/server/agents/internal/agent_tool_page_sizing.js";
import {AgentConversationStore} from "~/server/agents/internal/conversation/agent_conversation_store.js";
import {getAgentMessagesFromEndUntilLimitTokenCount} from "~/server/agents/internal/messages/get_agent_messages_from_end_until_token_limit_count.js";
import {printAgentMessagesLog} from "~/server/agents/internal/messages/print_agent_messages_log.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

export async function initializeMessagesInAgentConversation(
    tracer: TracerBase,
    transaction: DurableObjectTransaction,
    request: AgentWebhookRequest,
    conversation: AgentConversationStore,
): Promise<void> {
    assert(conversation.getState().lastMessageIndex === null);

    const {messages} = await getAgentMessagesFromEndUntilLimitTokenCount(
        tracer,
        transaction,
        request.apiClient,
        request.spaceId,
        request.room,
        {
            startingIndex: request.event.index,
            limitTokenCount: agentInitializeMessagesTokenLimitCount,
        },
    );

    const conversationState = conversation.getState();
    const agentMessagesLog = printAgentMessagesLog(messages, {
        time: conversationState.startTime,
        timeZone: conversationState.timeZone,
    });
    await conversation.insertMessages(transaction, request.event.index, agentMessagesLog.trimEnd());
}
