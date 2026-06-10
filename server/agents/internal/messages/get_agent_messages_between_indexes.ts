import {getApiMessagesFromStart} from "~/server/agents/api/api_client.js";
import {AgentWebhookRequest} from "~/server/agents/internal/agent_durable_object_base.js";
import {DurableObjectTransactionInterface} from "~/server/agents/internal/durable_object_storage_collection.js";
import {AgentMessage} from "~/server/agents/internal/messages/agent_message.js";
import {loadApiMessagesForAgentBatchCount} from "~/server/agents/internal/messages/load_api_messages_for_agent_batch_count.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

/**
 * Gets all the messages between two indexes. `startMessageIndex` is exclusive and
 * `endMessageIndex` is inclusive.
 *
 * Returns null if there aren't any messages between the two indexes.
 */
export async function getAgentMessagesBetweenIndexes(
    tracer: TracerBase,
    transaction: DurableObjectTransactionInterface,
    // We don't want to use `request.event.index` in this function. So omit it from the
    // type.
    request: Omit<AgentWebhookRequest, "event">,
    startMessageIndex: number,
    endMessageIndex: number,
): Promise<Array<AgentMessage> | null> {
    // There are no new messages to load!
    if (endMessageIndex <= startMessageIndex) return null;

    let cursor = startMessageIndex;
    const messages: Array<AgentMessage> = [];

    outer: while (endMessageIndex > cursor) {
        const {
            data: {nextCursor, messages: currentMessages},
        } = await getApiMessagesFromStart(tracer, request.apiClient, request.room, {
            limit: Math.min(loadApiMessagesForAgentBatchCount, endMessageIndex - cursor),
            cursor,
        });

        for (const currentMessage of currentMessages) {
            // Ignore messages after the index we're looking for.
            if (currentMessage.index > endMessageIndex) break outer;

            // Ignore deleted messages.
            if (currentMessage.payload.type === "Deleted") continue;

            const message = await AgentMessage.new(transaction, {
                spaceId: request.spaceId,
                index: currentMessage.index,
                author: currentMessage.author,
                createdTime: currentMessage.createdTime,
                createdTimeZone: currentMessage.createdTimeZone,
                payload: currentMessage.payload,
            });

            messages.push(message);
        }

        if (nextCursor === null) break;
        cursor = nextCursor;
    }

    return messages;
}
