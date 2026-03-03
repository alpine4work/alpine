import {FailedPreconditionError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";

/**
 * Gets the current browser push notification permission or prompts the user for
 * permission if it hasn't been explicitly granted or denied.
 */
export async function getOrPromptForBrowserPushNotificationPermission() {
    // If we're not in a browser context or service workers are not supported, do
    // nothing.
    if (typeof window === "undefined" || typeof navigator === "undefined") {
        return;
    }

    // Only select mobile, very old, or weird browsers don't support the Notification
    // API.
    if (typeof Notification === "undefined") {
        throw new FailedPreconditionError("Browser doesn\u2019t support the notifications API", {
            displayMessage: errorDisplayMessage`This browser doesn\u2019t support push notifications`,
        });
    }

    const permission = Notification.permission;

    // `default` means the user has not yet been prompted for permission.
    if (permission === "default") {
        return await Notification.requestPermission();
    }
    return permission;
}
