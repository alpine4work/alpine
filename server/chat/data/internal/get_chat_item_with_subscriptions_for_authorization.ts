import {
    ChatAccountItem,
    ChatAttributesItem,
    ChatItem,
    ChatSubscriptionItem,
    ChatTable,
} from "~/server/chat/data/internal/chat_table.js";
import {ChatItemAuthorizationCache} from "~/server/chat/data/internal/get_chat_item_for_authorization.js";
import {ServerMinimalActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {createChatNotFoundError} from "~/shared/chat/chat_error_messages.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {emptyObject} from "~/shared/helpers/object/empty_object.open_source.js";
import {AccountId, ChatId} from "~/shared/id/types/id_types.open_source.js";

export function getChatItemWithSubscriptionsIfExistsForAuthorization(
    context: ServerMinimalActionContext,
    chatId: ChatId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = emptyObject,
): Promise<(ChatItem & {subscriptionItems: Array<ChatSubscriptionItem>}) | null> {
    const promise = (async () => {
        let attributesItem: ChatAttributesItem | undefined;
        const accountItems: Array<ChatAccountItem> = [];
        const subscriptionItems: Array<ChatSubscriptionItem> = [];

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
                sortRangeType: "Subscription",
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
                case "Subscription": {
                    assert(attributesItem);
                    subscriptionItems.push(item);
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

        return {attributesItem, accountItems, subscriptionItems};
    })();

    // Add the chat item to the cache since we have the full chat attributes and
    // account.
    ChatItemAuthorizationCache.set(context, consistency, chatId, promise);

    return promise;
}

export async function getChatItemWithSubscriptionsForAuthorization(
    context: ServerMinimalActionContext,
    chatId: ChatId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<ChatItem & {subscriptionItems: Array<ChatSubscriptionItem>}> {
    const chatItem = await getChatItemWithSubscriptionsIfExistsForAuthorization(
        context,
        chatId,
        options,
    );
    if (!chatItem) throw createChatNotFoundError(chatId);
    return chatItem;
}
