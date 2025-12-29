import {FailedPreconditionError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";

export function accountHasAlreadySignedUpError() {
    throw new FailedPreconditionError("Account has already finished signing up", {
        displayMessage: errorDisplayMessage`You’ve already finished signing up. Try ${errorDisplayMessage.signInLink(
            "signing in",
        )} instead.`,
    });
}
