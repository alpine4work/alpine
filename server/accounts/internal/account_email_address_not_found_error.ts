import {NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";

export function accountEmailAddressNotFoundError(emailAddress: string) {
    return new NotFoundError("Account email address not found", {
        displayMessage: accountEmailAddressNotFoundErrorDisplayMessage(emailAddress),
    });
}

function accountEmailAddressNotFoundErrorDisplayMessage(emailAddress: string) {
    return errorDisplayMessage`Can’t find an account for “${emailAddress}”. Try again with a different email or ${errorDisplayMessage.link(
        "sign up",
        `/auth/sign-up?email=${encodeURIComponent(emailAddress)}`,
    )}.`;
}
