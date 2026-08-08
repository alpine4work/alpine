import {NotFoundError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";

export function createAccountNotFoundError(accountId: string | undefined) {
    return new NotFoundError("Account not found", {
        aggregateDedupeKey: accountId,
        displayMessage: errorDisplayMessage`This account doesn\u2019t exist.`,
    });
}
