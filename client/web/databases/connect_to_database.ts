import {
    tabToWorkerDatabaseRpcMethods,
    workerToTabDatabaseRpcMethods,
} from "~/client/web/databases/worker/database_worker_rpc_methods.js";
import {UniqueWorkerClient} from "~/client/web/helpers/workers/unique_worker_client.js";
import type {
    DatabaseActionInput,
    DatabaseActionName,
    DatabaseActionObject,
    DatabaseActionOutput,
    DatabaseActionResult,
} from "~/shared/databases/database_actions.js";
import {CancelledError} from "~/shared/error/error.open_source.js";
import type {Result} from "~/shared/helpers/control/result.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import type {
    DatabaseGroupId,
    DatabaseReactiveActionId,
} from "~/shared/id/types/id_types.open_source.js";
import type {SchemaType} from "~/shared/schema/schema.open_source.js";
import type {Store} from "~/shared/store/store.js";
import {ValueStore} from "~/shared/store/value_store.js";

export type DatabaseReactiveActionResult<N extends DatabaseActionName> = Result<
    DatabaseActionOutput<N>,
    string
>;

export interface DatabaseReactiveActionHandle<N extends DatabaseActionName> {
    readonly store: Store<DatabaseReactiveActionResult<N>>;
    unwatch(): void;
}

/**
 * Call signature exposed to consumers. Omits `databaseGroupId` from inputs since
 * the connection injects it automatically.
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

/**
 * The unique worker key shared by all database-group connections. One dedicated
 * worker per origin serves every database group. Exported for tests, which
 * simulate a leader tab crash by force-releasing this key's Web Lock.
 */
export const databaseUniqueWorkerKey = "alpine-databases";

type ConnectOptions = {
    databaseGroupId: DatabaseGroupId;
    webSocketUrl: string;
    reportError?(message: string): void;
};

/**
 * Creates a database-group connection synchronously. The returned `connection`
 * queues all calls until `connect()` is called, making it safe for SSR where the
 * actual worker connection only happens client-side.
 */
export function createDatabaseGroupConnection(): {
    connection: DatabaseWorkerConnection;
    connect(options: ConnectOptions): Promise<void>;
} {
    let real: DatabaseWorkerConnection | null = null;
    let closed = false;
    const pending: Array<{
        resolve: (value: unknown) => void;
        reject: (reason: unknown) => void;
        fn: (conn: DatabaseWorkerConnection) => Promise<unknown>;
    }> = [];

    function rejectAllPending() {
        for (const entry of pending.splice(0)) {
            entry.reject(new CancelledError("Connection closed before connect"));
        }
    }

    function enqueue<T>(fn: (conn: DatabaseWorkerConnection) => Promise<T>): Promise<T> {
        if (closed) return Promise.reject(new CancelledError("Connection closed"));
        if (real != null) return fn(real);
        return new Promise<T>((resolve, reject) => {
            pending.push({
                resolve: resolve as (value: unknown) => void,
                reject,
                fn,
            });
        });
    }

    function flush(conn: DatabaseWorkerConnection) {
        for (const entry of pending.splice(0)) {
            entry.fn(conn).then(entry.resolve, entry.reject);
        }
    }

    const connection: DatabaseWorkerConnection = {
        call(...args) {
            return enqueue(conn => conn.call(...args));
        },
        executeAction(...args) {
            return enqueue(conn => conn.executeAction(...args));
        },
        watchAction(...args) {
            return enqueue(conn => conn.watchAction(...args));
        },
        close() {
            closed = true;
            rejectAllPending();
            real?.close();
        },
    };

    async function connect(options: ConnectOptions): Promise<void> {
        // Reset so the connection can be re-used after a close/reconnect cycle (e.g. React
        // strict-mode effect cleanup then re-run).
        closed = false;
        real = null;

        const realConn = await connectToDatabaseGroup(options);
        if (closed) {
            realConn.close();
            return;
        }
        real = realConn;
        flush(realConn);
    }

    return {connection, connect};
}

/**
 * Connect to the shared client-side SQLite database group. Multi-tab coordination
 * is handled by {@link UniqueWorkerClient}: one tab runs SQLite in a dedicated
 * worker, all others talk to it over relayed MessagePorts, and the connection
 * transparently survives the leader tab going away.
 *
 * During a leader failover, calls that were already in flight reject with
 * `UnavailableError` — they may or may not have executed, and are never replayed.
 * Reactive-action watches are re-registered automatically.
 */
async function connectToDatabaseGroup(options: ConnectOptions): Promise<DatabaseWorkerConnection> {
    const {databaseGroupId} = options;

    const watches = new Map<
        DatabaseReactiveActionId,
        {
            actionObject: DatabaseActionObject;
            store: ValueStore<DatabaseReactiveActionResult<DatabaseActionName>>;
        }
    >();

    const client: UniqueWorkerClient<
        typeof tabToWorkerDatabaseRpcMethods,
        typeof workerToTabDatabaseRpcMethods
    > = new UniqueWorkerClient({
        key: databaseUniqueWorkerKey,
        createWorker: () =>
            new Worker(new URL("./worker/database_worker.js", import.meta.url), {type: "module"}),
        workerMethods: tabToWorkerDatabaseRpcMethods,
        tabMethods: workerToTabDatabaseRpcMethods,
        handlers: {
            reportError: async input => {
                options.reportError?.(input.message);
                return {};
            },
            reactiveActionUpdated: async input => {
                const watch = watches.get(input.id);
                if (watch) {
                    watch.store.set({ok: true, value: input.result.output});
                }
                return {};
            },
            reactiveActionError: async input => {
                const watch = watches.get(input.id);
                if (watch) {
                    watch.store.set({ok: false, error: input.message});
                }
                return {};
            },
        },
        onReconnect: async () => {
            // We're talking to a fresh worker (either our own after promotion, or a new
            // leader's): re-establish the group connection and re-register every watch before
            // queued calls flush.
            await call("connectDatabaseGroup", {
                webSocketUrl: options.webSocketUrl,
            });
            for (const [id, watch] of watches) {
                const result = await call("registerReactiveAction", {
                    id,
                    action: watch.actionObject,
                });
                if (result.error === null) {
                    watch.store.set({ok: true, value: result.result.output});
                }
            }
        },
        onFailed: error => options.reportError?.(error.message),
        onOutdated: reloadForNewAlpineVersion,
    });

    const call = ((method, input) =>
        client.call(method, {...input, databaseGroupId} as any)) as DatabaseConnectionCall;

    async function watchAction(
        actionObject: DatabaseActionObject,
    ): Promise<DatabaseReactiveActionHandle<DatabaseActionName>> {
        const id = generateId<DatabaseReactiveActionId>();
        const store = new ValueStore<DatabaseReactiveActionResult<DatabaseActionName>>({
            ok: true,
            value: {},
        });

        watches.set(id, {actionObject, store});

        const result = (await call("registerReactiveAction", {id, action: actionObject})) as {
            result: DatabaseActionResult;
            error: string | null;
        };
        if (result.error !== null) {
            store.set({ok: false, error: result.error});
        } else {
            store.set({ok: true, value: result.result.output});
        }

        return {
            store,
            unwatch: () => {
                watches.delete(id);
                void call("unregisterReactiveAction", {id});
            },
        };
    }

    await client.whenConnected();
    await call("connectDatabaseGroup", {
        webSocketUrl: options.webSocketUrl,
    });

    return {
        call,
        async executeAction(name, input) {
            const response = await call("executeAction", {
                action: {name, input} as DatabaseActionObject,
            });
            return response.result.output as any;
        },
        watchAction: (name, input) => watchAction({name, input} as DatabaseActionObject),
        close: () => client.close(),
    };
}

/**
 * A newer Alpine version started in another tab; this tab is running stale code
 * and its database calls would hang against a leader that no longer serves it.
 * Reload to pick up the new bundle.
 */
function reloadForNewAlpineVersion(): void {
    // Guard against reload loops in case a stale bundle keeps being served (e.g.
    // aggressively cached HTML): at most one outdated-triggered reload per tab per 10
    // seconds.
    const guardKey = "alpine-databases-outdated-reload";
    const lastReload = Number(window.sessionStorage.getItem(guardKey) ?? 0);
    if (Date.now() - lastReload < 10_000) return;
    window.sessionStorage.setItem(guardKey, String(Date.now()));
    window.location.reload();
}
