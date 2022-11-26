import {UnauthenticatedError} from "~/shared/error/error";
import {errorDisplayMessage} from "~/shared/error/error_display_message";

export function unauthenticatedSessionError() {
    return new UnauthenticatedError("Unauthenticated session", {
        displayMessage: errorDisplayMessage`You are not signed in. Please ${errorDisplayMessage.link(
            "sign in",
            "/sign-in",
        )} and try again.`,
    });
}
