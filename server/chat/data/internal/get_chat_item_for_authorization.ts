import {
    ChatAccountItem,
    ChatAttributesItem,
    ChatItem,
    ChatTable,
} from "~/server/chat/data/internal/chat_table.js";
import {ServerMinimalActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {createChatNotFoundError} from "~/shared/chat/chat_error_messages.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {emptyObject} from "~/shared/helpers/object/empty_object.js";
import {AccountId, ChatId, SiteId} from "~/shared/id/types/id_types.js";

export const ChatItemAuthorizationCache = new DynamoContextCache<ChatId, ChatItem | null>({
    // Allow sharing this cache because the loaded DynamoDB item doesn't depend on who
    // the actor is.
    whenActorChanges: "DangerouslyShare",
});

export async function getChatItemIfExistsForAuthorization(
    context: ServerMinimalActionContext,
    chatId: ChatId,
    {
        consistency = "Eventual",
        onSiteId,
    }: {
        consistency?: DynamoCacheReadConsistency;
        onSiteId?: (siteId: SiteId) => void;
    } = emptyObject,
): Promise<ChatItem | null> {
    const chatItem = await ChatItemAuthorizationCache.get(
        context,
        consistency,
        chatId,
        async consistency => {
            let attributesItem: ChatAttributesItem | undefined;
            const accountItems: Array<ChatAccountItem> = [];

            for await (const item of ChatTable.query(context, {
                limit: "All",
                consistency,
                partitionKey: {
                    partitionType: "Chat",
                    chatId,
                },
                startSortKey: {
                    sortRangeType: "Attributes",
                },
                endSortKey: {
                    sortRangeType: "Account",
                    accountId: DynamoKeyAttributeSchema.id.getMaxValue<AccountId>(),
                },
            })) {
                switch (item.sortRangeType) {
                    case "Attributes": {
                        assert(!attributesItem);
                        attributesItem = item;
                        break;
                    }
                    case "Account": {
                        assert(attributesItem);
                        accountItems.push(item);
                        break;
                    }
                    default:
                        throw exhaustive(item);
                }
            }

            if (!attributesItem) {
                assert(accountItems.length === 0);
                return null;
            }

            return {
                attributesItem,
                // `Room` chats shouldn't have account items, only `Direct` chats. However, due to
                // race condition or some error edge cases we may have account items in the
                // database for `Room` chats. Ignore the account items in this case.
                accountItems:
                    attributesItem.definition.type === "Direct" ? accountItems : emptyArray,
            };
        },
    );

    if (
        chatItem?.attributesItem.definition.type === "Room" &&
        chatItem.attributesItem.definition.accessPolicy.type === "Site"
    ) {
        onSiteId?.(chatItem.attributesItem.definition.accessPolicy.siteId);
    }

    return chatItem;
}

export async function getChatItemForAuthorization(
    context: ServerMinimalActionContext,
    chatId: ChatId,
    options?: {consistency?: DynamoCacheReadConsistency; onSiteId?: (siteId: SiteId) => void},
): Promise<ChatItem> {
    const chatItem = await getChatItemIfExistsForAuthorization(context, chatId, options);
    if (!chatItem) throw createChatNotFoundError(chatId);
    return chatItem;
}
