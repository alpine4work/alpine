import {NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ChatId} from "~/shared/id/types/id_types.js";

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
