import {
    WorkerSessionActionContext,
    WorkerSessionActionContextModules,
} from "~/server/cloudflare/context/worker_action_context.js";
import {WorkerProcessContext} from "~/server/cloudflare/context/worker_process_context.js";
import {BrowserPageTracker} from "~/server/databases/browser_page_tracker.js";
import {DatabaseDurableObjectStorage} from "~/server/databases/database_durable_object_storage.js";
import {DatabaseServer} from "~/server/databases/database_server.js";
import {enqueueDatabaseTableReplication} from "~/server/databases/database_table_replication_outbox.js";
import {WebSocketConnectionProcedures} from "~/server/web_socket/web_socket_server.js";
import type {
    DatabasePageDiffs,
    DatabaseTablePageDiffs,
    DatabaseTablePages,
} from "~/shared/databases/database_protocol_schemas.js";
import {
    DatabaseRealtimeEvent,
    DatabaseRealtimeProtocol,
} from "~/shared/databases/database_realtime_protocol.js";
import {type PageDiff, diffPage} from "~/shared/databases/page_diff.js";
import {cacheUpdateStalePageLimit, sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import type {
    BrowserId,
    DatabaseMutationId,
    DatabaseTableId,
    SpaceId,
    WebSocketConnectionId,
} from "~/shared/id/types/id_types.js";

export type DatabaseRealtimeEventStub = {
    type: "PagesChanged";
    pageDiffs: DatabasePageDiffs;
    mutationId: DatabaseMutationId;
};

export class DatabaseDurableObjectConnection {
    private readonly _server: DatabaseServer;
    private readonly _storage: DurableObjectStorage;
    private readonly _durableObjectStorage: DatabaseDurableObjectStorage;
    private readonly _spaceId: SpaceId | null;
    private readonly _drainReplicationOutboxIfPossible: (
        context: WorkerSessionActionContext,
    ) => Promise<void>;
    private readonly _sendEventToAll: (
        context: WorkerProcessContext,
        event: DatabaseRealtimeEventStub,
    ) => void;
    private readonly _processContext: WorkerProcessContext;
    private readonly _browserId: BrowserId;
    private readonly _connectionId: WebSocketConnectionId;
    private readonly _browserPageTracker: BrowserPageTracker;

    constructor({
        server,
        storage,
        durableObjectStorage,
        spaceId,
        drainReplicationOutboxIfPossible,
        processContext,
        sendEventToAll,
        browserId,
        connectionId,
        browserPageTracker,
    }: {
        server: DatabaseServer;
        storage: DurableObjectStorage;
        durableObjectStorage: DatabaseDurableObjectStorage;
        spaceId: SpaceId | null;
        drainReplicationOutboxIfPossible: (context: WorkerSessionActionContext) => Promise<void>;
        processContext: WorkerProcessContext;
        sendEventToAll: (context: WorkerProcessContext, event: DatabaseRealtimeEventStub) => void;
        browserId: BrowserId;
        connectionId: WebSocketConnectionId;
        browserPageTracker: BrowserPageTracker;
    }) {
        this._server = server;
        this._storage = storage;
        this._durableObjectStorage = durableObjectStorage;
        this._spaceId = spaceId;
        this._drainReplicationOutboxIfPossible = drainReplicationOutboxIfPossible;
        this._processContext = processContext;
        this._sendEventToAll = sendEventToAll;
        this._browserId = browserId;
        this._connectionId = connectionId;
        this._browserPageTracker = browserPageTracker;
        this._browserPageTracker.registerConnection(browserId, connectionId);
    }

    public readonly procedures: WebSocketConnectionProcedures<
        WorkerSessionActionContextModules,
        typeof DatabaseRealtimeProtocol
    > = {
        executeAction: async (context, input) => {
            const response = this._storage.transactionSync(() => {
                const result = this._server.executeAction(input.action);
                enqueueDatabaseTableReplication(this._storage.sql, {
                    storageVersion: result.writeVersion,
                    spaceId: this._spaceId,
                    tableIds: result.changedTables,
                });

                const pageDiffs = new Map<DatabaseTableId, DatabaseTablePageDiffs>();
                for (const [tableId, {pages, fileSizeInPages}] of result.changedPages) {
                    // `getBufferedWrites` only emits a table entry when it has at least one buffered
                    // page, so a changed-pages entry always carries pages.
                    assert(pages.size > 0, `changedPages entry for ${tableId} has no pages`);
                    const tableReadPages = result.readPages.get(tableId);
                    const diffs = new Map<number, {version: number; diff: PageDiff}>();
                    for (const [pageIndex, {before, after}] of pages) {
                        diffs.set(pageIndex, {
                            version: tableReadPages!.get(pageIndex)!.version,
                            diff: diffPage(before, after),
                        });
                    }
                    pageDiffs.set(tableId, {diffs, fileSizeInPages});
                }
                if (pageDiffs.size > 0) {
                    this._sendEventToAll(this._processContext, {
                        type: "PagesChanged",
                        pageDiffs,
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

                return {
                    result: input.returnResult
                        ? ({name: input.action.name, output: result.result} as any)
                        : null,
                    readPages: filteredReadPages,
                };
            });

            await this._drainReplicationOutboxIfPossible(context);
            return response;
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
        this._browserPageTracker.unregisterConnection(this._browserId, this._connectionId);
    }

    public async authorize(): Promise<void> {
        // No-op for now. Authorization is handled by createDurableObject's token
        // verification.
    }

    public async transformEvent(
        _context: WorkerSessionActionContext,
        eventStub: DatabaseRealtimeEventStub,
    ): Promise<DatabaseRealtimeEvent> {
        switch (eventStub.type) {
            case "PagesChanged": {
                return eventStub;
            }
            default:
                throw exhaustive(eventStub.type);
        }
    }
}
