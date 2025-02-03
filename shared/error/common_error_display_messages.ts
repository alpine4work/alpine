import {errorDisplayMessage} from "~/shared/error/error_display_message.js";

/**
 * Error message we show when the user hasn't authenticated (signed in) with
 * our service and signing in is required.
 */
export const unauthenticatedErrorDisplayMessage = errorDisplayMessage`You aren’t signed in. Please ${errorDisplayMessage.signInLink(
    "sign in",
)} and try again.`;

/**
 * Error message we show when the user is signed in but doesn't have access to
 * the space they're trying to view.
 */
export const spaceAccessPermissionDeniedErrorDisplayMessage = errorDisplayMessage`You don’t have access to this space. Try ${errorDisplayMessage.switchSpaceLink(
    "switching spaces",
)} or ${errorDisplayMessage.signOutLink("signing out")}.`;
