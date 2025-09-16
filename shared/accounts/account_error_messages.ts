import {NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";

export function createAccountNotFoundError(accountId?: string) {
    return new NotFoundError("Account not found", {
        aggregateDedupeKey: accountId,
        displayMessage: errorDisplayMessage`This account doesn’t exist.`,
    });
}
