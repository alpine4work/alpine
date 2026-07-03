import {
    UniqueWorkerMessage,
    readUniqueWorkerMessage,
} from "~/client/web/helpers/workers/unique_worker_message.js";

/**
 * A tab's port as seen by the broker. Mirrors the subset of `MessagePort` the
 * broker uses; tests substitute fakes.
 */
export interface UniqueWorkerBrokerPort {
    postMessage(data: unknown, transfer?: ReadonlyArray<unknown>): void;
    onmessage: ((event: {data: unknown; ports: ReadonlyArray<unknown>}) => void) | null;
    start(): void;
    close(): void;
}

export interface UniqueWorkerBrokerOptions {
    /**
     * Watch for a tab going away. `clientLockName` is a Web Lock the tab holds
     * exclusively for its whole lifetime; call `onGone` once the lock becomes
     * available (i.e. the tab died or navigated away). The browser implementation
     * requests the lock in `shared` mode and fires `onGone` when granted.
     */
    watchClientGone(clientLockName: string, onGone: () => void): void;
}

export interface UniqueWorkerBroker {
    /** Wire up a newly connected tab port (a SharedWorker `connect` event). */
    handleConnect(port: UniqueWorkerBrokerPort): void;
}

interface UniqueWorkerBrokerClient {
    readonly port: UniqueWorkerBrokerPort;
    helloReceived: boolean;
}

/**
 * Creates the broker that runs inside the `unique_worker_broker.ts` SharedWorker.
 *
 * The broker is deliberately dumb about the connections it relays: it tracks the
 * current leader tab per key, relays follower MessagePorts to that leader, and
 * queues connect requests that arrive while no leader is registered. The queue is
 * what lets clients avoid retry loops — a follower's connect request simply waits
 * here until a leader shows up.
 */
export function createUniqueWorkerBroker(options: UniqueWorkerBrokerOptions): UniqueWorkerBroker {
    const clients = new Set<UniqueWorkerBrokerClient>();
    const leaderByKey = new Map<string, UniqueWorkerBrokerClient>();
    const pendingConnectsByKey = new Map<
        string,
        Array<{port: unknown; from: UniqueWorkerBrokerClient}>
    >();

    function broadcast(message: UniqueWorkerMessage, except: UniqueWorkerBrokerClient | null) {
        for (const client of clients) {
            if (client !== except) {
                client.port.postMessage(message);
            }
        }
    }

    function forwardConnect(leader: UniqueWorkerBrokerClient, key: string, port: unknown) {
        leader.port.postMessage({type: "unique-worker:connect-request", key}, [port]);
    }

    function handleRegisterLeader(client: UniqueWorkerBrokerClient, key: string) {
        const previousLeader = leaderByKey.get(key);
        leaderByKey.set(key, client);

        // If we replaced a leader whose death we hadn't detected yet, its followers are
        // still attached to a dead worker — tell them to reconnect. (When the previous
        // leader died or unregistered first, this broadcast already happened on that
        // path.)
        if (previousLeader !== undefined && previousLeader !== client) {
            broadcast({type: "unique-worker:leader-lost", key}, client);
        }

        const pending = pendingConnectsByKey.get(key);
        if (pending !== undefined) {
            pendingConnectsByKey.delete(key);
            for (const item of pending) {
                forwardConnect(client, key, item.port);
            }
        }
    }

    function handleUnregisterLeader(client: UniqueWorkerBrokerClient, key: string) {
        // Guard against a stale unregister arriving after another tab already registered
        // as the new leader.
        if (leaderByKey.get(key) !== client) return;
        leaderByKey.delete(key);
        broadcast({type: "unique-worker:leader-lost", key}, client);
    }

    function handleConnectRequest(client: UniqueWorkerBrokerClient, key: string, port: unknown) {
        const leader = leaderByKey.get(key);
        if (leader !== undefined) {
            forwardConnect(leader, key, port);
            return;
        }
        let pending = pendingConnectsByKey.get(key);
        if (pending === undefined) {
            pending = [];
            pendingConnectsByKey.set(key, pending);
        }
        pending.push({port, from: client});
    }

    function handleClientGone(client: UniqueWorkerBrokerClient) {
        clients.delete(client);

        for (const [key, leader] of leaderByKey) {
            if (leader === client) {
                leaderByKey.delete(key);
                broadcast({type: "unique-worker:leader-lost", key}, null);
            }
        }

        for (const [key, pending] of pendingConnectsByKey) {
            const remaining = pending.filter(item => item.from !== client);
            if (remaining.length === 0) {
                pendingConnectsByKey.delete(key);
            } else if (remaining.length !== pending.length) {
                pendingConnectsByKey.set(key, remaining);
            }
        }

        client.port.close();
    }

    function handleMessage(
        client: UniqueWorkerBrokerClient,
        data: unknown,
        ports: ReadonlyArray<unknown>,
    ) {
        const message = readUniqueWorkerMessage(data);
        if (message === null) return;

        if (message.type === "unique-worker:hello") {
            if (client.helloReceived) return;
            client.helloReceived = true;
            clients.add(client);
            options.watchClientGone(message.clientLockName, () => handleClientGone(client));
            return;
        }

        // Ignore everything else until the tab has introduced itself — without the hello
        // we have no liveness signal and would leak state for dead tabs.
        if (!client.helloReceived) return;

        switch (message.type) {
            case "unique-worker:register-leader":
                handleRegisterLeader(client, message.key);
                break;
            case "unique-worker:unregister-leader":
                handleUnregisterLeader(client, message.key);
                break;
            case "unique-worker:connect": {
                const port = ports[0];
                if (port !== undefined) {
                    handleConnectRequest(client, message.key, port);
                }
                break;
            }
            default:
                // Other protocol messages never target the broker.
                break;
        }
    }

    return {
        handleConnect(port) {
            const client: UniqueWorkerBrokerClient = {port, helloReceived: false};
            port.onmessage = event => handleMessage(client, event.data, event.ports);
            port.start();
        },
    };
}
