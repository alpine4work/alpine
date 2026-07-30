import {ChatAttributesItem, ChatTable} from "~/server/chat/data/internal/chat_table.js";
import {ChatItemAuthorizationCache} from "~/server/chat/data/internal/get_chat_item_for_authorization.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {createChatNotFoundError} from "~/shared/chat/chat_error_messages.js";
import {emptyObject} from "~/shared/helpers/object/empty_object.js";
import {ChatId, SiteId} from "~/shared/id/types/id_types.js";

export const ChatAttributesItemAuthorizationCache = new DynamoContextCache<
    ChatId,
    ChatAttributesItem | null
>({
    // Allow sharing this cache because the loaded DynamoDB item doesn't depend on who
    // the actor is.
    whenActorChanges: "DangerouslyShare",
});

export async function getChatAttributesItemIfExistsForAuthorization(
    context: ServerActionContext,
    chatId: ChatId,
    {
        consistency = "Eventual",
        onSiteId,
    }: {
        consistency?: DynamoCacheReadConsistency;
        onSiteId?: (siteId: SiteId) => void;
    } = emptyObject,
): Promise<ChatAttributesItem | null> {
    const cachedChatItem = await ChatItemAuthorizationCache.getIfExists(
        context,
        consistency,
        chatId,
    );
    // No need to call onSiteId on the cached item, if it's cached, it means we've
    // already read it from DDB at some point and have called `onSite()`
    if (cachedChatItem) {
        const attributesItem = cachedChatItem.attributesItem;
        if (
            attributesItem.definition.type === "Room" &&
            attributesItem.definition.accessPolicy.type === "Site"
        ) {
            onSiteId?.(attributesItem.definition.accessPolicy.siteId);
        }

        return attributesItem;
    }

    const chatItem = await ChatAttributesItemAuthorizationCache.get(
        context,
        consistency,
        chatId,
        async consistency =>
            await ChatTable.getItemIfExists(
                context,
                {
                    partitionType: "Chat",
                    sortRangeType: "Attributes",
                    chatId,
                },
                {consistency},
            ),
    );

    if (chatItem?.definition.type === "Room" && chatItem.definition.accessPolicy.type === "Site") {
        onSiteId?.(chatItem.definition.accessPolicy.siteId);
    }

    return chatItem;
}

export async function getChatAttributesItemForAuthorization(
    context: ServerActionContext,
    chatId: ChatId,
    options?: {consistency?: DynamoCacheReadConsistency; onSiteId?: (siteId: SiteId) => void},
): Promise<ChatAttributesItem> {
    const chatItem = await getChatAttributesItemIfExistsForAuthorization(context, chatId, options);
    if (!chatItem) throw createChatNotFoundError(chatId);
    return chatItem;
}
