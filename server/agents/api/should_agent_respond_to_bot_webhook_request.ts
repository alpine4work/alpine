import {ApiClient} from "~/server/agents/api/api_client.open_source.js";
import {
    ApiBotWebhookEvent,
    ApiChat,
    ApiChatReferenceRequest,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {AccountId, ChatId} from "~/shared/id/types/id_types.open_source.js";
import {TracerBase} from "~/shared/tracer/tracer_base.open_source.js";

export async function shouldAgentRespondToApiBotWebhookRequest(
    tracer: TracerBase,
    apiClient: ApiClient,
    botAccountId: AccountId,
    event: Extract<ApiBotWebhookEvent, {type: "CreatedMessage" | "CreatedPost"}>,
    options?: {
        withChatCache?: (chatId: ChatId, action: () => Promise<ApiChat>) => Promise<ApiChat>;
    },
): Promise<boolean> {
    // Always respond if mentioned.
    if (event.wasMentioned) return true;

    // If the message is a reply to a message authored by our bot then the agent should
    // respond.
    if (
        event.type === "CreatedMessage" &&
        event.parent &&
        event.parent.author.id === botAccountId
    ) {
        return true;
    }

    // If this is a 1:1 chat between the agent and another user, then the agent will
    // always respond.
    if (
        event.type === "CreatedMessage" &&
        event.room.type === "Chat" &&
        (await isOneOnOneChat(tracer, apiClient, botAccountId, event.room, options))
    ) {
        return true;
    }

    return false;
}

/**
 * Is this a 1:1 chat with the bot account? Uses the same cache as
 * `shouldAgentRespondToRequest()`.
 */
export async function isOneOnOneChat(
    tracer: TracerBase,
    apiClient: ApiClient,
    botAccountId: AccountId,
    {id: chatId}: ApiChatReferenceRequest,
    {
        withChatCache = (chatId, action) => action(),
    }: {
        withChatCache?: (chatId: ChatId, action: () => Promise<ApiChat>) => Promise<ApiChat>;
    } = {},
): Promise<boolean> {
    const chat = await withChatCache(chatId, async () => {
        const {
            data: {chat},
        } = await apiClient.get(tracer, "/chats/{id}", {
            params: {path: {id: chatId}},
        });
        return chat;
    });

    // If this is a 1:1 chat between the agent and another user, then the agent will
    // always respond.
    return (
        chat.type === "Direct" &&
        chat.members.length === 2 &&
        chat.members.some(member => member.account.id === botAccountId)
    );
}
