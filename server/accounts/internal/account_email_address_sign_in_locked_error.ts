import {PermissionDeniedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";

export function accountEmailAddressSignInLockedError(hoursUntilUnlocked: number) {
    return new PermissionDeniedError("Account email address is locked", {
        displayMessage: errorDisplayMessage`This account is locked after entering too many incorrect passwords. Wait ${hoursUntilUnlocked} hour(s) then try ${errorDisplayMessage.signInLink(
            "signing in",
        )} again.`,
    });
}
