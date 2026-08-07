import {NotFoundError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";

export const routeNotFoundErrorDisplayMessage = errorDisplayMessage`The page you opened doesn\u2019t exist.`;

export function routeNotFoundError() {
    return new NotFoundError("Route not found", {
        displayMessage: routeNotFoundErrorDisplayMessage,
    });
}
