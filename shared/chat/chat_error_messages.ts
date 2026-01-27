import {NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ChatId} from "~/shared/id/types/id_types.js";

export function createChatNotFoundError(chatId: string | undefined) {
    return new NotFoundError("Chat not found", {
        aggregateDedupeKey: chatId,
        displayMessage: errorDisplayMessage`This chat doesn’t exist. Try searching “my chats” to see chats you’re in.`,
    });
}

export function createChatMessageNotFoundError(chatId: ChatId, messageIndex: number) {
    return new NotFoundError("Chat message not found", {
        aggregateDedupeKey: `${chatId}-${messageIndex}`,
        displayMessage: errorDisplayMessage`This message doesn’t exist. Try searching “my chat messages” to see your recent chat messages.`,
    });
}
