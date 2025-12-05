import {AppContext} from "~/client/web/context/app_context.js";
import {registerAccountWebPushSubscription} from "~/shared/rpc/notifications_rpc_definitions.js";

/**
 * Registers the service worker.
 * Should be called from the client entry point after the app has loaded.
 */
export async function registerAppServiceWorker(
    context: AppContext,
): Promise<ServiceWorkerRegistration | null> {
    if (!("serviceWorker" in navigator)) {
        return null;
    }

    const registration = await navigator.serviceWorker.register("/service-worker.js", {
        scope: "/",
    });

    navigator.serviceWorker.addEventListener("message", event => {
        if (event.data && event.data.type === "PUSH_SUBSCRIPTION_CHANGE") {
            const newSubscription = event.data.subscription;
            void registerAccountWebPushSubscription(context, {
                subscription: newSubscription,
                spaceId: event.data.spaceId,
                browserId: event.data.browserId,
            });
        }
    });

    return registration;
}
