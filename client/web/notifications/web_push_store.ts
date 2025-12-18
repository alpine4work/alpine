import {InternalError} from "~/shared/error/error.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {BrowserId, SpaceId} from "~/shared/id/types/id_types.js";
import {WebPushSubscription} from "~/shared/notifications/web_push_subscription.js";

// If the schema of the web push store changes, increment the version number to apply the changes.
// Note that data from the previous version will not carry over to the new version.
const webPushDatabaseVersion = 1;
const webPushDatabaseName = "webPushStore";
const vapidPublicKeyVersion = 1;

type ClientWebPushSubscriptionItem = {
    browserId: BrowserId;
    subscription: WebPushSubscription | null;
    options: PushSubscriptionOptionsInit;
    optedOutSpaceIds: Set<SpaceId>;
};

/*
 * Initializes a client web push store that tracks web push subscriptions using IndexedDB. Can be
 * used in both browser and service worker contexts.
 */
const webPushStore = new Lazy(
    (): {
        setVapidCredentials: (vapidPublicKey: string) => Promise<void>;
        getVapidCredentials: () => Promise<{version: number; vapidPublicKey: string} | null>;
        getWebPushSubscription: (
            browserId: BrowserId,
        ) => Promise<ClientWebPushSubscriptionItem | null>;
        getAllWebPushSubscriptions: () => Promise<Array<ClientWebPushSubscriptionItem>>;
        putWebPushSubscription: ({
            browserId,
            subscription,
            options,
        }: {
            browserId: BrowserId;
            subscription: WebPushSubscription;
            options: PushSubscriptionOptionsInit;
        }) => Promise<void>;
        deleteWebPushSubscription: (browserId: BrowserId) => Promise<void>;
        clearAllWebPushSubscriptions: () => Promise<void>;
    } => {
        // NOTE: Don't worry that we never close this connection.[1]
        // [1]: https://stackoverflow.com/questions/34915581/indexeddb-when-to-close-a-connection/34927204#34927204
        const openRequest = globalThis.indexedDB.open(webPushDatabaseName, webPushDatabaseVersion);

        // Create the initial object stores, this event fires when the database is created or if its
        // version number is incremented.
        openRequest.onupgradeneeded = () => {
            const database = openRequest.result;
            database.createObjectStore("webPushSubscriptions", {keyPath: "browserId"});
            database.createObjectStore("vapidCredentials", {keyPath: "version"});
        };

        const initializeDatabase = async () => {
            return new Promise<IDBDatabase>((resolve, reject) => {
                openRequest.onsuccess = () => {
                    resolve(openRequest.result);
                };

                openRequest.onerror = () => {
                    reject(new InternalError("Failed to open web push store"));
                };
            });
        };

        const databasePromise = initializeDatabase();

        async function setVapidCredentials(vapidPublicKey: string) {
            const database = await databasePromise;
            return new Promise<void>((resolve, reject) => {
                const request = database
                    .transaction("vapidCredentials", "readwrite")
                    .objectStore("vapidCredentials")
                    .put({version: webPushDatabaseVersion, vapidPublicKey});
                request.onsuccess = () => {
                    resolve();
                };
                request.onerror = () => {
                    reject(new InternalError("Could not initialize vapid credentials in store"));
                };
            });
        }

        async function getVapidCredentials() {
            const database = await databasePromise;
            return new Promise<{version: number; vapidPublicKey: string} | null>(
                (resolve, reject) => {
                    const request = database
                        .transaction("vapidCredentials", "readonly")
                        .objectStore("vapidCredentials")
                        .get(vapidPublicKeyVersion);

                    request.onsuccess = () => {
                        resolve(request.result);
                    };
                    request.onerror = () => {
                        reject(new InternalError("Could not get vapid credentials from store"));
                    };
                },
            );
        }

        async function getWebPushSubscription(browserId: BrowserId) {
            const database = await databasePromise;
            return new Promise<ClientWebPushSubscriptionItem | null>((resolve, reject) => {
                const request = database
                    .transaction("webPushSubscriptions", "readonly")
                    .objectStore("webPushSubscriptions")
                    .get(browserId);

                request.onsuccess = () => {
                    resolve(request.result);
                };

                request.onerror = () => {
                    reject(new InternalError("Could not get web push subscription from store"));
                };
            });
        }

        async function getAllWebPushSubscriptions() {
            const database = await databasePromise;
            return new Promise<Array<ClientWebPushSubscriptionItem>>((resolve, reject) => {
                const request = database
                    .transaction("webPushSubscriptions", "readonly")
                    .objectStore("webPushSubscriptions")
                    .getAll();

                request.onsuccess = () => {
                    resolve(request.result);
                };
                request.onerror = () => {
                    reject(
                        new InternalError("Could not get all web push subscriptions from store"),
                    );
                };
            });
        }

        async function putWebPushSubscription({
            browserId,
            subscription,
            options,
        }: {
            browserId: BrowserId;
            subscription: WebPushSubscription;
            options: PushSubscriptionOptionsInit;
        }) {
            const database = await databasePromise;
            let newItem = {
                browserId: browserId,
                subscription: subscription,
                options: options,
                optedOutSpaceIds: new Set(),
            };

            const existingSubscription = await getWebPushSubscription(browserId);
            if (existingSubscription) {
                newItem = {
                    ...existingSubscription,
                    subscription: subscription,
                    options: options,
                };
            }

            return new Promise<void>((resolve, reject) => {
                const objectStore = database
                    .transaction("webPushSubscriptions", "readwrite")
                    .objectStore("webPushSubscriptions");
                const putRequest = objectStore.put(newItem);
                putRequest.onsuccess = () => {
                    resolve();
                };
                putRequest.onerror = () => {
                    reject(new InternalError("Could not put web push subscription in store"));
                };
            });
        }

        async function deleteWebPushSubscription(browserId: BrowserId) {
            const database = await databasePromise;
            return new Promise<void>((resolve, reject) => {
                const request = database
                    .transaction("webPushSubscriptions", "readwrite")
                    .objectStore("webPushSubscriptions")
                    .delete(browserId);

                request.onsuccess = () => {
                    resolve();
                };

                request.onerror = () => {
                    reject(new InternalError("Could not delete web push subscription from store"));
                };
            });
        }

        async function clearAllWebPushSubscriptions() {
            const database = await databasePromise;
            return new Promise<void>((resolve, reject) => {
                const request = database
                    .transaction("webPushSubscriptions", "readwrite")
                    .objectStore("webPushSubscriptions")
                    .clear();

                request.onsuccess = () => {
                    resolve();
                };
                request.onerror = () => {
                    reject(
                        new InternalError("Could not clear web push subscriptions object store"),
                    );
                };
            });
        }

        return {
            setVapidCredentials,
            getVapidCredentials,
            getWebPushSubscription,
            getAllWebPushSubscriptions,
            putWebPushSubscription,
            deleteWebPushSubscription,
            clearAllWebPushSubscriptions,
        };
    },
);

export function getWebPushStore() {
    return webPushStore.get();
}
