import {
    actuallyGetChatAndInitialMessages,
    actuallyGetChatAndInitialMessagesIfPossible,
} from "~/server/chat/data/internal/actually_get_chat_and_initial_messages.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {ChatMessageModel, ChatModel} from "~/shared/chat/chat_model.js";
import {ErrorBase} from "~/shared/error/error.open_source.js";
import {Result} from "~/shared/helpers/control/result.open_source.js";
import {ChatId, SiteId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Get our chat and initial messages that come with it efficiently at once.
 */
export function getChatAndInitialMessages(
    context: ServerActionContext,
    {
        chatId,
        messagesLimit,
        onSiteId,
        onChat,
    }: {
        chatId: ChatId;
        messagesLimit: number;
        onSiteId?: (siteId: SiteId) => void;
        onChat?: (chat: ChatModel) => void;
    },
): Promise<{
    chat: ChatModel;
    // Null means "not sure" or "not applicable". If the client needs the subscription
    // state it'll need to load the state locally.
    initialIsSubscribed: boolean | null;
    initialMessages: ReadonlyArray<ChatMessageModel>;
    initialOtherReferencedMessages: ReadonlyArray<ChatMessageModel>;
}> {
    return actuallyGetChatAndInitialMessages(context, {
        result: {type: "FoundIdOnly", chatId},
        messagesLimit,
        onSiteId,
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
        onSiteId,
    }: {
        chatId: ChatId;
        messagesLimit: number;
        onChat?: (chat: ChatModel) => void;
        onSiteId?: (siteId: SiteId) => void;
    },
): Promise<Result<
    {
        chat: ChatModel;
        // Null means "not sure" or "not applicable". If the client needs the subscription
        // state it'll need to load the state locally.
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
        onSiteId,
    });
}
