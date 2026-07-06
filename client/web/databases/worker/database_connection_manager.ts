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
import type {DatabasePages} from "~/shared/databases/database_protocol_schemas.js";
import {
    type DatabaseRealtimeEvent,
    DatabaseRealtimeProtocol,
} from "~/shared/databases/database_realtime_protocol.js";
import type {SqliteMigration} from "~/shared/databases/sqlite_migrations.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import type {DatabaseGroupId, DatabaseReactiveActionId} from "~/shared/id/types/id_types.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";
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
    disconnect(): Promise<void>;
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
    realtimeConnectionOptions?: {readonly webSocketUrl: string};
    realtimeConnection?: DatabaseClientConnection;
    initialPages?: DatabasePages;
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
    private readonly actionToDatabase = new Map<DatabaseReactiveActionId, DatabaseGroupId>();
    private readonly actionConnections = new Map<
        DatabaseReactiveActionId,
        DatabaseConnectionManagerTabConnection
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

    async connectDatabaseGroup(
        input: TabToWorkerDatabaseRpcMethods["connectDatabaseGroup"]["input"],
    ) {
        const state = this.getOrCreateDatabaseGroupState(input.databaseGroupId);
        state.realtimeConnectionOptions = {
            webSocketUrl: input.webSocketUrl,
        };
        if (input.pages.size > 0) {
            if (state.clientPromise !== undefined) {
                // The client already booted, so it won't consume `state.initialPages` anymore.
                // Apply the pages directly.
                const client = await state.clientPromise;
                await client.writeLoaderPages(input.pages);
            } else {
                state.initialPages = input.pages;
            }
        }
        this.getOrCreateRealtimeConnection(input.databaseGroupId);
        return {};
    }

    async writeInitialPages(input: TabToWorkerDatabaseRpcMethods["writeInitialPages"]["input"]) {
        const state = this.getOrCreateDatabaseGroupState(input.databaseGroupId);
        if (state.clientPromise !== undefined) {
            // The client already booted, so it won't consume `state.initialPages` anymore.
            // Apply the pages directly — they may contain tables (e.g. a freshly created one)
            // the replica hasn't received over realtime yet.
            const client = await state.clientPromise;
            await client.writeLoaderPages(input.pages);
        } else {
            state.initialPages = input.pages;
        }
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

    async writePageDiffsFromRealtime(
        input: TabToWorkerDatabaseRpcMethods["writePageDiffsFromRealtime"]["input"],
    ) {
        const client = await this.getOrCreateClient(input.databaseGroupId);
        client.writePageDiffsFromRealtime(input.pageDiffs, input.mutationId);
    }

    async registerReactiveAction(
        input: TabToWorkerDatabaseRpcMethods["registerReactiveAction"]["input"],
        connection: DatabaseConnectionManagerTabConnection,
    ) {
        const client = await this.getOrCreateClient(input.databaseGroupId);
        this.actionToDatabase.set(input.id, input.databaseGroupId);
        this.actionConnections.set(input.id, connection);
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
        const dbId = this.actionToDatabase.get(id) ?? databaseGroupId;
        this.actionToDatabase.delete(id);
        this.actionConnections.delete(id);
        if (dbId === undefined) return;
        const client = await this.getOrCreateClient(dbId);
        client.unregisterReactiveAction(id);
    }

    disconnectClient(connection: DatabaseConnectionManagerTabConnection) {
        // Drop reactive actions registered by the disconnected tab so the client stops
        // re-executing queries nobody is watching.
        for (const [id, actionConnection] of this.actionConnections) {
            if (actionConnection === connection) {
                void this.unregisterReactiveAction({
                    id,
                    databaseGroupId: this.actionToDatabase.get(id)!,
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
                try {
                    if (state.initialPages !== undefined) {
                        const {initialPages} = state;
                        state.initialPages = undefined;
                        await client.seedPages(initialPages);
                    }

                    // We're an always-online app: OPFS is just a cache, so any cold-open failure
                    // (server unreachable, cache validation) is meant to bubble up as "couldn't
                    // connect to the database".
                    await client.ensureCacheIsUpToDate(
                        this.getOrCreateRealtimeConnection(databaseGroupId),
                    );

                    return client;
                } catch (error) {
                    // The client opened its OPFS sync-access handles before failing; close it so the
                    // eviction below leaves the next open free of OPFS's exclusive handle lock.
                    client.close();
                    throw error;
                }
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
            const options =
                state.realtimeConnectionOptions ??
                (import.meta.jest ? {webSocketUrl: "ws://test.invalid"} : undefined);
            assert(
                options !== undefined,
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
                webSocketUrl: options.webSocketUrl,
                context,
            });

            const unsubscribeFromEvents = client.subscribeToEvents(event =>
                this.handleRealtimeEvent(databaseGroupId, event),
            );
            let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
            let lastReportedState: WebSocketClientState | null = null;
            let closed = false;

            function scheduleReconnect() {
                if (closed || reconnectTimeout !== null) return;
                reconnectTimeout = setTimeout(() => {
                    reconnectTimeout = null;
                    if (!closed) client.reconnect();
                }, 2500);
            }

            const unsubscribeFromState = client.state.subscribe(() => {
                const state = client.state.getSnapshot();
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
                    }),
                ensureCacheIsUpToDate: pageVersionsByIndex =>
                    client.procedures.ensureCacheIsUpToDate({pageVersionsByIndex}),
                acknowledgePages: pageIndexes => {
                    void client.procedures.acknowledgePages({pageIndexes});
                },
                reportError: error => this.reportError(error),
                close() {
                    closed = true;
                    if (reconnectTimeout !== null) {
                        clearTimeout(reconnectTimeout);
                        reconnectTimeout = null;
                    }
                    unsubscribeFromEvents();
                    unsubscribeFromState();
                    if (!client.state.getSnapshot().isDisconnected) {
                        void client.disconnect();
                    }
                },
            };
            state.realtimeConnection = connection;
        }
        return connection;
    }

    private handleRealtimeEvent(databaseGroupId: DatabaseGroupId, event: DatabaseRealtimeEvent) {
        switch (event.type) {
            case "PagesChanged": {
                const clientPromise = this.databaseGroups.get(databaseGroupId)?.clientPromise;
                if (clientPromise === undefined) return;
                clientPromise.then(
                    client => {
                        client.writePageDiffsFromRealtime(event.pageDiffs, event.mutationId);
                    },
                    error => this.reportError(error),
                );
                break;
            }
        }
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
        const client = await this.getOrCreateClientForTests(databaseGroupId);
        client.executeLocallyForTests(migration);
    }

    /**
     * Drain the optimistic overlay onto disk for the named database group. Test-only
     * counterpart to {@link executeLocallyForTests}.
     */
    async commitOptimisticPagesForTests(databaseGroupId: DatabaseGroupId): Promise<void> {
        assert(import.meta.jest, "commitOptimisticPagesForTests is test-only");
        const client = await this.getOrCreateClientForTests(databaseGroupId);
        client.commitOptimisticPagesForTests();
    }

    private async getOrCreateClientForTests(
        databaseGroupId: DatabaseGroupId,
    ): Promise<DatabaseClient> {
        const state = this.getOrCreateDatabaseGroupState(databaseGroupId);
        let promise = state.clientPromise;
        if (!promise) {
            promise = (async () => {
                const dir = await this.dir;
                const groupDir = await dir.getDirectoryHandle(databaseGroupId, {create: true});
                return await DatabaseClient.create(groupDir);
            })();
            state.clientPromise = promise;
        }
        return await promise;
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
