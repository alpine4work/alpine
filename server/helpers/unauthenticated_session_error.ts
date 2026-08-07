import {unauthenticatedErrorDisplayMessage} from "~/shared/error/common_error_display_messages.js";
import {UnauthenticatedError} from "~/shared/error/error.open_source.js";

export function unauthenticatedSessionError() {
    return new UnauthenticatedError("Unauthenticated session", {
        aggregateDedupeKey: "unauthenticated",
        displayMessage: unauthenticatedErrorDisplayMessage,
    });
}
