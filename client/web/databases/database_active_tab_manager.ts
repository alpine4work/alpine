import {
    DatabaseClient,
    type DatabaseClientConnection,
} from "~/client/web/databases/database_client.js";
import {
    tabToWorkerDatabaseRpcMethods,
    workerToTabDatabaseRpcMethods,
} from "~/client/web/databases/database_worker_rpc_methods.js";
import type {OpfsDirectoryHandle} from "~/client/web/databases/opfs.js";
import {WebWorkerRpc} from "~/client/web/helpers/workers/web_worker_rpc.js";
import type {
    DatabaseActionInput,
    DatabaseActionName,
    DatabaseActionObject,
    DatabaseActionOutput,
    DatabaseActionResult,
} from "~/shared/databases/database_actions.js";
import type {
    DatabaseEnsureCacheIsUpToDateResult,
    DatabaseExecuteActionResponse,
    DatabasePageIndexes,
    DatabasePageTimestampsByIndex,
    DatabasePages,
} from "~/shared/databases/database_protocol_schemas.js";
import {CancelledError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import type {Result} from "~/shared/helpers/control/result.js";
import {generateId} from "~/shared/id/id.js";
import type {
    DatabaseGroupId,
    DatabaseMutationId,
    DatabaseReactiveActionId,
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

export type DatabaseReactiveActionResult<N extends DatabaseActionName> = Result<
    DatabaseActionOutput<N>,
    string
>;

export interface DatabaseReactiveActionHandle<N extends DatabaseActionName> {
    readonly store: Store<DatabaseReactiveActionResult<N>>;
    unwatch(): void;
}

/**
 * Call signature exposed to consumers. Omits
 * `databaseGroupId` from inputs since the manager
 * injects it automatically.
 */
type DatabaseConnectionCall = <K extends keyof typeof tabToWorkerDatabaseRpcMethods>(
    method: K,
    input: Omit<
        SchemaType<(typeof tabToWorkerDatabaseRpcMethods)[K]["inputSchema"]>,
        "databaseGroupId"
    >,
) => Promise<SchemaType<(typeof tabToWorkerDatabaseRpcMethods)[K]["outputSchema"]>>;

export interface DatabaseWorkerConnection {
    call: DatabaseConnectionCall;
    executeAction<N extends DatabaseActionName>(
        name: N,
        input: DatabaseActionInput<N>,
    ): Promise<DatabaseActionOutput<N>>;
    watchAction<N extends DatabaseActionName>(
        name: N,
        input: DatabaseActionInput<N>,
    ): Promise<DatabaseReactiveActionHandle<N>>;
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
 * reactive action logic to {@link DatabaseClient}.
 */
export class DatabaseActiveTabWorker {
    private readonly clientPromises = new Map<string, Promise<DatabaseClient>>();
    private readonly actionToDatabase = new Map<DatabaseReactiveActionId, DatabaseGroupId>();
    private readonly initialPagesByDatabase = new Map<DatabaseGroupId, DatabasePages>();

    constructor(private readonly dir: OpfsDirectoryHandle) {}

    private getOrCreateClient(
        databaseGroupId: DatabaseGroupId,
        conn: DatabaseClientConnection,
    ): Promise<DatabaseClient> {
        let promise = this.clientPromises.get(databaseGroupId);
        if (!promise) {
            promise = (async () => {
                const groupDir = await this.dir.getDirectoryHandle(databaseGroupId, {create: true});
                const client = await DatabaseClient.create(groupDir);

                const initialPages = this.initialPagesByDatabase.get(databaseGroupId);
                if (initialPages !== undefined) {
                    this.initialPagesByDatabase.delete(databaseGroupId);
                    await client.seedPages(initialPages);
                }

                try {
                    await client.ensureCacheIsUpToDate(conn);
                } catch {
                    // Validation failed (e.g. server unreachable).
                    // Proceed with potentially stale cache — the
                    // client will fall back to the server for
                    // missing pages on demand.
                }

                // Pre-fetch schema pages so optimistic mutations
                // can read metadata without hitting the server.
                // Best-effort — may fail if the local cache is
                // empty; pages will be fetched on demand.
                void client
                    .executeAction(conn, {
                        name: "ensureSchemaPagesLoaded",
                        input: {},
                    })
                    .catch(() => {});

                return client;
            })();
            this.clientPromises.set(databaseGroupId, promise);
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
     *
     * The RPC speaks per-table (matching the network
     * protocol); this method wraps the calls so the
     * single-table {@link DatabaseClient} sees only the
     * main table's pages.
     */
    private createConnection(send: (message: unknown) => void) {
        // conn is defined after rpc but handlers only run
        // asynchronously, so conn is always initialized by
        // the time a handler executes.
        const rpc: WorkerToTabRpc = new WebWorkerRpc({
            callMethods: workerToTabDatabaseRpcMethods,
            handleMethods: tabToWorkerDatabaseRpcMethods,
            handlers: {
                writeInitialPages: async input => {
                    if (this.clientPromises.has(input.databaseGroupId)) {
                        // eslint-disable-next-line no-console
                        console.warn(
                            "writeInitialPages called after database client was already created",
                        );
                    }
                    this.initialPagesByDatabase.set(input.databaseGroupId, input.pages);
                    return {};
                },
                executeAction: async input => {
                    const client = await this.getOrCreateClient(input.databaseGroupId, conn);
                    const result = await client.executeAction(conn, input.action);
                    return {
                        result: {name: input.action.name, output: result} as any,
                    };
                },
                writePageDiffsFromRealtime: async input => {
                    const client = await this.getOrCreateClient(input.databaseGroupId, conn);
                    client.writePageDiffsFromRealtime(input.pageDiffs, input.mutationId);
                    return {};
                },
                registerReactiveAction: async input => {
                    const client = await this.getOrCreateClient(input.databaseGroupId, conn);
                    this.actionToDatabase.set(input.id, input.databaseGroupId);
                    const result = await client.registerReactiveAction(
                        input.id,
                        input.action,
                        conn,
                        output => {
                            void rpc.call("reactiveActionUpdated", {
                                id: input.id,
                                result: {
                                    name: input.action.name,
                                    output,
                                } as DatabaseActionResult,
                            });
                        },
                        error => {
                            void rpc.call("reactiveActionError", {
                                id: input.id,
                                message: error instanceof Error ? error.message : String(error),
                            });
                        },
                    );
                    if (result.ok) {
                        return {
                            result: {
                                name: input.action.name,
                                output: result.value,
                            } as DatabaseActionResult,
                            error: null,
                        };
                    }
                    const message =
                        result.error instanceof Error ? result.error.message : String(result.error);
                    return {
                        result: {
                            name: input.action.name,
                            output: {},
                        } as DatabaseActionResult,
                        error: message,
                    };
                },
                unregisterReactiveAction: async input => {
                    const dbId = this.actionToDatabase.get(input.id) ?? input.databaseGroupId;
                    const client = await this.getOrCreateClient(dbId, conn);
                    client.unregisterReactiveAction(input.id);
                    this.actionToDatabase.delete(input.id);
                    return {};
                },
            },
            send,
        });
        const conn: DatabaseClientConnection = {
            executeActionServer: (action, options) =>
                rpc.call("executeActionServer", {
                    action,
                    mutationId: options.mutationId,
                    returnResult: options.returnResult ?? true,
                    returnPages: options.returnPages ?? true,
                }),
            ensureCacheIsUpToDate: pageTimestampsByIndex =>
                rpc.call("ensureCacheIsUpToDate", {pageTimestampsByIndex}),
            acknowledgePages: pageIndexes => {
                void rpc.call("acknowledgePages", {pageIndexes});
            },
            reportError: error => {
                void rpc.call("reportError", {
                    message: error instanceof Error ? error.message : String(error),
                });
            },
        };
        return {rpc, conn};
    }

    /**
     * Execute SQL with full permissions (including DDL)
     * on the worker's client. Creates the client if it
     * doesn't exist yet. Use for test schema setup only.
     */
    async executeLocallyForTests(databaseGroupId: DatabaseGroupId, sql: string): Promise<void> {
        assert(import.meta.jest, "executeLocallyForTests is test-only");
        let promise = this.clientPromises.get(databaseGroupId);
        if (!promise) {
            promise = (async () => {
                const groupDir = await this.dir.getDirectoryHandle(databaseGroupId, {create: true});
                return DatabaseClient.create(groupDir);
            })();
            this.clientPromises.set(databaseGroupId, promise);
        }
        const client = await promise;
        client.executeLocallyForTests(sql);
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
        DatabaseReactiveActionId,
        {
            actionObject: DatabaseActionObject;
            store: ValueStore<DatabaseReactiveActionResult<DatabaseActionName>>;
        }
    >();

    constructor(
        private readonly deps: {
            databaseGroupId: DatabaseGroupId;
            locks: ActiveTabLockManager;
            serviceWorker: ActiveTabServiceWorkerContainer;
            createWorker(): ActiveTabWorkerHandle;
            createMessageChannel(): {port1: ActiveTabPort; port2: ActiveTabPort};
            createBroadcastChannel(name: string): ActiveTabBroadcastChannel;
            addUnloadListener(callback: () => void): void;
            executeActionServer(
                action: DatabaseActionObject,
                options: {
                    mutationId: DatabaseMutationId;
                    returnResult?: boolean;
                    returnPages?: boolean;
                },
            ): Promise<DatabaseExecuteActionResponse>;
            ensureCacheIsUpToDate(
                pageTimestampsByIndex: DatabasePageTimestampsByIndex,
            ): Promise<DatabaseEnsureCacheIsUpToDateResult>;
            acknowledgePages(pageIndexes: DatabasePageIndexes): void;
            reportError?(message: string): void;
        },
    ) {}

    async connect(): Promise<DatabaseWorkerConnection> {
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

        const call = ((method: string, input: unknown) =>
            this.callMethod(method, input)) as DatabaseConnectionCall;

        return {
            call,
            async executeAction(name, input) {
                const response = await call("executeAction", {
                    action: {name, input} as DatabaseActionObject,
                });
                return response.result.output as any;
            },
            watchAction: (name, input) => this.watchAction({name, input} as DatabaseActionObject),
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
            databaseGroupId: this.deps.databaseGroupId,
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

    // -- Reactive action watch -----------------------------------------------

    private async watchAction(
        actionObject: DatabaseActionObject,
    ): Promise<DatabaseReactiveActionHandle<DatabaseActionName>> {
        const id = generateId<DatabaseReactiveActionId>();
        const store = new ValueStore<DatabaseReactiveActionResult<DatabaseActionName>>({
            ok: true,
            value: {},
        });

        this.watches.set(id, {actionObject, store});

        const result = (await this.callMethod("registerReactiveAction", {
            id,
            action: actionObject,
        })) as {result: DatabaseActionResult; error: string | null};
        if (result.error !== null) {
            store.set({ok: false, error: result.error});
        } else {
            store.set({ok: true, value: result.result.output});
        }

        return {
            store,
            unwatch: () => {
                this.watches.delete(id);
                void this.callMethod("unregisterReactiveAction", {id});
            },
        };
    }

    private async reRegisterWatches(): Promise<void> {
        for (const [id, watch] of this.watches) {
            const result = (await this.callMethod("registerReactiveAction", {
                id,
                action: watch.actionObject,
            })) as {result: DatabaseActionResult; error: string | null};
            if (result.error === null) {
                watch.store.set({ok: true, value: result.result.output});
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

        void this.deps.locks.request("alpine-db", {ifAvailable: false}, async () => {
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
            void this.deps.locks.request("alpine-db", {ifAvailable: true}, async lock => {
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
                executeActionServer: async input => {
                    const result = await this.deps.executeActionServer(input.action, {
                        mutationId: input.mutationId,
                        returnResult: input.returnResult,
                        returnPages: input.returnPages,
                    });
                    return {
                        result: result.result as SchemaSerializedValue as any,
                        readPages: result.readPages,
                    };
                },
                ensureCacheIsUpToDate: async input =>
                    this.deps.ensureCacheIsUpToDate(input.pageTimestampsByIndex),
                acknowledgePages: async input => {
                    this.deps.acknowledgePages(input.pageIndexes);
                    return {};
                },
                reportError: async input => {
                    this.deps.reportError?.(input.message);
                    return {};
                },
                reactiveActionUpdated: async input => {
                    const watch = this.watches.get(input.id);
                    if (watch) {
                        watch.store.set({ok: true, value: input.result.output});
                    }
                    return {};
                },
                reactiveActionError: async input => {
                    const watch = this.watches.get(input.id);
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
                executeActionServer: async input => {
                    const result = await this.deps.executeActionServer(input.action, {
                        mutationId: input.mutationId,
                        returnResult: input.returnResult,
                        returnPages: input.returnPages,
                    });
                    return {
                        result: result.result as SchemaSerializedValue as any,
                        readPages: result.readPages,
                    };
                },
                ensureCacheIsUpToDate: async input =>
                    this.deps.ensureCacheIsUpToDate(input.pageTimestampsByIndex),
                acknowledgePages: async input => {
                    this.deps.acknowledgePages(input.pageIndexes);
                    return {};
                },
                reportError: async input => {
                    this.deps.reportError?.(input.message);
                    return {};
                },
                reactiveActionUpdated: async input => {
                    const watch = this.watches.get(input.id);
                    if (watch) {
                        watch.store.set({ok: true, value: input.result.output});
                    }
                    return {};
                },
                reactiveActionError: async input => {
                    const watch = this.watches.get(input.id);
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
