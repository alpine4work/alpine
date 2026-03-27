import {ApiClient, getApiMessagesFromStart} from "~/server/agents/api/api_client.js";
import {AgentMessage} from "~/server/agents/bots/internal/messages/agent_message.js";
import {loadApiMessagesForAgentBatchCount} from "~/server/agents/bots/internal/messages/load_api_messages_for_agent_batch_count.js";
import {DurableObjectTransactionInterface} from "~/server/cloudflare/durable_object_storage_collection.js";
import {ApiMessageRoomTarget} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

/**
 * Get all messages after the cursor within a provided token limit (including the
 * message at the cursor).
 *
 * Returns null if the conversation is empty OR the cursor is out of bounds. Also
 * returns the next cursor.
 */
export async function getAgentMessagesFromStartUntilTokenLimitCount(
    tracer: TracerBase,
    transaction: DurableObjectTransactionInterface,
    apiClient: ApiClient,
    spaceId: SpaceId,
    room: ApiMessageRoomTarget,
    {startingCursor, limitTokenCount}: {startingCursor: number | null; limitTokenCount: number},
): Promise<{
    messages: Array<AgentMessage>;
    nextCursor: number | null;
}> {
    let cursor: number | null = startingCursor;
    let firstRequest = true;
    let totalTokenCount = 0;
    const messages: Array<AgentMessage> = [];

    while ((cursor !== null || firstRequest) && totalTokenCount < limitTokenCount) {
        firstRequest = false;
        const {
            data: {nextCursor, messages: currentMessages},
        } = await getApiMessagesFromStart(tracer, apiClient, room, {
            limit: loadApiMessagesForAgentBatchCount,
            cursor,
        });

        cursor = nextCursor;
        for (const currentMessage of currentMessages) {
            // Ignore deleted messages.
            if (currentMessage.payload.type === "Deleted") continue;
            const message = await AgentMessage.new(transaction, {
                spaceId,
                index: currentMessage.index,
                author: currentMessage.author,
                createdTime: currentMessage.createdTime,
                createdTimeZone: currentMessage.createdTimeZone,
                payload: currentMessage.payload,
            });
            const tokenCount = message.estimateTokenCount();
            // If this message would put us over our token limit then DO NOT add the message
            // and instead return the messages we have.
            //
            // Unless we've filled less than half of our token limit. In this case we must be
            // adding a single message with MORE tokens than half of our token limit. Include
            // the full message. The maximum message size is 400kb. If we assume 1 character
            // per bytes that's 400k characters which is approximately 100k tokens using the
            // [one-token-is-about-four-characters rule of thumb][1]. GPT-5's context window is
            // 400k tokens so a max length message would consume a quarter of the context
            // window which is not ideal but still fine.
            //
            // [1]: https://platform.openai.com/tokenizer
            if (
                totalTokenCount > limitTokenCount / 2 &&
                totalTokenCount + tokenCount > limitTokenCount
            ) {
                // Minus 1 because the range is start exclusive. So if we stopped at index 5, index
                // 4 was the last message we added to this request. If we want to request the next
                // set of results, we need to look forward from the message at index 4.
                return {messages, nextCursor: message.index - 1};
            } else {
                totalTokenCount += tokenCount;
                messages.push(message);
            }
        }
    }

    return {messages, nextCursor: cursor};
}
