import {
    DatabaseClient,
    type DatabaseClientConnection,
} from "~/client/web/databases/worker/database_client.js";
import {
    TabToWorkerDatabaseRpcMethods,
    WorkerToTabDatabaseRpcMethods,
} from "~/client/web/databases/worker/database_worker_rpc_methods.js";
import type {OpfsDirectoryHandle} from "~/client/web/databases/worker/opfs.js";
import {
    WebSocketClient,
    type WebSocketClientProcedures,
    type WebSocketClientState,
} from "~/client/web/web_socket/web_socket_client.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import type {DatabaseActionResult} from "~/shared/databases/database_actions.js";
import {
    type DatabaseRealtimeEvent,
    DatabaseRealtimeProtocol,
} from "~/shared/databases/database_realtime_protocol.js";
import type {SqliteMigration} from "~/shared/databases/sqlite_migrations.js";
import {isTransientError} from "~/shared/error/is_transient_error.open_source.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.open_source.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import type {
    DatabaseGroupId,
    DatabaseReactiveActionId,
} from "~/shared/id/types/id_types.open_source.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.open_source.js";
import type {WebSocketProtocolProceduresType} from "~/shared/web_socket/web_socket_protocol.js";

type DatabaseConnectionManagerContext = Context<{tracer: TracerContextModule}>;

interface DatabaseConnectionManagerCreateSocketOptions {
    webSocketUrl: string;
    context: DatabaseConnectionManagerContext;
}

interface DatabaseConnectionManagerSocketState {
    getSnapshot(): WebSocketClientState;
    subscribe(listener: () => void): () => void;
}

export interface DatabaseConnectionManagerSocket {
    readonly procedures: WebSocketClientProcedures<
        WebSocketProtocolProceduresType<typeof DatabaseRealtimeProtocol>
    >;
    readonly state: DatabaseConnectionManagerSocketState;
    subscribeToEvents(handler: (event: DatabaseRealtimeEvent) => void): () => void;
    connect(): void;
    reconnect(): void;
}

export interface DatabaseConnectionManagerTabConnection {
    readonly reactiveActionUpdated: (
        input: WorkerToTabDatabaseRpcMethods["reactiveActionUpdated"]["input"],
    ) => Promise<void>;
    readonly reactiveActionError: (
        input: WorkerToTabDatabaseRpcMethods["reactiveActionError"]["input"],
    ) => Promise<void>;
    readonly reportError: (
        input: WorkerToTabDatabaseRpcMethods["reportError"]["input"],
    ) => Promise<void>;
}

interface DatabaseConnectionManagerDatabaseGroupState {
    clientPromise?: Promise<DatabaseClient>;
    webSocketUrl?: string;
    realtimeConnection?: DatabaseClientConnection;
}

/**
 * Runs in the dedicated worker (the unique worker for key `alpine-databases`).
 * Serves database RPC to every connected tab via {@link UniqueWorkerHost} and
 * delegates all reactive action logic to {@link DatabaseClient}.
 *
 * `dir` may be a promise so the worker entry can attach the host synchronously
 * (before any connection ports arrive) while OPFS initializes in the background.
 */
export class DatabaseConnectionManager {
    private readonly databaseGroups = new Map<
        DatabaseGroupId,
        DatabaseConnectionManagerDatabaseGroupState
    >();
    private readonly reactiveActions = new Map<
        DatabaseReactiveActionId,
        {
            databaseGroupId: DatabaseGroupId;
            connection: DatabaseConnectionManagerTabConnection;
        }
    >();

    constructor(
        private readonly dir: OpfsDirectoryHandle | Promise<OpfsDirectoryHandle>,
        private readonly getConnections: () => ReadonlyArray<DatabaseConnectionManagerTabConnection>,
        private readonly deps: {
            readonly createSocket: (
                options: DatabaseConnectionManagerCreateSocketOptions,
            ) => DatabaseConnectionManagerSocket;
        } = {createSocket: createDatabaseConnectionManagerSocket},
    ) {}

    connectDatabaseGroup(input: TabToWorkerDatabaseRpcMethods["connectDatabaseGroup"]["input"]) {
        const state = this.getOrCreateDatabaseGroupState(input.databaseGroupId);
        state.webSocketUrl = input.webSocketUrl;
        this.getOrCreateRealtimeConnection(input.databaseGroupId);
        return {};
    }

    async executeAction(input: TabToWorkerDatabaseRpcMethods["executeAction"]["input"]) {
        const client = await this.getOrCreateClient(input.databaseGroupId);
        const result = await client.executeAction(
            this.getOrCreateRealtimeConnection(input.databaseGroupId),
            input.action,
        );
        return {
            result: {name: input.action.name, output: result} as any,
        };
    }

    async registerReactiveAction(
        input: TabToWorkerDatabaseRpcMethods["registerReactiveAction"]["input"],
        connection: DatabaseConnectionManagerTabConnection,
    ) {
        const client = await this.getOrCreateClient(input.databaseGroupId);
        this.reactiveActions.set(input.id, {databaseGroupId: input.databaseGroupId, connection});
        const result = await client.registerReactiveAction(
            input.id,
            input.action,
            this.getOrCreateRealtimeConnection(input.databaseGroupId),
            output => {
                void connection.reactiveActionUpdated({
                    id: input.id,
                    result: {
                        name: input.action.name,
                        output,
                    } as DatabaseActionResult,
                });
            },
            error => {
                void connection.reactiveActionError({
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
        const message = result.error instanceof Error ? result.error.message : String(result.error);
        return {
            result: {
                name: input.action.name,
                output: {},
            } as DatabaseActionResult,
            error: message,
        };
    }

    async unregisterReactiveAction({
        id,
        databaseGroupId,
    }: TabToWorkerDatabaseRpcMethods["unregisterReactiveAction"]["input"]): Promise<void> {
        const dbId = this.reactiveActions.get(id)?.databaseGroupId ?? databaseGroupId;
        this.reactiveActions.delete(id);
        const client = await this.getOrCreateClient(dbId);
        client.unregisterReactiveAction(id);
    }

    disconnectClient(connection: DatabaseConnectionManagerTabConnection) {
        // Drop reactive actions registered by the disconnected tab so the client stops
        // re-executing queries nobody is watching.
        for (const [id, action] of this.reactiveActions) {
            if (action.connection === connection) {
                void this.unregisterReactiveAction({
                    id,
                    databaseGroupId: action.databaseGroupId,
                });
            }
        }
    }

    private getOrCreateDatabaseGroupState(
        databaseGroupId: DatabaseGroupId,
    ): DatabaseConnectionManagerDatabaseGroupState {
        let state = this.databaseGroups.get(databaseGroupId);
        if (state === undefined) {
            state = {};
            this.databaseGroups.set(databaseGroupId, state);
        }
        return state;
    }

    private getOrCreateClient(databaseGroupId: DatabaseGroupId): Promise<DatabaseClient> {
        const state = this.getOrCreateDatabaseGroupState(databaseGroupId);
        let promise = state.clientPromise;
        if (!promise) {
            const created = (async () => {
                const dir = await this.dir;
                const groupDir = await dir.getDirectoryHandle(databaseGroupId, {create: true});
                const client = await DatabaseClient.create(groupDir);
                return client;
            })();
            // Evict on failure so the next call re-attempts the cold-open rather than
            // replaying the cached rejection forever. The identity guard avoids clobbering a
            // newer attempt if this one rejects after eviction.
            created.catch(() => {
                if (state.clientPromise === created) {
                    state.clientPromise = undefined;
                }
            });
            state.clientPromise = created;
            promise = created;
        }
        return promise;
    }

    private getOrCreateRealtimeConnection(
        databaseGroupId: DatabaseGroupId,
    ): DatabaseClientConnection {
        const state = this.getOrCreateDatabaseGroupState(databaseGroupId);
        let connection = state.realtimeConnection;
        if (connection === undefined) {
            const webSocketUrl =
                state.webSocketUrl ?? (import.meta.jest ? "ws://test.invalid" : undefined);
            assert(
                webSocketUrl !== undefined,
                `Database group ${databaseGroupId} was used before connectDatabaseGroup`,
            );

            const tracer = TracerRoot.new({
                serviceName: "AppClient",
                jsHost: "Web",
                untrusted: true,
                clock: unsynchronizedSystemClock,
                sendEvent: () => {},
            });
            const context = Context.new({
                tracer: new TracerContextModule(tracer),
            });
            const client = this.deps.createSocket({
                webSocketUrl,
                context,
            });

            client.subscribeToEvents(event => this.handleRealtimeEvent(databaseGroupId, event));
            let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
            let lastReportedState: WebSocketClientState | null = null;

            function scheduleReconnect() {
                if (reconnectTimeout !== null) return;
                reconnectTimeout = setTimeout(() => {
                    reconnectTimeout = null;
                    client.reconnect();
                }, 2500);
            }

            let wasConnected = false;
            client.state.subscribe(() => {
                const state = client.state.getSnapshot();

                // Prime cached-table registration on every (re)connect so a warm OPFS cache serves
                // reads locally: on the initial connect it registers what's cached, and after a
                // reconnect it re-registers to catch up on realtime events broadcast (and lost)
                // while the socket was down. Actions await the same memoized promise (see
                // `DatabaseClient.ensureCachedTablesRegistered`), so this only primes it.
                if (state.isConnected && !wasConnected) {
                    this.withExistingClient(databaseGroupId, client =>
                        client.ensureCachedTablesRegistered(
                            this.getOrCreateRealtimeConnection(databaseGroupId),
                        ),
                    );
                } else if (!state.isConnected && wasConnected) {
                    this.withExistingClient(databaseGroupId, client =>
                        client.beginDisconnectedConnectionEpoch(),
                    );
                }
                wasConnected = state.isConnected;

                if (!state.hasError) return;
                if (state !== lastReportedState) {
                    this.reportError(state.error);
                    lastReportedState = state;
                }
                scheduleReconnect();
            });

            client.connect();

            connection = {
                executeActionServer: (action, executeOptions) =>
                    client.procedures.executeAction({
                        action,
                        mutationId: executeOptions.mutationId,
                        returnResult: executeOptions.returnResult ?? true,
                        returnPages: executeOptions.returnPages ?? true,
                        registerTables: executeOptions.registerTables,
                    }),
                registerTables: tables => {
                    // Registration only reconciles subscriptions and cached snapshots, so unlike
                    // action mutations it is safe to retry after a transient error.
                    let reportedTransientError = false;
                    return retryWithExponentialBackoff(async retry => {
                        try {
                            return await client.procedures.registerTables({tables});
                        } catch (error) {
                            if (isTransientError(error)) {
                                if (!reportedTransientError) {
                                    this.reportError(error);
                                    reportedTransientError = true;
                                }
                                retry(error);
                            }
                            throw error;
                        }
                    });
                },
                reportError: error => this.reportError(error),
            };
            state.realtimeConnection = connection;
        }
        return connection;
    }

    private handleRealtimeEvent(databaseGroupId: DatabaseGroupId, event: DatabaseRealtimeEvent) {
        switch (event.type) {
            case "PagesChanged": {
                this.withExistingClient(databaseGroupId, client =>
                    client.writePageDiffsFromRealtime(event.pageDiffs, event.mutationId),
                );
                break;
            }
            case "TableMetadataChanged": {
                // The worker only consumes the access-map delta; the metadata events themselves
                // (names, policies) are handled by the route component's own subscription.
                if (event.tableAccess.size === 0) break;
                this.withExistingClient(databaseGroupId, client =>
                    client.applyTableAccessLevels(event.tableAccess),
                );
                break;
            }
        }
    }

    private withExistingClient(
        databaseGroupId: DatabaseGroupId,
        fn: (client: DatabaseClient) => void | Promise<void>,
    ): void {
        const clientPromise = this.databaseGroups.get(databaseGroupId)?.clientPromise;
        if (clientPromise === undefined) return;
        // `.catch` also captures synchronous errors thrown by `fn`, such as an invalid
        // realtime mutation-confirmation order.
        clientPromise.then(fn).catch(error => this.reportError(error));
    }

    // Worker-owned errors (e.g. from the realtime connection) are broadcast to every
    // connected tab.
    private reportError(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        for (const connection of this.getConnections()) {
            void connection.reportError({message});
        }
    }

    /**
     * Execute SQL with full permissions (including DDL) on the worker's client.
     * Creates the client if it doesn't exist yet. Writes land in the optimistic
     * overlay; pair with {@link commitOptimisticPagesForTests} to materialize them on
     * disk. Use for test schema setup only.
     */
    async executeLocallyForTests(
        databaseGroupId: DatabaseGroupId,
        migration: SqliteMigration,
    ): Promise<void> {
        assert(import.meta.jest, "executeLocallyForTests is test-only");
        const client = await this.getOrCreateClient(databaseGroupId);
        client.executeLocallyForTests(migration);
    }

    /**
     * Drain the optimistic overlay onto disk for the named database group. Test-only
     * counterpart to {@link executeLocallyForTests}.
     */
    async commitOptimisticPagesForTests(databaseGroupId: DatabaseGroupId): Promise<void> {
        assert(import.meta.jest, "commitOptimisticPagesForTests is test-only");
        const client = await this.getOrCreateClient(databaseGroupId);
        client.commitOptimisticPagesForTests();
    }
}

function createDatabaseConnectionManagerSocket({
    context,
    webSocketUrl,
}: DatabaseConnectionManagerCreateSocketOptions): DatabaseConnectionManagerSocket {
    return new WebSocketClient(
        () => context,
        "DatabaseGroupService",
        DatabaseRealtimeProtocol,
        webSocketUrl,
    );
}
