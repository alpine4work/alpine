import {authorizeChatAccessAndReturnItem} from "~/server/chat/data/internal/authorize_chat_access_and_return_item.js";
import {ChatTable} from "~/server/chat/data/internal/chat_table.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {ChatId} from "~/shared/id/types/id_types.js";

export async function subscribeToRoomChat(context: ServerSessionActionContext, chatId: ChatId) {
    await setRoomChatIsSubscribed(context, chatId, true);
}

export async function unsubscribeFromRoomChat(context: ServerSessionActionContext, chatId: ChatId) {
    await setRoomChatIsSubscribed(context, chatId, false);
}

/**
 * Explicitly subscribe or unsubscribe an account from a room chat.
 */
async function setRoomChatIsSubscribed(
    context: ServerSessionActionContext,
    chatId: ChatId,
    isSubscribed: boolean,
): Promise<void> {
    const attributesItem = await authorizeChatAccessAndReturnItem(context, chatId, "View");

    if (attributesItem.definition.type !== "Room") {
        throw new FailedPreconditionError("Can only subscribe to room chats");
    }

    await ChatTable.createOrReplaceItem(context, {
        partitionType: "Chat",
        sortRangeType: "Subscription",
        chatId,
        accountId: context.actor.getAccountId(),
        isSubscribed,
    });
}
