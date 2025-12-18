/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

// Install event - fired when the service worker is first installed
self.addEventListener("install", (event: ExtendableEvent) => {
    event.waitUntil(self.skipWaiting());
});

// Activate event - fired when the service worker becomes active
self.addEventListener("activate", (event: ExtendableEvent) => {
    // Claim all clients immediately, we have no other workers to compete with
    event.waitUntil(self.clients.claim());
});

// Push event - fired when a push notification is received
self.addEventListener("push", (event: PushEvent) => {
    // We should always have a title for a push notification, but just in case, this allows
    // us to still display a notification.
    let title = "Someone is trying to get your attention in Alpine";

    let notificationData: {
        body: string;
        data: {
            url: string;
        };
    };

    try {
        const payload = event.data?.json();
        title = payload.title;
        notificationData = {
            body: payload.body,
            data: payload.data,
        };
    } catch {
        // Use text data as the title if JSON parsing fails. This is mostly here to support sending
        // test push notifications from Chrome DevTools.
        title = event.data?.text() ?? "";
        notificationData = {
            body: "",
            data: {
                url: "/",
            },
        };
    }

    event.waitUntil(
        self.registration.showNotification(title, {
            body: notificationData.body,
            data: notificationData.data,
        }),
    );
});

// Notification click event - fired when user clicks on a notification
self.addEventListener("notificationclick", (event: NotificationEvent) => {
    event.notification.close();

    const urlToOpen = event.notification.data.url || "/";

    const promiseChain = self.clients
        .matchAll({
            type: "window",
            includeUncontrolled: true,
        })
        .then(windowClients => {
            // Check if there's already a window open
            for (const client of windowClients) {
                if (client.url === urlToOpen && "focus" in client) {
                    return client.focus();
                }
            }
            // If no window is open, open a new one
            if (self.clients.openWindow) {
                return self.clients.openWindow(urlToOpen);
            }
        });

    event.waitUntil(promiseChain);
});

self.addEventListener("fetch", (event: FetchEvent) => {
    const url = new URL(event.request.url);
    if (url.pathname.startsWith("/sign-out")) {
        // This only deregisters the push subscription on the client. We deregister the subscription
        // on the server separately in the `sign-out` route loader.
        const deregisterPushSubscription = async () => {
            // Wait for the sign out request to finish successfully.
            await event.handled;

            const subscription = await self.registration.pushManager.getSubscription();
            if (subscription) {
                await subscription.unsubscribe();
            }
        };
        event.waitUntil(deregisterPushSubscription());
    }
});
