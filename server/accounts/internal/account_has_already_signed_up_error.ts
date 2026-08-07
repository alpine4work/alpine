import {FailedPreconditionError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";

export function accountHasAlreadySignedUpError() {
    throw new FailedPreconditionError("Account has already finished signing up", {
        displayMessage: errorDisplayMessage`You\u2019ve already finished signing up. Try ${errorDisplayMessage.signInLink(
            "signing in",
        )} instead.`,
    });
}
