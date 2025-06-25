import {errorDisplayMessage} from "~/shared/error/error_display_message.js";

/**
 * Error message we show when the user hasn't authenticated (signed in) with
 * our service and signing in is required.
 */
export const unauthenticatedErrorDisplayMessage = errorDisplayMessage`You aren’t signed in. Please ${errorDisplayMessage.signInLink(
    "sign in",
)} and try again.`;
