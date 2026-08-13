import {serializeWebPushSubscription} from "~/client/web/notifications/serialize_web_push_subscription.js";
import {getWebPushStore} from "~/client/web/notifications/web_push_store.js";
import {FailedPreconditionError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {BrowserId} from "~/shared/id/types/id_types.js";
import {WebPushSubscription} from "~/shared/notifications/web_push_subscription.js";

/**
 * Gets or creates a push subscription on the browser and returns a validated web
 * push subscription.
 *
 * If `unsubscribeExistingSubscription` is true, this will first unsubscribe from
 * the existing subscription if it exists then create a new subscription instead of
 * only creating a new subscription if one doesn't already exist.
 */
export async function subscribeToPushNotificationsInBrowser(
    browserId: BrowserId,
    unsubscribeExistingSubscription: boolean = false,
): Promise<WebPushSubscription | null> {
    // Must be running in a browser
    if (typeof window === "undefined" || typeof navigator === "undefined") {
        return null;
    }

    // Do nothing if push notifications are not supported in this browser
    if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
    ) {
        return null;
    }

    const {getVapidCredentials, putWebPushSubscription} = getWebPushStore();

    const [vapidCredentials, registration] = await runAllPromises([
        getVapidCredentials(),
        // Wait until the service worker is ready
        navigator.serviceWorker.ready,
    ]);
    assert(vapidCredentials, "Missing vapid credentials");

    // `userVisibleOnly` _must_ be set to true for Chrome to receive push
    // notifications.
    const subscriptionOptions: PushSubscriptionOptionsInit = {
        userVisibleOnly: true,
        applicationServerKey: vapidCredentials.vapidPublicKey,
    };

    const notificationPermissions = Notification.permission;

    // We expect that browser permissions have already been requested and granted by
    // the user.
    if (notificationPermissions !== "granted") {
        throw new FailedPreconditionError(
            "User has not granted browser permission to receive push notifications",
        );
    }
    if (unsubscribeExistingSubscription) {
        const oldSubscription = await registration.pushManager.getSubscription();
        if (oldSubscription) {
            await oldSubscription.unsubscribe();
        }
    }

    const newSubscription = await registration.pushManager.subscribe(subscriptionOptions);
    const subscription = serializeWebPushSubscription(newSubscription);

    await putWebPushSubscription({
        browserId,
        subscription,
        options: subscriptionOptions,
    });
    return subscription;
}
