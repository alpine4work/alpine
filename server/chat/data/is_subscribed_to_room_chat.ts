import {authorizeChatAccessAndReturnItem} from "~/server/chat/data/internal/authorize_chat_access_and_return_item.js";
import {ChatTable} from "~/server/chat/data/internal/chat_table.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {ChatId} from "~/shared/id/types/id_types.js";

/**
 * Returns true if the actor is subscribed to the room chat. In other words
 * would the actor be returned in `getChatNotificationSubscribers()`?
 */
export async function isSubscribedToRoomChat(
    context: ServerSessionActionContext,
    chatId: ChatId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<boolean> {
    const attributesItem = await authorizeChatAccessAndReturnItem(context, chatId, "View", {
        consistency,
    });

    const accountId = context.actor.getAccountId();

    const subscriptionItem = await ChatTable.getItemIfExists(
        context,
        {
            partitionType: "Chat",
            sortRangeType: "Subscription",
            chatId,
            accountId,
        },
        {consistency},
    );

    if (subscriptionItem) {
        return subscriptionItem.isSubscribed;
    }

    return (
        attributesItem.messagesSummary.messageCountByAuthorId.has(accountId) ||
        attributesItem.messagesSummary.mentionCountByAccountId.has(accountId)
    );
}
