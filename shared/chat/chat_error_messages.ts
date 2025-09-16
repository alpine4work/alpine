import {NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";

export function createChatNotFoundError(chatId?: string) {
    return new NotFoundError("Chat not found", {
        aggregateDedupeKey: chatId,
        displayMessage: errorDisplayMessage`This chat doesn’t exist. Try searching “my chats” to see chats you’re in.`,
    });
}
