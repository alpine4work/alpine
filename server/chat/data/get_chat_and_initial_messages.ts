import {
    actuallyGetChatAndInitialMessages,
    actuallyGetChatAndInitialMessagesIfPossible,
} from "~/server/chat/data/internal/actually_get_chat_and_initial_messages.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {ChatMessageModel, ChatModel} from "~/shared/chat/chat_model.js";
import {ErrorBase} from "~/shared/error/error.js";
import {Result} from "~/shared/helpers/control/result.js";
import {ChatId} from "~/shared/id/types/id_types.js";

/**
 * Get our chat and initial messages that come with it efficiently at once.
 */
export function getChatAndInitialMessages(
    context: ServerActionContext,
    {
        chatId,
        messagesLimit,
        onChat,
    }: {
        chatId: ChatId;
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
    return actuallyGetChatAndInitialMessages(context, {
        result: {type: "FoundIdOnly", chatId},
        messagesLimit,
        onChat,
    });
}

/**
 * Get our chat and initial messages that come with it efficiently at once.
 */
export function getChatAndInitialMessagesIfPossible(
    context: ServerActionContext,
    {
        chatId,
        messagesLimit,
        onChat,
    }: {
        chatId: ChatId;
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
    return actuallyGetChatAndInitialMessagesIfPossible(context, {
        result: {type: "FoundIdOnly", chatId},
        messagesLimit,
        onChat,
    });
}
