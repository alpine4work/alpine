import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";

export function permissionDeniedBotError() {
    return new PermissionDeniedError("Bot account not allowed", {
        displayMessage: errorDisplayMessage`Tried to do something a bot isn\u2019t allowed to do.`,
    });
}
