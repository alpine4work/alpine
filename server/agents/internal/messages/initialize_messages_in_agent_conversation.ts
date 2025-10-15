import {AgentWebhookRequest} from "~/server/agents/internal/agent_durable_object_base.js";
import {AgentConversationStateStore} from "~/server/agents/internal/conversation_state/agent_converstaion_state.js";
import {AgentMessage} from "~/server/agents/internal/messages/agent_message.js";
import {getAgentMessagesFromEndUntilLimitTokenCount} from "~/server/agents/internal/messages/get_agent_messages_from_end_until_token_limit_count.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {OrderKey, generateOrderKeyBetween} from "~/shared/helpers/sort/order_key.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

/**
 * The initial token limit for messages to include in context. This is based on
 * 750 words which is about the average length of a Wikipedia article. Then we
 * use the [rule of thumb that 1 token is 3/4 of a word][1] so a Wikipedia
 * article's worth of context is about 1000 tokens. Then we multiply by 1.5 since
 * 1000 felt like too little context from basic local testing.
 *
 * [1]: https://platform.openai.com/tokenizer
 */
// NOTE(ifitzsimmons, #ai): Hard coding this here for now. If we want to change depending
// on the agent / model, we can pass it in as a parameter.
const agentContextManagerInitializeLimitTokenCount = 1500;

export async function initializeMessagesInAgentConversation(
    tracer: TracerBase,
    transaction: DurableObjectTransaction,
    request: AgentWebhookRequest,
    state: AgentConversationStateStore,
    insertItemIntoConversationItemCollection: (
        transaction: DurableObjectTransaction,
        orderKey: OrderKey,
        messages: Array<AgentMessage>,
    ) => Promise<void>,
): Promise<void> {
    assert(state.get().lastMessageIndex === null);

    const messages = await getAgentMessagesFromEndUntilLimitTokenCount(
        tracer,
        transaction,
        request.apiClient,
        request.spaceId,
        request.room,
        {
            startingIndex: request.event.index,
            limitTokenCount: agentContextManagerInitializeLimitTokenCount,
        },
    );

    const orderKey = generateOrderKeyBetween(state.get().lastOrderKey, null);

    await insertItemIntoConversationItemCollection(transaction, orderKey, messages);

    await state.set(transaction, {
        lastOrderKey: orderKey,
        lastMessageIndex: request.event.index,
    });
}
