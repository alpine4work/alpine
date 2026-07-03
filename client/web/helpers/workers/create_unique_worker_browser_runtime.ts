import {createUniqueWorkerBrokerTabConnection} from "~/client/web/helpers/workers/create_unique_worker_broker_tab_connection.js";
import {
    UniqueWorkerBrokerTabConnection,
    UniqueWorkerHandle,
    UniqueWorkerLockHold,
    UniqueWorkerRpcPort,
    UniqueWorkerTabRuntime,
} from "~/client/web/helpers/workers/unique_worker_client.js";
import {UnknownError} from "~/shared/error/error.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";

/**
 * The real-browser {@link UniqueWorkerTabRuntime}: `navigator.locks` for election,
 * a shared per-tab connection to the broker SharedWorker, and real
 * `MessageChannel`s. Only `createWorker` is caller-provided, since the worker
 * script is what makes each unique worker unique.
 */
export function createUniqueWorkerBrowserRuntime(options: {
    createWorker(): Worker;
}): UniqueWorkerTabRuntime {
    return {
        tryAcquireLock: name => acquireBrowserLock(name, {ifAvailable: true}),
        waitForLock: (name, signal) => acquireBrowserLock(name, {signal}),
        broker: getUniqueWorkerBrokerTabConnection(),
        createWorker() {
            const worker = options.createWorker();
            const handle: UniqueWorkerHandle = {
                postMessage(data, transfer) {
                    worker.postMessage(data, [...transfer] as Array<Transferable>);
                },
                onerror: null,
                terminate() {
                    worker.terminate();
                },
            };
            worker.onerror = event => {
                handle.onerror?.(
                    event.error instanceof Error
                        ? event.error
                        : new UnknownError(event.message || "Unique worker error"),
                );
            };
            return handle;
        },
        createMessageChannel() {
            const channel = new MessageChannel();
            return {
                rpcPort: adaptUniqueWorkerMessagePort(channel.port1),
                transferPort: channel.port2,
            };
        },
    };
}

function adaptUniqueWorkerMessagePort(port: MessagePort): UniqueWorkerRpcPort {
    const adapted: UniqueWorkerRpcPort = {
        postMessage(data) {
            port.postMessage(data);
        },
        onmessage: null,
        start() {
            port.start();
        },
        close() {
            port.close();
        },
    };
    port.onmessage = event => adapted.onmessage?.({data: event.data});
    return adapted;
}

function acquireBrowserLock(
    name: string,
    options: {ifAvailable?: boolean; signal?: AbortSignal},
): Promise<UniqueWorkerLockHold | null> {
    const result = createPromiseResolver<UniqueWorkerLockHold | null>();
    const hold = createPromiseResolver<void>();
    navigator.locks
        .request(name, {mode: "exclusive", ...options}, async lock => {
            if (lock === null) {
                // An `ifAvailable` request while the lock is held elsewhere.
                result.resolve(null);
                return;
            }
            result.resolve({release: () => hold.resolve()});
            await hold.promise;
        })
        .catch((error: unknown) => {
            if (error instanceof DOMException && error.name === "AbortError") {
                result.resolve(null);
            } else {
                result.reject(error);
            }
        });
    return result.promise;
}

let brokerTabConnection: UniqueWorkerBrokerTabConnection | null = null;

// This tab's singleton connection to the broker SharedWorker, created lazily on
// first use and shared by every `UniqueWorkerClient` in the tab.
function getUniqueWorkerBrokerTabConnection(): UniqueWorkerBrokerTabConnection {
    if (brokerTabConnection !== null) return brokerTabConnection;

    const sharedWorker = new SharedWorker(new URL("./unique_worker_broker.js", import.meta.url), {
        type: "module",
        name: "unique-worker-broker",
    });
    const port = sharedWorker.port;

    brokerTabConnection = createUniqueWorkerBrokerTabConnection({
        port: {
            postMessage(data, transfer) {
                port.postMessage(data, (transfer ?? []) as Array<Transferable>);
            },
            set onmessage(
                handler: ((event: {data: unknown; ports: ReadonlyArray<unknown>}) => void) | null,
            ) {
                port.onmessage = handler
                    ? messageEvent => handler({data: messageEvent.data, ports: messageEvent.ports})
                    : null;
            },
            get onmessage() {
                return null;
            },
            start() {
                port.start();
            },
        },
        clientLockName: `unique-worker-client:${Math.random().toString(36).slice(2)}`,
        holdClientLock(clientLockName) {
            const held = createPromiseResolver<void>();
            void navigator.locks.request(clientLockName, () => {
                held.resolve();
                // Hold the lock until this tab's context is destroyed.
                return new Promise<never>(() => {});
            });
            return held.promise;
        },
    });
    return brokerTabConnection;
}
