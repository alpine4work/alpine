import type {DatabaseClient} from "~/client/web/databases/database_client.js";
import {databaseWorkerMethods} from "~/client/web/databases/database_worker_methods.js";
import {WebWorkerRpc} from "~/client/web/helpers/workers/web_worker_rpc.js";
import type {SchemaSerializedValue} from "~/shared/schema/schema.js";

// ---------------------------------------------------------------------------
// Dependency interfaces — mirror browser APIs at the lowest level
// ---------------------------------------------------------------------------

/** Mirrors the subset of `navigator.locks` we use. */
export interface ActiveTabLockManager {
    request(
        name: string,
        options: {ifAvailable: boolean},
        callback: (lock: unknown) => Promise<unknown>,
    ): Promise<unknown>;
}

/** A bidirectional message port. Mirrors `MessagePort`. */
export interface ActiveTabPort {
    postMessage(data: unknown, transfer?: Array<ActiveTabPort>): void;
    onmessage: ((event: {data: unknown; ports: Array<ActiveTabPort>}) => void) | null;
    start(): void;
    close(): void;
}

/** A worker connection. Mirrors the `Worker` API. */
export interface ActiveTabWorkerHandle extends ActiveTabPort {
    readonly ready: Promise<void>;
    terminate(): void;
}

/** Mirrors the main-thread `navigator.serviceWorker` container. */
export interface ActiveTabServiceWorkerContainer {
    readonly ready: Promise<ActiveTabServiceWorkerRegistration>;
    addEventListener(
        type: "message",
        handler: (event: {data: unknown; ports: Array<ActiveTabPort>}) => void,
    ): void;
}

export interface ActiveTabServiceWorkerRegistration {
    readonly active: {
        postMessage(data: unknown, transfer?: Array<ActiveTabPort>): void;
    } | null;
}

/** Mirrors `self.clients` in the ServiceWorker. */
export interface ActiveTabServiceWorkerClients {
    postMessage(clientId: string, data: unknown, transfer: Array<ActiveTabPort>): Promise<void>;
}

// ---------------------------------------------------------------------------
// Connection type
// ---------------------------------------------------------------------------

type DatabaseRpc = WebWorkerRpc<typeof databaseWorkerMethods>;

export interface DatabaseConnection {
    readonly rpc: DatabaseRpc;
    close(): void;
}

// ---------------------------------------------------------------------------
// ServiceWorker class
// ---------------------------------------------------------------------------

/**
 * Runs in the ServiceWorker. Stores the leader tab's
 * clientId and relays MessagePorts from followers to
 * the leader.
 */
export class DatabaseActiveTabServiceWorker {
    private leaderClientId: string | null = null;

    constructor(private readonly clients: ActiveTabServiceWorkerClients) {}

    async handleMessage(
        sourceClientId: string,
        data: unknown,
        ports: Array<ActiveTabPort>,
    ): Promise<void> {
        const msg = data as {type?: string} | null;
        if (msg?.type === "db-register-leader") {
            this.leaderClientId = sourceClientId;
        } else if (msg?.type === "db-connect" && this.leaderClientId !== null) {
            const port = ports[0];
            if (port) {
                await this.clients.postMessage(this.leaderClientId, {type: "db-port"}, [port]);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Worker class
// ---------------------------------------------------------------------------

/**
 * Runs in the dedicated worker. Creates RPC handlers
 * for the main thread connection and any additional
 * ports forwarded from follower tabs.
 */
export class DatabaseActiveTabWorker {
    constructor(private readonly client: DatabaseClient) {}

    /**
     * Returns a message handler function. The caller
     * wires it to `workerSelf.onmessage` or a mock.
     */
    createMessageHandler(
        send: (message: unknown) => void,
    ): (data: unknown, ports: Array<ActiveTabPort>) => void {
        const mainRpc = this.createRpc(send);

        return (data: unknown, ports: Array<ActiveTabPort>) => {
            const msg = data as {type?: string} | null;
            if (msg?.type === "port") {
                const port = ports[0]!;
                const remoteRpc = this.createRpc(m => port.postMessage(m));
                port.onmessage = e => remoteRpc.handleMessage(e.data);
                port.start();
            } else {
                mainRpc.handleMessage(data);
            }
        };
    }

    private createRpc(send: (message: unknown) => void) {
        return new WebWorkerRpc({
            methods: databaseWorkerMethods,
            handlers: {
                executeQuery: async input => {
                    const rows = this.client.executeQuery(
                        input.sql,
                    ) as ReadonlyArray<SchemaSerializedValue>;
                    return {rows};
                },
            },
            send,
        });
    }
}

// ---------------------------------------------------------------------------
// Main-thread class
// ---------------------------------------------------------------------------

/**
 * Runs on the main thread. Handles leader election
 * via Web Locks, spawns the worker (leader) or
 * connects via the ServiceWorker port relay (follower).
 */
export class DatabaseActiveTabManager {
    constructor(
        private readonly deps: {
            locks: ActiveTabLockManager;
            serviceWorker: ActiveTabServiceWorkerContainer;
            createWorker(): ActiveTabWorkerHandle;
            createMessageChannel(): {port1: ActiveTabPort; port2: ActiveTabPort};
        },
    ) {}

    async connect(): Promise<DatabaseConnection> {
        const isLeader = await this.tryAcquireLeaderLock();
        return isLeader ? this.connectAsLeader() : this.connectAsFollower();
    }

    private tryAcquireLeaderLock(): Promise<boolean> {
        return new Promise(resolve => {
            this.deps.locks.request("alpine-db", {ifAvailable: true}, async lock => {
                if (lock === null) {
                    resolve(false);
                    return;
                }
                resolve(true);
                // Hold the lock forever — released when the tab dies
                await new Promise(() => {});
            });
        });
    }

    private async connectAsLeader(): Promise<DatabaseConnection> {
        const worker = this.deps.createWorker();
        await worker.ready;

        const rpc = new WebWorkerRpc({
            methods: databaseWorkerMethods,
            handlers: {} as any,
            send: message => worker.postMessage(message),
        });
        worker.onmessage = event => rpc.handleMessage(event.data);

        const reg = await this.deps.serviceWorker.ready;
        reg.active!.postMessage({type: "db-register-leader"});

        this.deps.serviceWorker.addEventListener("message", event => {
            const msg = event.data as {type?: string} | null;
            if (msg?.type === "db-port") {
                const port = event.ports[0];
                if (port) {
                    worker.postMessage({type: "port"}, [port]);
                }
            }
        });

        return {
            rpc,
            close() {
                worker.terminate();
            },
        };
    }

    private async connectAsFollower(): Promise<DatabaseConnection> {
        const reg = await this.deps.serviceWorker.ready;
        const channel = this.deps.createMessageChannel();

        reg.active!.postMessage({type: "db-connect"}, [channel.port2]);

        const rpc = new WebWorkerRpc({
            methods: databaseWorkerMethods,
            handlers: {} as any,
            send: message => channel.port1.postMessage(message),
        });
        channel.port1.onmessage = event => rpc.handleMessage(event.data);
        channel.port1.start();

        return {
            rpc,
            close() {
                channel.port1.close();
            },
        };
    }
}
