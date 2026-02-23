import {ChatAttributesItem, ChatTable} from "~/server/chat/data/internal/chat_table.js";
import {ChatItemAuthorizationCache} from "~/server/chat/data/internal/get_chat_item_for_authorization.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {createChatNotFoundError} from "~/shared/chat/chat_error_messages.js";
import {emptyObject} from "~/shared/helpers/object/empty_object.js";
import {ChatId} from "~/shared/id/types/id_types.js";

export const ChatAttributesItemAuthorizationCache = new DynamoContextCache<
    ChatId,
    ChatAttributesItem | null
>({
    // Allow sharing this cache because the loaded DynamoDB item doesn't depend
    // on who the actor is.
    whenActorChanges: "DangerouslyShare",
});

export async function getChatAttributesItemIfExistsForAuthorization(
    context: ServerActionContext,
    chatId: ChatId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = emptyObject,
): Promise<ChatAttributesItem | null> {
    const chatItem = await ChatItemAuthorizationCache.getIfExists(context, consistency, chatId);
    if (chatItem) return chatItem.attributesItem;

    return ChatAttributesItemAuthorizationCache.get(context, consistency, chatId, consistency => {
        return ChatTable.getItemIfExists(
            context,
            {
                partitionType: "Chat",
                sortRangeType: "Attributes",
                chatId,
            },
            {consistency},
        );
    });
}

export async function getChatAttributesItemForAuthorization(
    context: ServerActionContext,
    chatId: ChatId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<ChatAttributesItem> {
    const chatItem = await getChatAttributesItemIfExistsForAuthorization(context, chatId, options);
    if (!chatItem) throw createChatNotFoundError(chatId);
    return chatItem;
}
