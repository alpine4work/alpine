import {authorizeChatAccess} from "~/server/chat/data/authorize_chat_access.js";
import {dangerouslyGetChatMessagesFromEndAssumingAuthorizedChat} from "~/server/chat/data/chat_messaging.js";
import {getChat} from "~/server/chat/data/get_chat.js";
import {ChatForAccountsResult} from "~/server/chat/data/internal/actually_get_or_create_chat_for_accounts.js";
import {createChatModelFromItem} from "~/server/chat/data/internal/create_chat_model_from_item.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {ChatMessageModel, ChatModel} from "~/shared/chat/chat_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

export async function actuallyGetChatAndInitialMessages(
    context: ServerActionContext,
    {
        result,
        messagesLimit,
        onChat,
    }: {
        result: ChatForAccountsResult;
        messagesLimit: number;
        onChat?: (chat: ChatModel) => void;
    },
): Promise<{
    chat: ChatModel;
    initialMessages: ReadonlyArray<ChatMessageModel>;
    initialOtherReferencedMessages: ReadonlyArray<ChatMessageModel>;
}> {
    let chatPromise: Promise<ChatModel>;
    switch (result.type) {
        case "FoundIdOnly": {
            chatPromise = getChat(context, result.chatId);
            break;
        }
        case "FoundItems": {
            chatPromise = (async () => {
                // This call won't make any database calls since it's (hopefully) after a
                // `getChatItemForAuthorization()` call which will cache the data we need.
                await authorizeChatAccess(context, result.chatId);

                return createChatModelFromItem(context, result.chatItem);
            })();
            break;
        }
        default:
            throw exhaustive(result);
    }

    const [chat, {messages, otherReferencedMessages}] = await runAllPromises([
        chatPromise.then(chat => {
            onChat?.(chat);
            return chat;
        }),
        dangerouslyGetChatMessagesFromEndAssumingAuthorizedChat(context, {
            chatId: result.chatId,
            chatItemPromise: chatPromise.then(({spaceId, messageCount}) => ({
                spaceId,
                messagesSummary: {messageCount},
            })),
            limit: messagesLimit,
            afterMessageIndex: null,
            beforeMessageIndex: null,
        }),
    ]);

    const lastMessageIndex = messages.length > 0 ? messages[messages.length - 1]!.index : -1;

    return {
        chat: chat.clone({
            messageCount: Math.max(
                chat.messageCount,
                // Make sure `messageCount` is consistent with `messages` in case of eventual
                // consistency race conditions.
                lastMessageIndex + 1,
            ),
        }),
        initialMessages: messages,
        initialOtherReferencedMessages: otherReferencedMessages,
    };
}
