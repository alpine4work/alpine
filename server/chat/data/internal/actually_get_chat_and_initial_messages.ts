import {authorizeChatAccessIfPossible} from "~/server/chat/data/authorize_chat_access.js";
import {dangerouslyGetChatMessagesFromEndAssumingAuthorizedChat} from "~/server/chat/data/chat_messaging.js";
import {getChatIfPossible} from "~/server/chat/data/get_chat.js";
import {ChatForAccountsResult} from "~/server/chat/data/internal/actually_get_or_create_chat_for_accounts.js";
import {createChatModelFromItem} from "~/server/chat/data/internal/create_chat_model_from_item.js";
import {isSubscribedToRoomChat} from "~/server/chat/data/is_subscribed_to_room_chat.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {createChatNotFoundError} from "~/shared/chat/chat_error_messages.js";
import {ChatMessageModel, ChatModel} from "~/shared/chat/chat_model.js";
import {ErrorBase} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Result} from "~/shared/helpers/control/result.js";

export async function actuallyGetChatAndInitialMessages(
    context: ServerActionContext,
    options: {
        result: ChatForAccountsResult;
        messagesLimit: number;
        onChat?: (chat: ChatModel) => void;
    },
): Promise<{
    chat: ChatModel;
    // Null means "not sure" or "not applicable". If the client needs the
    // subscription state it'll need to load the state locally.
    initialIsSubscribed: boolean | null;
    initialMessages: ReadonlyArray<ChatMessageModel>;
    initialOtherReferencedMessages: ReadonlyArray<ChatMessageModel>;
}> {
    const result = await actuallyGetChatAndInitialMessagesIfPossible(context, options);
    if (!result) throw createChatNotFoundError(options.result.chatId);
    return unwrapResult(result);
}

export async function actuallyGetChatAndInitialMessagesIfPossible(
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
): Promise<Result<
    {
        chat: ChatModel;
        // Null means "not sure" or "not applicable". If the client needs the
        // subscription state it'll need to load the state locally.
        initialIsSubscribed: boolean | null;
        initialMessages: ReadonlyArray<ChatMessageModel>;
        initialOtherReferencedMessages: ReadonlyArray<ChatMessageModel>;
    },
    ErrorBase
> | null> {
    let chatResultPromise: Promise<Result<ChatModel, ErrorBase> | null>;
    switch (result.type) {
        case "FoundIdOnly": {
            chatResultPromise = getChatIfPossible(context, result.chatId);
            break;
        }
        case "FoundItems": {
            chatResultPromise = (async () => {
                // This call won't make any database calls since it's (hopefully) after a
                // `getChatItemForAuthorization()` call which will cache the data we need.
                const authorizationResult = await authorizeChatAccessIfPossible(
                    context,
                    result.chatId,
                    "View",
                );

                if (!authorizationResult?.ok) return authorizationResult;

                return {ok: true, value: await createChatModelFromItem(context, result.chatItem)};
            })();
            break;
        }
        default:
            throw exhaustive(result);
    }

    const [chatResult, messagesResult] = await runAllPromises([
        chatResultPromise.then(
            async (chatResult): Promise<Result<[ChatModel, boolean | null], ErrorBase> | null> => {
                if (!chatResult?.ok) return chatResult;

                onChat?.(chatResult.value);

                if (
                    chatResult.value.definition.type !== "Room" ||
                    context.actor.type !== "Session"
                ) {
                    return {ok: true, value: [chatResult.value, null]};
                } else {
                    const isSubscribed = await isSubscribedToRoomChat(
                        context as ServerSessionActionContext,
                        chatResult.value.id,
                    );
                    return {ok: true, value: [chatResult.value, isSubscribed]};
                }
            },
        ),
        captureResultPromise(
            dangerouslyGetChatMessagesFromEndAssumingAuthorizedChat(context, {
                chatId: result.chatId,
                chatItemPromise: chatResultPromise.then(chatResult => {
                    if (!chatResult) throw createChatNotFoundError(result.chatId);
                    return unwrapResult(chatResult);
                }),
                limit: messagesLimit,
                afterMessageIndex: null,
                beforeMessageIndex: null,
            }),
        ),
    ]);

    if (!chatResult?.ok) return chatResult;

    const [chat, isSubscribed] = chatResult.value;
    const {messages, otherReferencedMessages} = unwrapResult(messagesResult);

    const lastMessageIndex = messages.length > 0 ? messages[messages.length - 1]!.index : -1;

    return {
        ok: true,
        value: {
            chat: chat.clone({
                messageCount: Math.max(
                    chat.messageCount,
                    // Make sure `messageCount` is consistent with `messages` in case of eventual
                    // consistency race conditions.
                    lastMessageIndex + 1,
                ),
            }),
            initialIsSubscribed: isSubscribed,
            initialMessages: messages,
            initialOtherReferencedMessages: otherReferencedMessages,
        },
    };
}
