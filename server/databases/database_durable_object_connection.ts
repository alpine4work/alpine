import {
    WorkerSessionActionContext,
    WorkerSessionActionContextModules,
} from "~/server/cloudflare/context/worker_action_context.js";
import {WorkerProcessContext} from "~/server/cloudflare/context/worker_process_context.js";
import {BrowserPageTracker} from "~/server/databases/browser_page_tracker.js";
import {buildDatabasePageDiffs} from "~/server/databases/build_database_page_diffs.js";
import {DatabaseDurableObjectStorage} from "~/server/databases/database_durable_object_storage.js";
import {DatabaseServer} from "~/server/databases/database_server.js";
import {WebSocketConnectionProcedures} from "~/server/web_socket/web_socket_server.js";
import {databaseActions} from "~/shared/databases/database_actions.js";
import type {
    DatabasePageDiffs,
    DatabaseTablePages,
} from "~/shared/databases/database_protocol_schemas.js";
import {
    DatabaseRealtimeEvent,
    DatabaseRealtimeProtocol,
} from "~/shared/databases/database_realtime_protocol.js";
import {cacheUpdateStalePageLimit, sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import type {RynamoEventStub} from "~/shared/dynamo/rynamo_types.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import type {
    BrowserId,
    DatabaseGroupId,
    DatabaseMutationId,
    DatabaseTableId,
    WebSocketConnectionId,
} from "~/shared/id/types/id_types.js";
import {
    authorizeDatabaseGroupAccess,
    getDatabaseTableMetadataRealtimeEvent,
} from "~/shared/rpc/database_tables_rpc_definitions.js";

export type DatabaseRealtimeEventStub =
    | {
          type: "PagesChanged";
          pageDiffs: DatabasePageDiffs;
          mutationId: DatabaseMutationId;
      }
    | {
          type: "TableMetadataChanged";
          events: ReadonlyArray<RynamoEventStub>;
      };

export class DatabaseDurableObjectConnection {
    private readonly _server: DatabaseServer;
    private readonly _durableObjectStorage: DatabaseDurableObjectStorage;
    private readonly _sendEventToAll: (
        context: WorkerProcessContext,
        event: DatabaseRealtimeEventStub,
    ) => void;
    private readonly _sendEventToSelf: (
        context: WorkerProcessContext,
        event: DatabaseRealtimeEventStub,
    ) => void;
    private readonly _processContext: WorkerProcessContext;
    private readonly _databaseGroupId: DatabaseGroupId;
    private readonly _browserId: BrowserId;
    private readonly _connectionId: WebSocketConnectionId;
    private readonly _browserPageTracker: BrowserPageTracker;
    private readonly _trackPages: boolean;

    constructor({
        server,
        durableObjectStorage,
        processContext,
        sendEventToAll,
        sendEventToSelf,
        databaseGroupId,
        browserId,
        connectionId,
        browserPageTracker,
        trackPages,
    }: {
        server: DatabaseServer;
        durableObjectStorage: DatabaseDurableObjectStorage;
        processContext: WorkerProcessContext;
        sendEventToAll: (context: WorkerProcessContext, event: DatabaseRealtimeEventStub) => void;
        sendEventToSelf: (context: WorkerProcessContext, event: DatabaseRealtimeEventStub) => void;
        databaseGroupId: DatabaseGroupId;
        browserId: BrowserId;
        connectionId: WebSocketConnectionId;
        browserPageTracker: BrowserPageTracker;
        trackPages: boolean;
    }) {
        this._server = server;
        this._durableObjectStorage = durableObjectStorage;
        this._processContext = processContext;
        this._sendEventToAll = sendEventToAll;
        this._sendEventToSelf = sendEventToSelf;
        this._databaseGroupId = databaseGroupId;
        this._browserId = browserId;
        this._connectionId = connectionId;
        this._browserPageTracker = browserPageTracker;
        this._trackPages = trackPages;
        if (trackPages) {
            this._browserPageTracker.registerConnection(browserId, connectionId);
        }
    }

    public readonly procedures: WebSocketConnectionProcedures<
        WorkerSessionActionContextModules,
        typeof DatabaseRealtimeProtocol
    > = {
        executeAction: async (context, input) => {
            if (databaseActions[input.action.name].internalOnly) {
                throw new PermissionDeniedError(
                    `Database action ${input.action.name} is internal-only`,
                );
            }

            const result = this._server.executeAction(context, input.action);

            const pageDiffs = buildDatabasePageDiffs(result.changedPages, result.readPages);
            if (pageDiffs.size > 0) {
                this._sendEventToAll(this._processContext, {
                    type: "PagesChanged",
                    pageDiffs,
                    mutationId: input.mutationId,
                });
            } else if (!input.returnPages) {
                // `returnPages: false` marks the fire-and-forget send of an optimistic mutation,
                // which relies on a realtime event to confirm (and dequeue) it — and this event
                // must arrive before the procedure response. A mutation that ends up writing
                // nothing (e.g. deleting a row another client already deleted) broadcasts no
                // diffs, so confirm it to the originator explicitly with an empty event.
                // Foreground calls (`returnPages: true`) consume the response directly and need no
                // confirmation.
                this._sendEventToSelf(this._processContext, {
                    type: "PagesChanged",
                    pageDiffs: new Map(),
                    mutationId: input.mutationId,
                });
            }

            const filteredReadPages = input.returnPages
                ? this._browserPageTracker.filterReadPages(this._browserId, result.readPages)
                : null;

            if (filteredReadPages !== null && filteredReadPages.size > 0) {
                const pendingByTable = new Map<DatabaseTableId, Iterable<number>>();
                for (const [tableId, tablePages] of filteredReadPages) {
                    pendingByTable.set(tableId, tablePages.keys());
                }
                this._browserPageTracker.addPendingPages(this._browserId, pendingByTable);
            }

            // Report the canonical file size for every table whose pages we return, so the
            // client's sparse cache can serve the correct file size (SQLite treats a file
            // shorter than its header claims as corrupt).
            let fileSizesInPages: Map<DatabaseTableId, number> | null = null;
            if (filteredReadPages !== null) {
                fileSizesInPages = new Map();
                for (const tableId of filteredReadPages.keys()) {
                    fileSizesInPages.set(
                        tableId,
                        this._durableObjectStorage.getFileSize(tableId) / sqlitePageSize,
                    );
                }
            }

            return {
                result: input.returnResult
                    ? ({name: input.action.name, output: result.result} as any)
                    : null,
                readPages: filteredReadPages,
                fileSizesInPages,
            };
        },
        ensureCacheIsUpToDate: async (_context, input) => {
            // Mutable builder for the readonly `DatabaseEnsureCacheIsUpToDateResult["tables"]`
            // return type; `updatedPages` reuses the wire type.
            const tables = new Map<
                DatabaseTableId,
                {
                    updatedPages: DatabaseTablePages;
                    stalePageIndexes: Array<number>;
                    fileSizeInPages: number;
                }
            >();

            // The tracker is partitioned by table, so validate every table the client sent —
            // not just the main table — otherwise setPages below would wipe tracker state for
            // any attached table omitted from the map.
            const matchingPagesByTable = new Map<DatabaseTableId, Array<number>>();
            const pendingPagesByTable = new Map<DatabaseTableId, Iterable<number>>();

            for (const [tableId, tableVersions] of input.pageVersionsByIndex) {
                const updatedPages = new Map<number, {version: number; data: Uint8Array}>();
                const stalePageIndexes: Array<number> = [];
                let overLimit = false;

                for (const [pageIndex, clientVersion] of tableVersions) {
                    const page = this._durableObjectStorage.readPage(tableId, pageIndex);

                    // Page matches — skip.
                    if (page !== null && page.version === clientVersion) continue;

                    // Over limit, or page is gone — stale index.
                    if (overLimit || page === null) {
                        stalePageIndexes.push(pageIndex);
                        continue;
                    }

                    updatedPages.set(pageIndex, {version: page.version, data: page.data});
                    if (updatedPages.size >= cacheUpdateStalePageLimit) {
                        // Too many stale pages to inline — dump everything collected so far into
                        // stalePageIndexes and stop reading data.
                        for (const idx of updatedPages.keys()) {
                            stalePageIndexes.push(idx);
                        }
                        updatedPages.clear();
                        overLimit = true;
                    }
                }

                // Always include page 0 so the client has the schema.
                if (!updatedPages.has(0)) {
                    const page0 = this._durableObjectStorage.readPage(tableId, 0);
                    if (page0 !== null) {
                        const clientVersion = tableVersions.get(0);
                        if (clientVersion === undefined || clientVersion !== page0.version) {
                            updatedPages.set(0, {version: page0.version, data: page0.data});
                        }
                    }
                }

                // Tell the tracker which pages the client already has valid copies of: all client
                // pages minus those we're updating or marking stale.
                const staleSet = new Set(stalePageIndexes);
                const matchingPages: Array<number> = [];
                for (const pageIndex of tableVersions.keys()) {
                    if (!updatedPages.has(pageIndex) && !staleSet.has(pageIndex)) {
                        matchingPages.push(pageIndex);
                    }
                }
                matchingPagesByTable.set(tableId, matchingPages);

                if (updatedPages.size > 0) {
                    pendingPagesByTable.set(tableId, updatedPages.keys());
                }

                const fileSizeInPages =
                    this._durableObjectStorage.getFileSize(tableId) / sqlitePageSize;
                tables.set(tableId, {updatedPages, stalePageIndexes, fileSizeInPages});
            }

            this._browserPageTracker.setPages(this._browserId, matchingPagesByTable);
            if (pendingPagesByTable.size > 0) {
                this._browserPageTracker.addPendingPages(this._browserId, pendingPagesByTable);
            }

            return {tables};
        },
        acknowledgePages: async (_context, input) => {
            this._browserPageTracker.addPages(this._browserId, input.pageIndexes);
            return {};
        },
    };

    public handleClose(): void {
        if (this._trackPages) {
            this._browserPageTracker.unregisterConnection(this._browserId, this._connectionId);
        }
    }

    public async authorize(context: WorkerSessionActionContext): Promise<void> {
        // Space-level gate: every database group belongs to exactly one space, and all
        // per-table checks downstream (the authorizer's access resolver, realtime
        // filtering) evaluate replicated policies _assuming_ space access — this is the
        // async check that assumption rests on. The websocket wrapper re-runs it roughly
        // every two minutes, so a revoked space membership closes the socket within that
        // bound (plus the ~15s server-side membership cache) — the same staleness Alpine
        // accepts for documents and chat.
        await authorizeDatabaseGroupAccess(context, {databaseGroupId: this._databaseGroupId});
    }

    public async transformEvent(
        context: WorkerSessionActionContext,
        eventStub: DatabaseRealtimeEventStub,
    ): Promise<DatabaseRealtimeEvent> {
        switch (eventStub.type) {
            case "PagesChanged": {
                return eventStub;
            }
            case "TableMetadataChanged": {
                const {events} = await getDatabaseTableMetadataRealtimeEvent(context, {
                    databaseGroupId: this._databaseGroupId,
                    events: eventStub.events,
                });
                return {
                    type: "TableMetadataChanged",
                    events,
                };
            }
            default:
                throw exhaustive(eventStub);
        }
    }
}
