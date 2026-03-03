/**
 * Registers the service worker. Should be called from the client entry point after
 * the app has loaded.
 */
export async function registerAppServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (!("serviceWorker" in navigator)) {
        return null;
    }

    const registration = await navigator.serviceWorker.register("/service-worker.js", {
        scope: "/",
    });

    return registration;
}
