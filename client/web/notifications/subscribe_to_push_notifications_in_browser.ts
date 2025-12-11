import {FailedPreconditionError} from "~/shared/error/error.js";

/**
 * Gets or creates a push subscription on the browser.
 */
export async function subscribeToPushNotificationsInBrowser(
    vapidPublicKey: PushSubscriptionOptionsInit["applicationServerKey"],
    unsubscribeExistingSubscription: boolean = false,
): Promise<PushSubscription | null> {
    // Must be running in a browser
    if (typeof window === "undefined" || typeof navigator === "undefined") {
        return null;
    }

    // Do nothing if push notifications are not supported in this browser
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        return null;
    }

    // `userVisibleOnly` *must* be set to true for Chrome to receive push notifications.
    const subscriptionOptions: PushSubscriptionOptionsInit = {
        userVisibleOnly: true,
        applicationServerKey: vapidPublicKey,
    };

    // Wait until the service worker is ready
    const registration = await navigator.serviceWorker.ready;

    const notificationPermissions = Notification.permission;

    // We expect that browser permissions have already been requested and granted by the user.
    if (notificationPermissions !== "granted") {
        throw new FailedPreconditionError(
            "User has not granted browser permission to receive push notifications",
        );
    }

    const existingSubscription = await registration.pushManager.getSubscription();

    if (existingSubscription && !unsubscribeExistingSubscription) {
        return existingSubscription;
    } else if (existingSubscription && unsubscribeExistingSubscription) {
        await existingSubscription.unsubscribe();
    }

    return await registration.pushManager.subscribe(subscriptionOptions);
}
