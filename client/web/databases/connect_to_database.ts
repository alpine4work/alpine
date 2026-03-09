import {
    type ActiveTabBroadcastChannel,
    type ActiveTabPort,
    type ActiveTabWorkerHandle,
    DatabaseActiveTabManager,
    type DatabaseConnection,
} from "~/client/web/databases/database_active_tab_manager.js";
import type {ExecuteServerResult} from "~/client/web/databases/database_worker_rpc_methods.js";
import type {DatabaseId, DatabaseMutationId} from "~/shared/id/types/id_types.js";

export type {
    DatabaseConnection,
    ReactiveQueryHandle,
    ReactiveQueryResult,
} from "~/client/web/databases/database_active_tab_manager.js";

/**
 * Connect to the shared client-side SQLite database.
 * Handles multi-tab coordination transparently: one
 * tab becomes the leader (runs SQLite in a dedicated
 * worker), others proxy queries via MessagePort through
 * the ServiceWorker.
 */
export function connectToDatabase(options: {
    databaseId: DatabaseId;
    executeServer(
        sql: string,
        options: {allowWrites: boolean; mutationId: DatabaseMutationId},
    ): Promise<ExecuteServerResult>;
    reportError?(message: string): void;
}): Promise<DatabaseConnection> {
    const manager = new DatabaseActiveTabManager({
        databaseId: options.databaseId,
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
        executeServer: options.executeServer,
        reportError: options.reportError,
    });

    return manager.connect();
}
