import {authorizeChatAccessIfPossible} from "~/server/chat/data/authorize_chat_access.js";
import {createChatModelFromItem} from "~/server/chat/data/internal/create_chat_model_from_item.js";
import {getChatItemIfExistsForAuthorization} from "~/server/chat/data/internal/get_chat_item_for_authorization.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {createChatNotFoundError} from "~/shared/chat/chat_error_messages.js";
import {ChatModel} from "~/shared/chat/chat_model.js";
import {ErrorBase} from "~/shared/error/error.open_source.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.open_source.js";
import {Result} from "~/shared/helpers/control/result.open_source.js";
import {ChatId, SiteId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Get the provided chat by `ChatId`.
 */
export async function getChat(
    context: ServerActionContext,
    chatId: ChatId,
    options?: {
        consistency?: DynamoCacheReadConsistency;
        onSiteId?: (siteId: SiteId) => void;
    },
): Promise<ChatModel> {
    const chat = await getChatIfPossible(context, chatId, options);
    if (!chat) throw createChatNotFoundError(chatId);
    return unwrapResult(chat);
}

export async function getChatIfPossible(
    context: ServerActionContext,
    chatId: ChatId,
    options?: {
        consistency?: DynamoCacheReadConsistency;
        onSiteId?: (siteId: SiteId) => void;
    },
): Promise<Result<ChatModel, ErrorBase> | null> {
    const chatItem = await getChatItemIfExistsForAuthorization(context, chatId, options);
    if (!chatItem) return null;

    // This call won't make any database calls since it's after the
    // `getChatItemForAuthorization()` call which will cache the data we need.
    // `onSiteId` was already fired during the load above; the cached path here won't
    // fire it again, so there's no need to forward it.
    const result = await authorizeChatAccessIfPossible(context, chatId, "View");
    if (!result.ok) return result;

    return {ok: true, value: await createChatModelFromItem(context, chatItem)};
}
