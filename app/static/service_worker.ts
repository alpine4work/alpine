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

    const promiseChain = isClientFocused().then(isFocused => {
        // Don't show push notifications if the user is currently in the app.
        if (isFocused) {
            return;
        }
        return self.registration.showNotification(title, {
            body: notificationData.body,
            data: notificationData.data,
        });
    });

    event.waitUntil(promiseChain);
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

function isClientFocused() {
    return self.clients
        .matchAll({
            type: "window",
            includeUncontrolled: true,
        })
        .then(windowClients => {
            let clientIsFocused = false;

            for (let i = 0; i < windowClients.length; i++) {
                const windowClient = windowClients[i];
                if (windowClient?.focused) {
                    clientIsFocused = true;
                    break;
                }
            }
            return clientIsFocused;
        });
}
