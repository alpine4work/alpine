import {PermissionDeniedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";

export function permissionDeniedBotError() {
    return new PermissionDeniedError("Bot account not allowed", {
        displayMessage: errorDisplayMessage`Tried to do something a bot isn\u2019t allowed to do.`,
    });
}
