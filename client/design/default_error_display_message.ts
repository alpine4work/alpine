import {errorDisplayMessage} from "~/shared/error/error_display_message.js";

// The same default error message is copied in
// `WebNavigationController.swift`'s `showUnhealthyAlert()` function. If we
// update the message here, we should update it there as well.
export const defaultErrorDisplayMessage = errorDisplayMessage`An unexpected error occurred, please try again. If the problem continues, let us know at ${errorDisplayMessage.supportLink}`;
