import {ChatAccountItem, ChatTable} from "~/server/chat/data/internal/chat_table.js";
import {ChatItemAuthorizationCache} from "~/server/chat/data/internal/get_chat_item_for_authorization.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {emptyObject} from "~/shared/helpers/object/empty_object.open_source.js";
import {AccountId, ChatId} from "~/shared/id/types/id_types.open_source.js";

export const ChatAccountItemAuthorizationCache = new DynamoContextCache<
    `${ChatId}:${AccountId}`,
    ChatAccountItem | null
>({
    // Allow sharing this cache because the loaded DynamoDB item doesn't depend on who
    // the actor is.
    whenActorChanges: "DangerouslyShare",
});

export async function getChatAccountItemIfExistsForAuthorization(
    context: ServerActionContext,
    chatId: ChatId,
    accountId: AccountId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = emptyObject,
): Promise<ChatAccountItem | null> {
    const chatItem = await ChatItemAuthorizationCache.getIfExists(context, consistency, chatId);
    if (chatItem) {
        // Optimization: If this is not a direct chat then there should be no account
        // items.
        if (chatItem.attributesItem.definition.type !== "Direct") return null;

        return chatItem.accountItems.find(item => item.accountId === accountId) ?? null;
    }

    return await ChatAccountItemAuthorizationCache.get(
        context,
        consistency,
        `${chatId}:${accountId}`,
        consistency =>
            ChatTable.getItemIfExists(
                context,
                {
                    partitionType: "Chat",
                    sortRangeType: "Account",
                    chatId,
                    accountId,
                },
                {consistency},
            ),
    );
}
