import {NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";

export const routeNotFoundErrorDisplayMessage = errorDisplayMessage`The page you opened doesn\u2019t exist.`;

export function routeNotFoundError() {
    return new NotFoundError("Route not found", {
        displayMessage: routeNotFoundErrorDisplayMessage,
    });
}
