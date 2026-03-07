import type {
    DatabaseClient,
    DatabaseClientConnection,
} from "~/client/web/databases/database_client.js";
import {
    type MutateServerResult,
    type QueryServerResult,
    tabToWorkerDatabaseRpcMethods,
    workerToTabDatabaseRpcMethods,
} from "~/client/web/databases/database_rpc_methods.js";
import {WebWorkerRpc} from "~/client/web/helpers/workers/web_worker_rpc.js";
import {CancelledError} from "~/shared/error/error.js";
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

/** Mirrors `BroadcastChannel`. */
export interface ActiveTabBroadcastChannel {
    postMessage(data: unknown): void;
    onmessage: ((event: {data: unknown}) => void) | null;
    close(): void;
}

// ---------------------------------------------------------------------------
// Connection type
// ---------------------------------------------------------------------------

type TabToWorkerRpc = WebWorkerRpc<
    typeof tabToWorkerDatabaseRpcMethods,
    typeof workerToTabDatabaseRpcMethods
>;

type WorkerToTabRpc = WebWorkerRpc<
    typeof workerToTabDatabaseRpcMethods,
    typeof tabToWorkerDatabaseRpcMethods
>;

export interface DatabaseConnection {
    call: TabToWorkerRpc["call"];
    close(): void;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface RawConnection {
    readonly rpc: TabToWorkerRpc;
    readonly isLeader: boolean;
    close(): void;
}

interface QueuedCall {
    readonly method: string;
    readonly input: unknown;
    readonly resolve: (value: any) => void;
    readonly reject: (error: Error) => void;
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
        const main = this.createConnection(send);

        return (data: unknown, ports: Array<ActiveTabPort>) => {
            const msg = data as {type?: string} | null;
            if (msg?.type === "port") {
                const port = ports[0]!;
                const remote = this.createConnection(m => port.postMessage(m));
                port.onmessage = e => remote.rpc.handleMessage(e.data);
                port.start();
            } else {
                main.rpc.handleMessage(data);
            }
        };
    }

    /**
     * Creates an RPC + connection pair for a single
     * connected tab. The connection's `queryServer`
     * routes back through this RPC to the tab's own
     * WebSocket.
     */
    private createConnection(send: (message: unknown) => void) {
        // conn is defined after rpc but handlers only run
        // asynchronously, so conn is always initialized by
        // the time a handler executes.
        const rpc: WorkerToTabRpc = new WebWorkerRpc({
            callMethods: workerToTabDatabaseRpcMethods,
            handleMethods: tabToWorkerDatabaseRpcMethods,
            handlers: {
                executeQuery: async input => {
                    const rows = (await this.client.executeQuery(
                        conn,
                        input.sql,
                    )) as ReadonlyArray<SchemaSerializedValue>;
                    return {rows};
                },
                executeMutation: async input => {
                    const rows = (await this.client.executeMutation(
                        conn,
                        input.sql,
                    )) as ReadonlyArray<SchemaSerializedValue>;
                    return {rows};
                },
                writePagesFromRealtime: async input => {
                    this.client.writePagesFromRealtime(input.pages);
                    return {};
                },
            },
            send,
        });
        const conn: DatabaseClientConnection = {
            queryServer: async sql => rpc.call("queryServer", {sql}),
            mutateServer: async sql => rpc.call("mutateServer", {sql}),
        };
        return {rpc, conn};
    }
}

// ---------------------------------------------------------------------------
// Main-thread class
// ---------------------------------------------------------------------------

/**
 * Runs on the main thread. Handles leader election
 * via Web Locks, spawns the worker (leader) or
 * connects via the ServiceWorker port relay (follower).
 *
 * The connection returned by {@link connect} is
 * resilient: if the leader tab dies, followers
 * automatically re-elect a leader and reconnect.
 * In-flight and new calls are queued during the
 * transition and replayed on the new connection.
 */
export class DatabaseActiveTabManager {
    private raw: RawConnection | null = null;
    private readonly inflight = new Map<number, QueuedCall>();
    private readonly callQueue: Array<QueuedCall> = [];
    private bc: ActiveTabBroadcastChannel | null = null;
    private closed = false;
    private reconnecting: Promise<void> | null = null;
    private promoting = false;
    private lockWaitActive = false;
    private lockHoldResolve: (() => void) | null = null;
    private nextCallId = 0;

    constructor(
        private readonly deps: {
            locks: ActiveTabLockManager;
            serviceWorker: ActiveTabServiceWorkerContainer;
            createWorker(): ActiveTabWorkerHandle;
            createMessageChannel(): {port1: ActiveTabPort; port2: ActiveTabPort};
            createBroadcastChannel(name: string): ActiveTabBroadcastChannel;
            addUnloadListener(callback: () => void): void;
            queryServer(sql: string): Promise<QueryServerResult>;
            mutateServer(sql: string): Promise<MutateServerResult>;
        },
    ) {}

    async connect(): Promise<DatabaseConnection> {
        const isLeader = await this.tryAcquireLeaderLock();
        const conn = isLeader ? await this.connectAsLeader() : await this.connectAsFollower();
        this.raw = {...conn, isLeader};

        this.bc = this.deps.createBroadcastChannel("alpine-db-coord");
        this.bc.onmessage = event => this.handleBroadcast(event.data);

        if (isLeader) {
            this.deps.addUnloadListener(() => {
                this.bc?.postMessage({type: "db-leader-closing"});
            });
        } else {
            this.setupLockWait();
        }

        return {
            call: ((method: string, input: unknown) =>
                this.callMethod(method, input)) as TabToWorkerRpc["call"],
            close: () => this.closeConnection(),
        };
    }

    // -- Call routing --------------------------------------------------------

    private callMethod(method: string, input: unknown): Promise<unknown> {
        if (this.closed) {
            return Promise.reject(new CancelledError("Connection closed"));
        }

        if (this.raw === null || this.reconnecting !== null || this.promoting) {
            return new Promise((resolve, reject) => {
                this.callQueue.push({method, input, resolve, reject});
            });
        }

        const id = this.nextCallId++;
        const rpc = this.raw.rpc;

        return new Promise((resolve, reject) => {
            this.inflight.set(id, {method, input, resolve, reject});
            (rpc.call as (m: string, i: unknown) => Promise<unknown>)(method, input).then(
                result => {
                    if (this.inflight.delete(id)) {
                        resolve(result);
                    }
                },
                error => {
                    if (this.inflight.delete(id)) {
                        reject(error);
                    }
                },
            );
        });
    }

    private moveInflightToQueue(): void {
        for (const [, call] of this.inflight) {
            this.callQueue.push(call);
        }
        this.inflight.clear();
    }

    private flushQueue(): void {
        const pending = this.callQueue.splice(0);
        for (const item of pending) {
            this.callMethod(item.method, item.input).then(item.resolve, item.reject);
        }
    }

    // -- Broadcast handling --------------------------------------------------

    private handleBroadcast(data: unknown): void {
        if (this.closed || this.promoting) return;
        const msg = data as {type?: string} | null;

        if (msg?.type === "db-leader-closing" && this.raw !== null && !this.raw.isLeader) {
            // Leader is about to close — switch to queuing mode
            // immediately so no new calls go to the dying port.
            this.moveInflightToQueue();
            this.raw.close();
            this.raw = null;
        } else if (msg?.type === "db-new-leader" && (this.raw === null || !this.raw.isLeader)) {
            // A new leader is ready — reconnect as follower.
            void this.reconnectAsFollower();
        }
    }

    // -- Leader death detection via lock-wait --------------------------------

    private setupLockWait(): void {
        if (this.lockWaitActive) return;
        this.lockWaitActive = true;

        this.deps.locks.request("alpine-db", {ifAvailable: false}, async () => {
            this.lockWaitActive = false;
            if (this.closed) return;

            // Wait for any in-progress follower reconnection
            // to finish before we overwrite it.
            if (this.reconnecting) {
                await this.reconnecting;
            }

            await this.promoteToLeader();
            await new Promise<void>(resolve => {
                this.lockHoldResolve = resolve;
            });
        });
    }

    // -- Reconnection --------------------------------------------------------

    /**
     * Called when this tab's lock-wait fires (the
     * previous leader died and we acquired the lock).
     * Swaps the internal connection from follower to
     * leader and notifies other tabs.
     */
    private async promoteToLeader(): Promise<void> {
        this.promoting = true;

        this.moveInflightToQueue();
        this.raw?.close();
        this.raw = null;

        const conn = await this.connectAsLeader();
        this.raw = {...conn, isLeader: true};
        this.promoting = false;

        this.bc!.postMessage({type: "db-new-leader"});
        this.deps.addUnloadListener(() => {
            this.bc?.postMessage({type: "db-leader-closing"});
        });

        this.flushQueue();
    }

    /**
     * Called when a "db-new-leader" broadcast is
     * received. Closes the dead follower connection
     * and reconnects to the new leader via the
     * ServiceWorker port relay.
     */
    private async reconnectAsFollower(): Promise<void> {
        if (this.reconnecting) return;

        this.moveInflightToQueue();
        this.raw?.close();
        this.raw = null;

        this.reconnecting = (async () => {
            const conn = await this.connectAsFollower();
            this.raw = {...conn, isLeader: false};
            this.reconnecting = null;
            this.flushQueue();
        })();

        await this.reconnecting;
    }

    // -- Connection lifecycle ------------------------------------------------

    private closeConnection(): void {
        this.closed = true;

        if (this.raw?.isLeader) {
            this.bc?.postMessage({type: "db-leader-closing"});
        }

        this.raw?.close();
        this.raw = null;
        this.bc?.close();
        this.bc = null;

        // Release the Web Lock so a follower can acquire it.
        // Without this, in-page navigation (component unmount
        // without tab close) would hold the lock forever.
        const resolve = this.lockHoldResolve;
        this.lockHoldResolve = null;
        resolve?.();

        const error = new CancelledError("Connection closed");
        for (const item of this.callQueue) {
            item.reject(error);
        }
        this.callQueue.length = 0;

        for (const [, item] of this.inflight) {
            item.reject(error);
        }
        this.inflight.clear();
    }

    // -- Raw connection helpers ----------------------------------------------

    private tryAcquireLeaderLock(): Promise<boolean> {
        return new Promise(resolve => {
            this.deps.locks.request("alpine-db", {ifAvailable: true}, async lock => {
                if (lock === null) {
                    resolve(false);
                    return;
                }
                resolve(true);
                await new Promise<void>(lockResolve => {
                    this.lockHoldResolve = lockResolve;
                });
            });
        });
    }

    private async connectAsLeader(): Promise<{rpc: TabToWorkerRpc; close(): void}> {
        const worker = this.deps.createWorker();
        await worker.ready;

        const rpc = new WebWorkerRpc({
            callMethods: tabToWorkerDatabaseRpcMethods,
            handleMethods: workerToTabDatabaseRpcMethods,
            handlers: {
                queryServer: async input => {
                    const result = await this.deps.queryServer(input.sql);
                    return {
                        rows: result.rows as ReadonlyArray<SchemaSerializedValue>,
                        pages: result.pages,
                    };
                },
                mutateServer: async input => {
                    const result = await this.deps.mutateServer(input.sql);
                    return {
                        rows: result.rows as ReadonlyArray<SchemaSerializedValue>,
                    };
                },
            },
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

    private async connectAsFollower(): Promise<{rpc: TabToWorkerRpc; close(): void}> {
        const reg = await this.deps.serviceWorker.ready;
        const channel = this.deps.createMessageChannel();

        reg.active!.postMessage({type: "db-connect"}, [channel.port2]);

        const rpc = new WebWorkerRpc({
            callMethods: tabToWorkerDatabaseRpcMethods,
            handleMethods: workerToTabDatabaseRpcMethods,
            handlers: {
                queryServer: async input => {
                    const result = await this.deps.queryServer(input.sql);
                    return {
                        rows: result.rows as ReadonlyArray<SchemaSerializedValue>,
                        pages: result.pages,
                    };
                },
                mutateServer: async input => {
                    const result = await this.deps.mutateServer(input.sql);
                    return {
                        rows: result.rows as ReadonlyArray<SchemaSerializedValue>,
                    };
                },
            },
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
