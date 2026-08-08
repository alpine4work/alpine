import {ErrorBase} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.open_source.js";

/**
 * The default error message to display to users if a `displayMessage` property is
 * not set on the error. Ideally, all errors that are presented to users have a
 * `displayMessage` and users should only see this message if there's actually a
 * bug.
 */
// The same default error message is copied in `WebNavigationController.swift`'s
// `showUnhealthyAlert()` function. If we update the message here, we should update
// it there as well.
export const defaultErrorDisplayMessage = errorDisplayMessage`An unexpected error occurred, please try again. If the problem continues, let us know at ${errorDisplayMessage.supportLink}`;

/**
 * Get the display message for an error or `defaultErrorDisplayMessage` if the
 * error doesn't have a display message.
 */
export function getErrorDisplayMessage(error: unknown): ErrorDisplayMessage {
    if (error instanceof ErrorBase && error.displayMessage !== undefined)
        return error.displayMessage;
    return defaultErrorDisplayMessage;
}

/**
 * Does the provided error have a display message?
 */
export function hasErrorDisplayMessage(error: unknown): boolean {
    if (error instanceof ErrorBase) return error.displayMessage !== undefined;
    return false;
}
