import {AccessLevel} from "~/shared/access/access_policy.js";
import {NotFoundError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.open_source.js";
import {ChatId} from "~/shared/id/types/id_types.open_source.js";

export const chatPermissionDeniedErrorDisplayMessageByAccessLevel: Record<
    AccessLevel,
    ErrorDisplayMessage
> = {
    View: errorDisplayMessage`You don\u2019t have access to this chat.`,
    Comment: errorDisplayMessage`You don\u2019t have access to this chat.`,
    Edit: errorDisplayMessage`You don\u2019t have access to this chat.`,
    Manage: errorDisplayMessage`You don\u2019t have access to this chat.`,
};

export function createChatNotFoundError(chatId: string | undefined) {
    return new NotFoundError("Chat not found", {
        aggregateDedupeKey: chatId,
        displayMessage: errorDisplayMessage`This chat doesn\u2019t exist. Try searching \u201Cmy chats\u201D to see chats you\u2019re in.`,
    });
}

export function createChatMessageNotFoundError(chatId: ChatId, messageIndex: number) {
    return new NotFoundError("Chat message not found", {
        aggregateDedupeKey: `${chatId}-${messageIndex}`,
        displayMessage: errorDisplayMessage`This message doesn\u2019t exist. Try searching \u201Cmy chat messages\u201D to see your recent chat messages.`,
    });
}
