import {ApiClient, getApiMessagesFromStart} from "~/server/agents/api/api_client.js";
import {AgentMessage} from "~/server/agents/internal/messages/agent_message.js";
import {loadApiMessagesForAgentBatchCount} from "~/server/agents/internal/messages/load_api_messages_for_agent_batch_count.js";
import {ApiMessageRoomPathObject} from "~/shared/api/parse_api_path.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

/**
 * Given a *start range __inclusive__* index, get all messages after that index within a provided
 * token limit (including the index).
 *
 * Returns null if the conversation is empty OR the index is out of bounds. Also returns the next
 * start range __exclusive__ index.
 */
export async function getAgentMessagesFromStartUntilTokenLimitCount(
    tracer: TracerBase,
    transaction: DurableObjectTransaction,
    apiClient: ApiClient,
    spaceId: SpaceId,
    roomPathObject: ApiMessageRoomPathObject,
    {startingIndex, limitTokenCount}: {startingIndex: number; limitTokenCount: number},
): Promise<{
    messages: Array<AgentMessage>;
    nextCursor: number | null;
}> {
    let cursor: number | null = startingIndex - 1;
    let totalTokenCount = 0;
    const messages: Array<AgentMessage> = [];

    while (cursor !== null && totalTokenCount < limitTokenCount) {
        if (cursor < 0) cursor = null;
        const {
            data: {nextCursor, messages: currentMessages},
        } = await getApiMessagesFromStart(tracer, apiClient, roomPathObject, {
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
            // If this message would put us over our token limit then DO NOT add the
            // message and instead return the messages we have.
            //
            // Unless we've filled less than half of our token limit. In this case we must
            // be adding a single message with MORE tokens than half of our token limit.
            // Include the full message. The maximum message size is 400kb. If we assume 1
            // character per bytes that's 400k characters which is approximately 100k
            // tokens using the [one-token-is-about-four-characters rule of thumb][1].
            // GPT-5's context window is 400k tokens so a max length message would consume
            // a quarter of the context window which is not ideal but still fine.
            //
            // [1]: https://platform.openai.com/tokenizer
            if (
                totalTokenCount > limitTokenCount / 2 &&
                totalTokenCount + tokenCount > limitTokenCount
            ) {
                // We don't subtract 1 here because we account for start range exclusivity
                // at the top of this function. So if the message at index 5 puts us over
                // the token limit, index 4 was the last message we added to this response.
                // If we want to request the next set of results, we need to look back
                // (from message 5-10, for example) we need to look forward from index
                // 4. However, since we subtract 1 from the starting index at the top of this
                // function, when we try to fetch messages from the next cursor,
                // the number we should pass in is 5.
                return {messages, nextCursor: message.index};
            } else {
                totalTokenCount += tokenCount;
                messages.push(message);
            }
        }
    }

    return {messages, nextCursor: cursor};
}
