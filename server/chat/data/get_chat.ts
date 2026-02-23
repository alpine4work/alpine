import {authorizeChatAccess} from "~/server/chat/data/authorize_chat_access.js";
import {createChatModelFromItem} from "~/server/chat/data/internal/create_chat_model_from_item.js";
import {getChatItemForAuthorization} from "~/server/chat/data/internal/get_chat_item_for_authorization.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {ChatModel} from "~/shared/chat/chat_model.js";
import {ChatId} from "~/shared/id/types/id_types.js";

/**
 * Get the provided chat by `ChatId`.
 */
export async function getChat(context: ServerActionContext, chatId: ChatId): Promise<ChatModel> {
    const chatItem = await getChatItemForAuthorization(context, chatId);

    // This call won't make any database calls since it's after the
    // `getChatItemForAuthorization()` call which will cache the data we need.
    await authorizeChatAccess(context, chatId);

    return createChatModelFromItem(context, chatItem);
}
