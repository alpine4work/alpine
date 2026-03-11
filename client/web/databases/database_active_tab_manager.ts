import {
    DatabaseClient,
    type DatabaseClientConnection,
} from "~/client/web/databases/database_client.js";
import {
    type ExecuteServerResult,
    tabToWorkerDatabaseRpcMethods,
    workerToTabDatabaseRpcMethods,
} from "~/client/web/databases/database_worker_rpc_methods.js";
import type {OpfsDirectoryHandle} from "~/client/web/databases/opfs.js";
import {WebWorkerRpc} from "~/client/web/helpers/workers/web_worker_rpc.js";
import {CancelledError} from "~/shared/error/error.js";
import type {Result} from "~/shared/helpers/control/result.js";
import {generateId} from "~/shared/id/id.js";
import type {
    DatabaseId,
    DatabaseMutationId,
    DatabaseReactiveQueryId,
} from "~/shared/id/types/id_types.js";
import type {SchemaSerializedValue, SchemaType} from "~/shared/schema/schema.js";
import type {Store} from "~/shared/store/store.js";
import {ValueStore} from "~/shared/store/value_store.js";

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

export type ReactiveQueryResult = Result<ReadonlyArray<unknown>, string>;

export interface ReactiveQueryHandle {
    readonly store: Store<ReactiveQueryResult>;
    unwatch(): void;
}

/**
 * Call signature exposed to consumers. Omits
 * `databaseId` from inputs since the manager
 * injects it automatically.
 */
type DatabaseConnectionCall = <K extends string & keyof typeof tabToWorkerDatabaseRpcMethods>(
    method: K,
    input: Omit<SchemaType<(typeof tabToWorkerDatabaseRpcMethods)[K]["inputSchema"]>, "databaseId">,
) => Promise<SchemaType<(typeof tabToWorkerDatabaseRpcMethods)[K]["outputSchema"]>>;

export interface DatabaseConnection {
    call: DatabaseConnectionCall;
    watchQuery(sql: string): Promise<ReactiveQueryHandle>;
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
 * ports forwarded from follower tabs. Delegates all
 * reactive query logic to {@link DatabaseClient}.
 */
export class DatabaseActiveTabWorker {
    private readonly clientPromises = new Map<string, Promise<DatabaseClient>>();
    private readonly queryToDatabase = new Map<DatabaseReactiveQueryId, DatabaseId>();

    constructor(private readonly dir: OpfsDirectoryHandle) {}

    private getOrCreateClient(
        databaseId: DatabaseId,
        conn: DatabaseClientConnection,
    ): Promise<DatabaseClient> {
        let promise = this.clientPromises.get(databaseId);
        if (!promise) {
            promise = (async () => {
                const dbDir = await this.dir.getDirectoryHandle(databaseId, {create: true});
                const client = await DatabaseClient.create(dbDir);
                try {
                    await client.ensureCacheIsUpToDate(conn);
                } catch {
                    // Validation failed (e.g. server unreachable).
                    // Proceed with potentially stale cache — the
                    // client will fall back to the server for
                    // missing pages on demand.
                }
                return client;
            })();
            this.clientPromises.set(databaseId, promise);
        }
        return promise;
    }

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
     * connected tab. The connection's `executeServer`
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
                execute: async input => {
                    const client = await this.getOrCreateClient(input.databaseId, conn);
                    const rows = (await client.execute(
                        conn,
                        input.sql,
                    )) as ReadonlyArray<SchemaSerializedValue>;
                    return {rows};
                },
                writePagesFromRealtime: async input => {
                    const client = await this.getOrCreateClient(input.databaseId, conn);
                    client.writePagesFromRealtime(input.pages, input.mutationId);
                    return {};
                },
                registerReactiveQuery: async input => {
                    const client = await this.getOrCreateClient(input.databaseId, conn);
                    this.queryToDatabase.set(input.queryId, input.databaseId);
                    const result = await client.registerReactiveQuery(
                        input.queryId,
                        input.sql,
                        conn,
                        updatedRows => {
                            void rpc.call("reactiveQueryUpdated", {
                                queryId: input.queryId,
                                rows: updatedRows as ReadonlyArray<SchemaSerializedValue>,
                            });
                        },
                        error => {
                            void rpc.call("reactiveQueryError", {
                                queryId: input.queryId,
                                message: error instanceof Error ? error.message : String(error),
                            });
                        },
                    );
                    if (result.ok) {
                        return {
                            rows: result.value as ReadonlyArray<SchemaSerializedValue>,
                            error: null,
                        };
                    }
                    const message =
                        result.error instanceof Error ? result.error.message : String(result.error);
                    return {rows: [], error: message};
                },
                unregisterReactiveQuery: async input => {
                    const dbId = this.queryToDatabase.get(input.queryId) ?? input.databaseId;
                    const client = await this.getOrCreateClient(dbId, conn);
                    client.unregisterReactiveQuery(input.queryId);
                    this.queryToDatabase.delete(input.queryId);
                    return {};
                },
            },
            send,
        });
        const conn: DatabaseClientConnection = {
            executeServer: async (sql, options) =>
                rpc.call("executeServer", {
                    sql,
                    allowWrites: options.allowWrites,
                    mutationId: options.mutationId,
                }),
            getPageLastModifiedTimes: async pageIndexes =>
                rpc.call("getPageLastModifiedTimes", {pageIndexes: [...pageIndexes]}),
            reportError: error => {
                void rpc.call("reportError", {
                    message: error instanceof Error ? error.message : String(error),
                });
            },
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
    private readonly watches = new Map<
        DatabaseReactiveQueryId,
        {sql: string; store: ValueStore<ReactiveQueryResult>}
    >();

    constructor(
        private readonly deps: {
            databaseId: DatabaseId;
            locks: ActiveTabLockManager;
            serviceWorker: ActiveTabServiceWorkerContainer;
            createWorker(): ActiveTabWorkerHandle;
            createMessageChannel(): {port1: ActiveTabPort; port2: ActiveTabPort};
            createBroadcastChannel(name: string): ActiveTabBroadcastChannel;
            addUnloadListener(callback: () => void): void;
            executeServer(
                sql: string,
                options: {allowWrites: boolean; mutationId: DatabaseMutationId},
            ): Promise<ExecuteServerResult>;
            getPageLastModifiedTimes(
                pageIndexes: ReadonlyArray<number>,
            ): Promise<{pageTimestampsByIndex: ReadonlyMap<number, number>}>;
            reportError?(message: string): void;
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
                this.callMethod(method, input)) as DatabaseConnectionCall,
            watchQuery: (sql: string) => this.watchQuery(sql),
            close: () => this.closeConnection(),
        };
    }

    // -- Call routing --------------------------------------------------------

    private callMethod(method: string, input: unknown): Promise<unknown> {
        if (this.closed) {
            return Promise.reject(new CancelledError("Connection closed"));
        }

        const tagged = {
            ...(input as Record<string, unknown>),
            databaseId: this.deps.databaseId,
        };

        if (this.raw === null || this.reconnecting !== null || this.promoting) {
            return new Promise((resolve, reject) => {
                this.callQueue.push({method, input: tagged, resolve, reject});
            });
        }

        const id = this.nextCallId++;
        const rpc = this.raw.rpc;

        return new Promise((resolve, reject) => {
            this.inflight.set(id, {method, input: tagged, resolve, reject});
            (rpc.call as (m: string, i: unknown) => Promise<unknown>)(method, tagged).then(
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

    // -- Reactive query watch ------------------------------------------------

    private async watchQuery(sql: string): Promise<ReactiveQueryHandle> {
        const queryId = generateId<DatabaseReactiveQueryId>();
        const store = new ValueStore<ReactiveQueryResult>({ok: true, value: []});

        this.watches.set(queryId, {sql, store});

        const result = (await this.callMethod("registerReactiveQuery", {
            queryId,
            sql,
        })) as {rows: ReadonlyArray<unknown>; error: string | null};
        if (result.error !== null) {
            store.set({ok: false, error: result.error});
        } else {
            store.set({ok: true, value: result.rows});
        }

        return {
            store,
            unwatch: () => {
                this.watches.delete(queryId);
                void this.callMethod("unregisterReactiveQuery", {queryId});
            },
        };
    }

    private async reRegisterWatches(): Promise<void> {
        for (const [queryId, watch] of this.watches) {
            const result = (await this.callMethod("registerReactiveQuery", {
                queryId,
                sql: watch.sql,
            })) as {rows: ReadonlyArray<unknown>; error: string | null};
            if (result.error === null) {
                watch.store.set({ok: true, value: result.rows});
            }
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

        await this.reRegisterWatches();
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
            await this.reRegisterWatches();
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

        this.watches.clear();
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
                executeServer: async input => {
                    const result = await this.deps.executeServer(input.sql, {
                        allowWrites: input.allowWrites,
                        mutationId: input.mutationId,
                    });
                    return {
                        rows: result.rows as ReadonlyArray<SchemaSerializedValue>,
                        readPages: result.readPages,
                    };
                },
                getPageLastModifiedTimes: async input =>
                    this.deps.getPageLastModifiedTimes(input.pageIndexes),
                reportError: async input => {
                    this.deps.reportError?.(input.message);
                    return {};
                },
                reactiveQueryUpdated: async input => {
                    const watch = this.watches.get(input.queryId);
                    if (watch) {
                        watch.store.set({ok: true, value: input.rows});
                    }
                    return {};
                },
                reactiveQueryError: async input => {
                    const watch = this.watches.get(input.queryId);
                    if (watch) {
                        watch.store.set({ok: false, error: input.message});
                    }
                    return {};
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
                executeServer: async input => {
                    const result = await this.deps.executeServer(input.sql, {
                        allowWrites: input.allowWrites,
                        mutationId: input.mutationId,
                    });
                    return {
                        rows: result.rows as ReadonlyArray<SchemaSerializedValue>,
                        readPages: result.readPages,
                    };
                },
                getPageLastModifiedTimes: async input =>
                    this.deps.getPageLastModifiedTimes(input.pageIndexes),
                reportError: async input => {
                    this.deps.reportError?.(input.message);
                    return {};
                },
                reactiveQueryUpdated: async input => {
                    const watch = this.watches.get(input.queryId);
                    if (watch) {
                        watch.store.set({ok: true, value: input.rows});
                    }
                    return {};
                },
                reactiveQueryError: async input => {
                    const watch = this.watches.get(input.queryId);
                    if (watch) {
                        watch.store.set({ok: false, error: input.message});
                    }
                    return {};
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
