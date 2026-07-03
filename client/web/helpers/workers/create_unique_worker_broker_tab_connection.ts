import {UniqueWorkerBrokerTabConnection} from "~/client/web/helpers/workers/unique_worker_client.js";
import {readUniqueWorkerMessage} from "~/client/web/helpers/workers/unique_worker_message.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";

/**
 * The tab's end of its broker port. Mirrors the subset of `MessagePort` used.
 */
export interface UniqueWorkerBrokerClientPort {
    postMessage(data: unknown, transfer?: ReadonlyArray<unknown>): void;
    onmessage: ((event: {data: unknown; ports: ReadonlyArray<unknown>}) => void) | null;
    start(): void;
}

/**
 * Creates a tab's connection to the broker: sends the hello handshake, then routes
 * broker pushes to per-key subscribers. One connection is shared by all
 * `UniqueWorkerClient` instances in a tab.
 *
 * The hello is sent only once `holdClientLock` resolves — i.e. once the tab
 * actually holds its lifetime lock. Sending it earlier would let the broker
 * observe the lock as free and immediately consider this tab dead. All other
 * outgoing messages queue behind the hello, preserving order.
 */
export function createUniqueWorkerBrokerTabConnection(options: {
    port: UniqueWorkerBrokerClientPort;
    /** Name of the Web Lock this tab holds for its whole lifetime. */
    clientLockName: string;
    /**
     * Acquires the client lock, resolving once held. The lock is never released.
     */
    holdClientLock(clientLockName: string): Promise<void>;
}): UniqueWorkerBrokerTabConnection {
    const {port, clientLockName} = options;

    interface Subscriber {
        onLeaderLost(): void;
        onConnectRequest(transferPort: unknown): void;
    }
    const subscribersByKey = new Map<string, Set<Subscriber>>();

    port.onmessage = event => {
        const message = readUniqueWorkerMessage(event.data);
        if (message === null) return;
        switch (message.type) {
            case "unique-worker:leader-lost":
                for (const subscriber of subscribersByKey.get(message.key) ?? []) {
                    subscriber.onLeaderLost();
                }
                break;
            case "unique-worker:connect-request": {
                const transferPort = event.ports[0];
                if (transferPort === undefined) break;
                for (const subscriber of subscribersByKey.get(message.key) ?? []) {
                    subscriber.onConnectRequest(transferPort);
                }
                break;
            }
            default:
                break;
        }
    };
    port.start();

    const helloSent = createPromiseResolver<void>();
    void options.holdClientLock(clientLockName).then(() => {
        port.postMessage({type: "unique-worker:hello", clientLockName});
        helloSent.resolve();
    });

    // `.then` callbacks on the same settled promise run in registration order, so
    // queuing behind `helloSent` preserves message order.
    function send(data: unknown, transfer?: ReadonlyArray<unknown>) {
        void helloSent.promise.then(() => {
            port.postMessage(data, transfer);
        });
    }

    return {
        registerLeader(key) {
            send({type: "unique-worker:register-leader", key});
        },
        unregisterLeader(key) {
            send({type: "unique-worker:unregister-leader", key});
        },
        connect(key, transferPort) {
            send({type: "unique-worker:connect", key}, [transferPort]);
        },
        subscribe(key, subscriber) {
            let subscribers = subscribersByKey.get(key);
            if (subscribers === undefined) {
                subscribers = new Set();
                subscribersByKey.set(key, subscribers);
            }
            subscribers.add(subscriber);
            return () => {
                subscribersByKey.get(key)?.delete(subscriber);
            };
        },
    };
}
