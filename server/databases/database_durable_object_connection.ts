import {
    WorkerSessionActionContext,
    WorkerSessionActionContextModules,
} from "~/server/cloudflare/context/worker_action_context.js";
import {WorkerProcessContext} from "~/server/cloudflare/context/worker_process_context.js";
import {BrowserPageTracker} from "~/server/databases/browser_page_tracker.js";
import {DatabaseDurableObjectStorage} from "~/server/databases/database_durable_object_storage.js";
import {DatabaseServer} from "~/server/databases/database_server.js";
import {WebSocketConnectionProcedures} from "~/server/web_socket/web_socket_server.js";
import {
    DatabaseRealtimeEvent,
    DatabaseRealtimeProtocol,
} from "~/shared/databases/database_realtime_protocol.js";
import {type PageDiff, diffPage} from "~/shared/databases/page_diff.js";
import {cacheUpdateStalePageLimit, sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {getMinId} from "~/shared/id/id.js";
import type {
    BrowserId,
    DatabaseMutationId,
    DatabaseTableId,
    WebSocketConnectionId,
} from "~/shared/id/types/id_types.js";

/**
 * Constant {@link DatabaseTableId} used to key the
 * single internal SQLite database. Once each table has
 * its own database this is replaced by per-table IDs.
 */
const mainDatabaseTableId = getMinId<DatabaseTableId>();

export type DatabaseRealtimeEventStub = {
    type: "PagesChanged";
    pages: Array<{pageIndex: number; timestamp: number; diff: PageDiff}>;
    mutationId: DatabaseMutationId;
    fileSizeInPages: number;
};

export class DatabaseDurableObjectConnection {
    private readonly _server: DatabaseServer;
    private readonly _storage: DurableObjectStorage;
    private readonly _durableObjectStorage: DatabaseDurableObjectStorage;
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
        processContext,
        sendEventToAll,
        browserId,
        connectionId,
        browserPageTracker,
    }: {
        server: DatabaseServer;
        storage: DurableObjectStorage;
        durableObjectStorage: DatabaseDurableObjectStorage;
        processContext: WorkerProcessContext;
        sendEventToAll: (context: WorkerProcessContext, event: DatabaseRealtimeEventStub) => void;
        browserId: BrowserId;
        connectionId: WebSocketConnectionId;
        browserPageTracker: BrowserPageTracker;
    }) {
        this._server = server;
        this._storage = storage;
        this._durableObjectStorage = durableObjectStorage;
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
        executeAction: async (_context, input) => {
            return this._storage.transactionSync(() => {
                const result = this._server.executeAction(input.action);

                if (result.changedPages.size > 0) {
                    const diffPages = [...result.changedPages].map(
                        ([pageIndex, {before, after}]) => ({
                            pageIndex,
                            timestamp: result.readPages.get(pageIndex)!.timestamp,
                            diff: diffPage(before, after),
                        }),
                    );
                    this._sendEventToAll(this._processContext, {
                        type: "PagesChanged",
                        pages: diffPages,
                        mutationId: input.mutationId,
                        fileSizeInPages: this._durableObjectStorage.getFileSize() / sqlitePageSize,
                    });
                }

                const readPages = input.returnPages
                    ? this._browserPageTracker.filterReadPages(this._browserId, result.readPages)
                    : null;

                if (readPages !== null && readPages.size > 0) {
                    this._browserPageTracker.addPendingPages(this._browserId, readPages.keys());
                }

                return {
                    result: input.returnResult
                        ? ({name: input.action.name, output: result.result} as any)
                        : null,
                    readPages: readPages === null ? null : new Map([[mainDatabaseTableId, readPages]]),
                };
            });
        },
        ensureCacheIsUpToDate: async (_context, input) => {
            const updatedPages = new Map<number, {timestamp: number; data: Uint8Array}>();
            const stalePageIndexes: Array<number> = [];
            let overLimit = false;

            const tableTimestamps =
                input.pageTimestampsByIndex.get(mainDatabaseTableId) ?? new Map<number, number>();

            for (const [pageIndex, clientTs] of tableTimestamps) {
                const page = this._durableObjectStorage.readPage(pageIndex);

                // Page matches — skip.
                if (page !== null && page.data !== null && page.timestamp === clientTs) continue;

                // Over limit, or page is gone (null/tombstone) — stale index.
                if (overLimit || page === null || page.data === null) {
                    stalePageIndexes.push(pageIndex);
                    continue;
                }

                updatedPages.set(pageIndex, {timestamp: page.timestamp, data: page.data});
                if (updatedPages.size >= cacheUpdateStalePageLimit) {
                    // Too many stale pages to inline — dump
                    // everything collected so far into
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
                const page0 = this._durableObjectStorage.readPage(0);
                if (page0 !== null && page0.data !== null) {
                    const clientTs = tableTimestamps.get(0);
                    if (clientTs === undefined || clientTs !== page0.timestamp) {
                        updatedPages.set(0, {timestamp: page0.timestamp, data: page0.data});
                    }
                }
            }

            // Tell the tracker which pages the client
            // already has valid copies of: all client pages
            // minus those we're updating or marking stale.
            const staleSet = new Set(stalePageIndexes);
            const matchingPages: Array<number> = [];
            for (const pageIndex of tableTimestamps.keys()) {
                if (!updatedPages.has(pageIndex) && !staleSet.has(pageIndex)) {
                    matchingPages.push(pageIndex);
                }
            }
            this._browserPageTracker.setPages(this._browserId, matchingPages);

            if (updatedPages.size > 0) {
                this._browserPageTracker.addPendingPages(this._browserId, updatedPages.keys());
            }

            const fileSizeInPages = this._durableObjectStorage.getFileSize() / sqlitePageSize;
            return {
                tables: new Map([
                    [
                        mainDatabaseTableId,
                        {updatedPages, stalePageIndexes, fileSizeInPages},
                    ],
                ]),
            };
        },
        acknowledgePages: async (_context, input) => {
            const pageIndexes = input.pageIndexes.get(mainDatabaseTableId) ?? [];
            this._browserPageTracker.addPages(this._browserId, pageIndexes);
            return {};
        },
    };

    public handleClose(): void {
        this._browserPageTracker.unregisterConnection(this._browserId, this._connectionId);
    }

    public async authorize(): Promise<void> {
        // No-op for now. Authorization is handled by
        // createDurableObject's token verification.
    }

    public async transformEvent(
        _context: WorkerSessionActionContext,
        eventStub: DatabaseRealtimeEventStub,
    ): Promise<DatabaseRealtimeEvent> {
        switch (eventStub.type) {
            case "PagesChanged": {
                const pages = eventStub.pages.filter(p =>
                    this._browserPageTracker.clientMightHavePage(this._browserId, p.pageIndex),
                );
                return {
                    type: "PagesChanged",
                    tables: new Map([
                        [
                            mainDatabaseTableId,
                            {pages, fileSizeInPages: eventStub.fileSizeInPages},
                        ],
                    ]),
                    mutationId: eventStub.mutationId,
                };
            }
            default:
                throw exhaustive(eventStub.type);
        }
    }
}
