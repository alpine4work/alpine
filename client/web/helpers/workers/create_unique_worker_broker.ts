import {
    UniqueWorkerMessage,
    readUniqueWorkerMessage,
} from "~/client/web/helpers/workers/unique_worker_message.js";

export interface UniqueWorkerBroker {
    /** Wire up a newly connected client port (a SharedWorker `connect` event). */
    handleConnect(port: MessagePort): void;
}

/**
 * Web Lock identifying the current app-version generation. Each broker steals it
 * on startup; the previous holder (the previous version's broker) learns it has
 * been superseded from the steal and tells its tabs to reload.
 */
export const uniqueWorkerBrokerGenerationLockName = "unique-worker:broker-generation";

interface UniqueWorkerBrokerClient {
    readonly port: MessagePort;
    helloReceived: boolean;
}

/**
 * Creates the broker that runs inside the `unique_worker_broker.ts` SharedWorker.
 *
 * The broker is deliberately dumb about the connections it relays: it tracks the
 * current leader client per key, relays follower MessagePorts to that leader, and
 * queues connect requests that arrive while no leader is registered. The queue is
 * what lets clients avoid retry loops — a follower's connect request simply waits
 * here until a leader shows up.
 *
 * Clients are detected as gone via the Web Lock each of them holds for its
 * lifetime (sent in the hello message): a `shared`-mode request for that lock is
 * granted the moment the client goes away.
 *
 * The broker script URL is content-hashed, so each deployed app version gets its
 * own broker instance (SharedWorkers are keyed by URL). On startup the broker
 * steals the generation Web Lock; when that lock is later stolen from _us_, a
 * newer version's broker has started, and we tell all our (stale) tabs to reload.
 * The election locks are version-independent, so at most one dedicated worker
 * exists across versions; a newer tab simply queues on the lock until the old tabs
 * reload and release it.
 */
export function createUniqueWorkerBroker(): UniqueWorkerBroker {
    const clients = new Set<UniqueWorkerBrokerClient>();
    const leaderByKey = new Map<string, UniqueWorkerBrokerClient>();
    const pendingConnectsByKey = new Map<
        string,
        Array<{port: MessagePort; from: UniqueWorkerBrokerClient}>
    >();
    let outdated = false;

    navigator.locks
        .request(
            uniqueWorkerBrokerGenerationLockName,
            {steal: true},
            () => new Promise<never>(() => {}),
        )
        .catch((error: unknown) => {
            // The steal rejects the previous holder's request with AbortError — receiving one
            // means a newer version's broker took over.
            if (error instanceof DOMException && error.name === "AbortError") {
                outdated = true;
                broadcast({type: "unique-worker:outdated"}, null);
            }
        });

    function broadcast(message: UniqueWorkerMessage, except: UniqueWorkerBrokerClient | null) {
        for (const client of clients) {
            if (client !== except) {
                client.port.postMessage(message);
            }
        }
    }

    function forwardConnect(leader: UniqueWorkerBrokerClient, key: string, port: MessagePort) {
        leader.port.postMessage({type: "unique-worker:connect-request", key}, [port]);
    }

    // Remove (and close) queued connects matching the filter, returning the rest.
    function dropPendingConnects(
        key: string,
        shouldDrop: (item: {port: MessagePort; from: UniqueWorkerBrokerClient}) => boolean,
    ) {
        const pending = pendingConnectsByKey.get(key);
        if (pending === undefined) return;
        const remaining = pending.filter(item => {
            if (!shouldDrop(item)) return true;
            item.port.close();
            return false;
        });
        if (remaining.length === 0) {
            pendingConnectsByKey.delete(key);
        } else if (remaining.length !== pending.length) {
            pendingConnectsByKey.set(key, remaining);
        }
    }

    function handleRegisterLeader(client: UniqueWorkerBrokerClient, key: string) {
        const previousLeader = leaderByKey.get(key);
        leaderByKey.set(key, client);

        // The new leader's own queued connect (from before it won the election) is
        // obsolete — it would only wire the leader's dead follower channel into its own
        // worker.
        dropPendingConnects(key, item => item.from === client);

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
        // Guard against a stale unregister arriving after another client already
        // registered as the new leader.
        if (leaderByKey.get(key) !== client) return;
        leaderByKey.delete(key);
        broadcast({type: "unique-worker:leader-lost", key}, client);
    }

    function handleConnectRequest(
        client: UniqueWorkerBrokerClient,
        key: string,
        port: MessagePort,
    ) {
        const leader = leaderByKey.get(key);
        if (leader !== undefined) {
            forwardConnect(leader, key, port);
            return;
        }
        // A client retrying (after leader-lost) supersedes its own earlier request;
        // keeping both would wire a dead channel into the next leader.
        dropPendingConnects(key, item => item.from === client);
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

        for (const key of [...pendingConnectsByKey.keys()]) {
            dropPendingConnects(key, item => item.from === client);
        }

        client.port.close();
    }

    function handleMessage(
        client: UniqueWorkerBrokerClient,
        data: unknown,
        ports: ReadonlyArray<MessagePort>,
    ) {
        const message = readUniqueWorkerMessage(data);
        if (message === null) return;

        if (message.type === "unique-worker:hello") {
            if (client.helloReceived) return;
            client.helloReceived = true;
            clients.add(client);
            // A tab that connects to an already-superseded broker (e.g. restored from the
            // back/forward cache) is stale too — tell it right away.
            if (outdated) {
                client.port.postMessage({type: "unique-worker:outdated"});
            }
            // The client holds this lock exclusively for its lifetime; a shared request is
            // granted the moment the client goes away.
            void navigator.locks.request(message.clientLockName, {mode: "shared"}, async () => {
                handleClientGone(client);
            });
            return;
        }

        // Ignore everything else until the client has introduced itself — without the
        // hello we have no liveness signal and would leak state for dead tabs.
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
