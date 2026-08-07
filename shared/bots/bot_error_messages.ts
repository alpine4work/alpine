import {NotFoundError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";

export function createBotNotFoundError(botId: string | undefined) {
    return new NotFoundError("Bot not found", {
        aggregateDedupeKey: botId,
        displayMessage: errorDisplayMessage`This bot doesn\u2019t exist.`,
    });
}
