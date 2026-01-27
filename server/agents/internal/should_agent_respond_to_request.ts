import {AgentWebhookRequest} from "~/server/agents/internal/agent_durable_object_base.js";
import {DurableObjectStorageCollection} from "~/server/agents/internal/durable_object_storage_collection.js";
import {ApiChat} from "~/shared/api/types/api_specification_convenience_types.js";
import {ChatId} from "~/shared/id/types/id_types.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

const ApiChatCollection = new DurableObjectStorageCollection<ChatId, ApiChat>("a0");

export async function shouldAgentRespondToRequest(
    tracer: TracerBase,
    request: AgentWebhookRequest,
): Promise<boolean> {
    // Always respond if mentioned.
    if (request.event.wasMentioned) return true;

    // If the message is a reply to a message authored by our bot then the agent
    // should respond.
    if (
        request.event.type === "NewMessage" &&
        request.event.parent &&
        request.event.parent.author.id === request.botAccountId
    ) {
        return true;
    }

    // If this is a 1:1 chat between the agent and another user, then the agent
    // will always respond.
    if (await isOneOnOneChat(tracer, request)) return true;

    return false;
}

/**
 * Is this a 1:1 chat with the bot account? Uses the same cache as
 * `shouldAgentRespondToRequest()`.
 */
export async function isOneOnOneChat(
    tracer: TracerBase,
    request: AgentWebhookRequest,
): Promise<boolean> {
    // If this isn't a chat, the agent only responds if mentioned.
    if (request.room.type !== "Chat") return false;

    const {id: chatId} = request.room;

    const chat = await ApiChatCollection.getOrPutDefault(request.storage, chatId, async () => {
        const {
            data: {chat},
        } = await request.apiClient.get(tracer, "/chats/{id}", {
            params: {path: {id: chatId}},
        });
        return chat;
    });

    // If this is a 1:1 chat between the agent and another user, then the agent
    // will always respond.
    return (
        chat.members.length === 2 &&
        chat.members.some(member => member.account.id === request.botAccountId)
    );
}
