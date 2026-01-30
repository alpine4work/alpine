import {NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";

export function createBotNotFoundError(botId: string | undefined) {
    return new NotFoundError("Bot not found", {
        aggregateDedupeKey: botId,
        displayMessage: errorDisplayMessage`This bot doesn\u2019t exist.`,
    });
}
