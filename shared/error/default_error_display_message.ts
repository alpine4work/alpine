import {errorDisplayMessage} from "~/shared/error/error_display_message.js";

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
