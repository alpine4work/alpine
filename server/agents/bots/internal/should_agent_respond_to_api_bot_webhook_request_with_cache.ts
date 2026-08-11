import {ApiClient} from "~/server/agents/api/api_client.open_source.js";
import {
    isOneOnOneChat,
    shouldAgentRespondToApiBotWebhookRequest,
} from "~/server/agents/api/should_agent_respond_to_bot_webhook_request.js";
import {
    DurableObjectStorageCollection,
    DurableObjectStorageInterface,
} from "~/server/cloudflare/durable_object_storage_collection.js";
import {
    ApiBotWebhookEvent,
    ApiChatResponse,
    ApiMessageRoomReference,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {AccountId, ChatId} from "~/shared/id/types/id_types.open_source.js";
import {TracerBase} from "~/shared/tracer/tracer_base.open_source.js";

const ApiChatCollection = new DurableObjectStorageCollection<ChatId, ApiChatResponse>("a0");

export async function shouldAgentRespondToApiBotWebhookRequestWithCache(
    tracer: TracerBase,
    request: {
        apiClient: ApiClient;
        storage: DurableObjectStorageInterface;
        botAccountId: AccountId;
        room: ApiMessageRoomReference;
        event: Exclude<ApiBotWebhookEvent, {type: "UpdatedMessageStreamExperimentalApprovalsPart"}>;
    },
): Promise<boolean> {
    return await shouldAgentRespondToApiBotWebhookRequest(
        tracer,
        request.apiClient,
        request.botAccountId,
        request.event,
        {
            withChatCache: async (chatId, action) =>
                await withChatCache(request.storage, chatId, action),
        },
    );
}

export async function isOneOnOneChatWithCache(
    tracer: TracerBase,
    request: {
        apiClient: ApiClient;
        storage: DurableObjectStorageInterface;
        botAccountId: AccountId;
        room: ApiMessageRoomReference;
    },
): Promise<boolean> {
    if (request.room.type !== "Chat") return false;

    return await isOneOnOneChat(tracer, request.apiClient, request.botAccountId, request.room, {
        withChatCache: async (chatId, action) =>
            await withChatCache(request.storage, chatId, action),
    });
}

async function withChatCache(
    storage: DurableObjectStorageInterface,
    chatId: ChatId,
    action: () => Promise<ApiChatResponse>,
): Promise<ApiChatResponse> {
    let chat = await ApiChatCollection.getOrPutDefault(storage, chatId, action);

    // NOTE(ifitzsimmons, 2026-06-22): There's no guarantee that our agents clear the
    // local durable object storage, which is used to support the `ApiChatCollection`
    // "cache" above.
    //
    // The issue is that chats didn't always have a `type` property (they were added
    // when we added chat rooms). So for one-on-one chats with agents that have state
    // that predates chat rooms, this function will always return false:
    //
    // ```
    // return (
    //   chat.type === "Direct" && // <-- Always false!
    //   chat.members.length === 2 &&
    //   chat.members.some(member => member.account.id === request.botAccountId)
    // )
    // ```
    //
    // To fix this, we delete the chat from the local storage "cache" and call the
    // function again, which will force a fresh fetch from the API.
    if (chat.type === undefined) {
        await ApiChatCollection.delete(storage, chatId);
        chat = await action();
        await ApiChatCollection.put(storage, chatId, chat);
    }

    return chat;
}
