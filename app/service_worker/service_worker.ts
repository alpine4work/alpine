/// <reference lib="webworker" />

import {serializeWebPushSubscription} from "~/client/web/notifications/serialize_web_push_subscription.js";
import {getWebPushStore} from "~/client/web/notifications/web_push_store.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertId, generateId} from "~/shared/id/id.js";
import {BrowserId} from "~/shared/id/types/id_types.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";
import {TracerEvent} from "~/shared/tracer/tracer_event.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";

declare const self: ServiceWorkerGlobalScope;

// --- Database coordination: MessagePort relay ---
//
// The leader tab registers its clientId. Follower tabs
// send a MessagePort which we relay to the leader so
// followers can talk directly to the leader's worker.
//
// This is an inline copy of `DatabaseActiveTabServiceWorker`
// to avoid pulling `client/web/databases` (and its heavy
// SQLite deps) into the service worker bundle.

let dbLeaderClientId: string | null = null;

self.addEventListener("message", (event: ExtendableMessageEvent) => {
    const data = event.data;
    if (data?.type === "db-register-leader") {
        dbLeaderClientId = (event.source as Client).id;
    } else if (data?.type === "db-connect") {
        const port = event.ports[0];
        if (dbLeaderClientId === null || !port) return;
        event.waitUntil(
            self.clients.get(dbLeaderClientId).then(client => {
                if (client) {
                    client.postMessage({type: "db-port"}, [port]);
                }
            }),
        );
    }
});

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
        silent?: boolean | null;
        tag?: string;
    };

    try {
        const payload = event.data?.json();
        title = payload.title;
        notificationData = {
            body: payload.body,
            data: payload.data,
            silent: payload.silent,
            tag: payload.tag,
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
            // `null` means we use the default behavior of the platform that we're on
            silent: null,
        };
    }

    event.waitUntil(
        self.registration.showNotification(title, {
            ...notificationData,
        }),
    );
});

// Notification click event - fired when user clicks on a notification
self.addEventListener("notificationclick", (event: NotificationEvent) => {
    event.notification.close();

    const urlToOpen = event.notification.data.url || "/";

    const promise = (async () => {
        const windowClients = await self.clients.matchAll({
            type: "window",
            includeUncontrolled: true,
        });

        // Check if there's already a window open
        for (const client of windowClients) {
            if (client.url === urlToOpen && "focus" in client) {
                await client.focus();
                return;
            }
        }

        // If no window is open, open a new one
        if (self.clients.openWindow) {
            await self.clients.openWindow(urlToOpen);
            return;
        }
    })();

    event.waitUntil(promise);
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
        // Resets the web push store to clear all existing web push subscriptions.
        const clearWebPushSubscriptions = async () => {
            // Wait for the sign out request to finish successfully.
            await event.handled;

            const {clearAllWebPushSubscriptions} = getWebPushStore();
            await clearAllWebPushSubscriptions();
        };
        event.waitUntil(
            runAllPromises([deregisterPushSubscription(), clearWebPushSubscriptions()]),
        );
    }
});

// NOTE: (rmtobin, 2025-12-05) The Push API spec says that browsers should fire this event when the
// push subscription is refreshed, revoked, or lost.[1] In practice however, different browsers have
// different opinions on when this event should be fired and whether or not oldSubscription and
// newSubscription are included in the payload, so we can't expect that the old and new subscriptions
// will be included in the payload, so instead we always register a new subscription, and get the old
// subscription data from our web push store.
//
// This is a relatively new part of the Push API, so it is possible that this will change. If you're
// reading this in the future, make sure to take a look at the Push API spec for the latest information.
//
// This could be run in the background, and we rely on the user having a valid session cookie to
// authenticate requests to register and deregister web push subscriptions with the server. Since we
// unsubscribe from any existing subscriptions on sign out, it's expected that this event should never
// be triggered for a signed out user.
//
// [1] https://www.w3.org/TR/push-api/#the-pushsubscriptionchange-event
self.addEventListener("pushsubscriptionchange", (event: PushSubscriptionChangeEvent) => {
    const updateAccountWebPushSubscription = async () => {
        const cookie = await self.cookieStore.get("browser");
        const browserId = cookie?.value ? cookie.value.split("%40")[0] : null;

        // Treat the browser cookie as the source of truth for the current browser id. If there isn't
        // a browser id in the cookie, we don't have a way to identify the current browser, so we skip
        // updating the web push subscription. If the user is actively using Alpine, we'll set the
        // browser cookie on requests, and any space routes will create the web push subscription
        // instead.
        if (!browserId) {
            return;
        }

        const {
            getAllWebPushSubscriptions,
            getVapidCredentials,
            putWebPushSubscription,
            deleteWebPushSubscription,
        } = getWebPushStore();

        // TODO(rmtobin, 2025-12-17) This doesn't batch events like our other tracer implementations
        // but probably should. Currently it sends two events separately.
        const sendTracerEvent = (event: TracerEvent) => {
            // eslint-disable-next-line cyberworlds/no-global-fetch
            void fetch("/api/tracer", {
                method: "POST",
                body: JSON.stringify([
                    {
                        time: event.time,
                        data: {...event.getFlatData(), "meta.client_time_offset_ms": 0},
                    },
                ]),
            });
        };

        const tracer = TracerRoot.new({
            serviceName: "AppClient",
            jsHost: "Web",
            // Events from our client tracer are untrusted because any bad actor could get
            // ahold of our client tracer and send whatever event they want to the server.
            //
            // We can filter out events with this untrusted flag on the server to get
            // clean data.
            untrusted: true,
            // TODO(rmtobin, 2025-12-17) This uses the unsynchronized system clock because our
            // client-side synchronized system clock implementation uses browser APIs that are not
            // available in service workers.
            clock: unsynchronizedSystemClock,
            sendEvent: sendTracerEvent,
        });
        return tracer.withSpan("Handle push subscription change event", async span => {
            const existingSubscriptions = await getAllWebPushSubscriptions();
            const staleSubscriptionPromises = existingSubscriptions
                // Important to only deregister subscriptions for old browserIds, otherwise we could
                // accidentally owerwrite the new subscription on the server if this RPC call happens
                // after the new subscription is registered.
                .filter(subscription => subscription.browserId !== assertId<BrowserId>(browserId))
                .flatMap(subscription => [
                    // We use fetchWithTracer here instead of importing our RPC definitions to reduce the
                    // size of our service worker bundle since we have to bundle all dependencies into a
                    // single `iife` formatted file. We lose out on some type safety and validation, but
                    // this drastically reduces the size of the bundle.
                    fetchWithTracer(
                        tracer,
                        `${self.location.origin}/api/rpc/deregisterOurAccountWebPushSubscription`,
                        {
                            serviceName: "AppClient",
                            route: "/api/rpc/:rpcName",
                            method: "POST",
                            headers: {
                                "content-type": "application/json",
                            },
                            body: JSON.stringify({
                                id: generateId(),
                                name: "deregisterOurAccountWebPushSubscription",
                                input: {
                                    browserId: subscription.browserId,
                                },
                            }),
                        },
                        async response => {
                            if (response.status !== 200) {
                                span.addException(
                                    new InternalError(
                                        "Failed to deregister stale web push subscription",
                                    ),
                                );
                            }
                        },
                    ),
                    deleteWebPushSubscription(subscription.browserId),
                ]);

            const vapidCredentials = await getVapidCredentials();
            assert(vapidCredentials, "Missing vapid credentials");

            const newSubscription = await self.registration.pushManager.subscribe({
                applicationServerKey: vapidCredentials?.vapidPublicKey,
                userVisibleOnly: true,
            });

            const serializedNewSubscription = serializeWebPushSubscription(newSubscription);

            await runAllPromises([
                putWebPushSubscription({
                    browserId: assertId<BrowserId>(browserId),
                    subscription: serializedNewSubscription,
                    options: {
                        userVisibleOnly: true,
                        applicationServerKey: vapidCredentials?.vapidPublicKey,
                    },
                }),

                // We use fetchWithTracer here instead of importing our RPC definitions to reduce the
                // size of our service worker bundle since we have to bundle all dependencies into a
                // single `iife` formatted file. We lose out on some type safety and validation, but
                // this drastically reduces the size of the bundle.
                fetchWithTracer(
                    span,
                    `${self.location.origin}/api/rpc/registerOurAccountWebPushSubscription`,
                    {
                        serviceName: "AppClient",
                        route: "/api/rpc/:rpcName",
                        method: "POST",
                        headers: {
                            "content-type": "application/json",
                        },
                        body: JSON.stringify({
                            id: generateId(),
                            name: "registerOurAccountWebPushSubscription",
                            input: {
                                browserId: assertId<BrowserId>(browserId),
                                subscription: serializedNewSubscription,
                            },
                        }),
                    },
                    async response => {
                        if (response.status !== 200) {
                            span.addException(
                                new InternalError("Failed to register new web push subscription"),
                            );
                        }
                    },
                ),

                ...staleSubscriptionPromises,
            ]);
        });
    };

    event.waitUntil(updateAccountWebPushSubscription());
});
