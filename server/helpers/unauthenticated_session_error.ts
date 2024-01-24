import {UnauthenticatedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";

export function unauthenticatedSessionError() {
    return new UnauthenticatedError("Unauthenticated session", {
        displayMessage: errorDisplayMessage`You aren’t signed in. Please ${errorDisplayMessage.link(
            "sign in",
            "/sign-in",
        )} and try again.`,
    });
}
