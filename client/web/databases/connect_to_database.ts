import {
    type ActiveTabBroadcastChannel,
    type ActiveTabPort,
    type ActiveTabWorkerHandle,
    DatabaseActiveTabManager,
    type DatabaseWorkerConnection,
} from "~/client/web/databases/database_active_tab_manager.js";
import type {DatabaseActionObject} from "~/shared/databases/database_actions.js";
import type {
    DatabaseEnsureCacheIsUpToDateResult,
    DatabaseExecuteActionResponse,
    DatabasePageIndexes,
    DatabasePageVersionsByIndex,
    DatabasePages,
} from "~/shared/databases/database_protocol_schemas.js";
import {CancelledError} from "~/shared/error/error.js";
import type {DatabaseGroupId, DatabaseMutationId} from "~/shared/id/types/id_types.js";

export type {
    DatabaseWorkerConnection,
    DatabaseReactiveActionHandle,
    DatabaseReactiveActionResult,
} from "~/client/web/databases/database_active_tab_manager.js";

type ConnectOptions = {
    databaseGroupId: DatabaseGroupId;
    initialPages?: DatabasePages;
    executeActionServer(
        action: DatabaseActionObject,
        options: {
            mutationId: DatabaseMutationId;
            returnResult?: boolean;
            returnPages?: boolean;
        },
    ): Promise<DatabaseExecuteActionResponse>;
    ensureCacheIsUpToDate(
        pageVersionsByIndex: DatabasePageVersionsByIndex,
    ): Promise<DatabaseEnsureCacheIsUpToDateResult>;
    acknowledgePages(pageIndexes: DatabasePageIndexes): void;
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
 * Connect to the shared client-side SQLite database group. Handles multi-tab
 * coordination transparently: one tab becomes the leader (runs SQLite in a
 * dedicated worker), others proxy queries via MessagePort through the
 * ServiceWorker.
 */
async function connectToDatabaseGroup(options: ConnectOptions): Promise<DatabaseWorkerConnection> {
    const manager = new DatabaseActiveTabManager({
        databaseGroupId: options.databaseGroupId,
        locks: navigator.locks,
        serviceWorker: {
            ready: navigator.serviceWorker.ready.then(reg => ({
                active: reg.active
                    ? {
                          postMessage(data: unknown, transfer?: Array<ActiveTabPort>) {
                              reg.active!.postMessage(data, transfer as Array<Transferable>);
                          },
                      }
                    : null,
            })),
            addEventListener(_type, handler) {
                navigator.serviceWorker.addEventListener("message", event => {
                    handler({
                        data: event.data,
                        ports: [...event.ports] as unknown as Array<ActiveTabPort>,
                    });
                });
            },
        },
        createWorker(): ActiveTabWorkerHandle {
            const worker = new Worker(new URL("./database_worker.js", import.meta.url), {
                type: "module",
            });

            const ready = new Promise<void>(resolve => {
                worker.onmessage = event => {
                    if (event.data?.type === "ready") {
                        resolve();
                    }
                };
            });

            return {
                ready,
                postMessage(data: unknown, transfer?: Array<ActiveTabPort>) {
                    worker.postMessage(data, transfer as Array<Transferable>);
                },
                get onmessage() {
                    return null;
                },
                set onmessage(
                    handler: ((event: {data: unknown; ports: Array<ActiveTabPort>}) => void) | null,
                ) {
                    worker.onmessage = handler
                        ? event =>
                              handler({
                                  data: event.data,
                                  ports: [...event.ports] as unknown as Array<ActiveTabPort>,
                              })
                        : null;
                },
                start() {},
                close() {},
                terminate() {
                    worker.terminate();
                },
            };
        },
        createMessageChannel() {
            const channel = new MessageChannel();
            return {
                port1: channel.port1 as unknown as ActiveTabPort,
                port2: channel.port2 as unknown as ActiveTabPort,
            };
        },
        createBroadcastChannel(name: string) {
            return new BroadcastChannel(name) as unknown as ActiveTabBroadcastChannel;
        },
        addUnloadListener(callback: () => void) {
            window.addEventListener("beforeunload", callback);
        },
        executeActionServer: options.executeActionServer,
        ensureCacheIsUpToDate: options.ensureCacheIsUpToDate,
        acknowledgePages: options.acknowledgePages,
        reportError: options.reportError,
    });

    const connection = await manager.connect();
    if (options.initialPages !== undefined && options.initialPages.size > 0) {
        void connection.call("writeInitialPages", {pages: options.initialPages});
    }
    return connection;
}
