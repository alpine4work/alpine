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
import type {
    BrowserId,
    DatabaseMutationId,
    WebSocketConnectionId,
} from "~/shared/id/types/id_types.js";

export interface DatabaseRealtimeEventStub {
    pages: Array<{pageIndex: number; timestamp: number; diff: PageDiff}>;
    mutationId: DatabaseMutationId;
    fileSizeInPages: number;
}

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
                        pages: diffPages,
                        mutationId: input.mutationId,
                        fileSizeInPages: this._durableObjectStorage.getFileSize() / sqlitePageSize,
                    });
                }

                const readPages = input.returnPages
                    ? this._browserPageTracker.filterReadPages(this._browserId, result.readPages)
                    : null;

                return {
                    result: input.returnResult
                        ? ({name: input.action.name, output: result.result} as any)
                        : null,
                    readPages,
                };
            });
        },
        syncCachePages: async (_context, input) => {
            const isInitial = input.mode === "initial";
            const updatedPages = new Map<number, {timestamp: number; data: Uint8Array}>();
            const stalePageIndexes: Array<number> = [];
            let overLimit = false;

            for (const [pageIndex, clientTs] of input.pageTimestampsByIndex) {
                const page = this._durableObjectStorage.readPage(pageIndex);

                // Page matches — skip.
                if (page !== null && page.data !== null && page.timestamp === clientTs) continue;

                // Page is gone (null/tombstone) — stale index.
                if (page === null || page.data === null) {
                    stalePageIndexes.push(pageIndex);
                    continue;
                }

                // In initial mode, apply the stale page limit.
                if (isInitial && overLimit) {
                    stalePageIndexes.push(pageIndex);
                    continue;
                }

                updatedPages.set(pageIndex, {timestamp: page.timestamp, data: page.data});

                if (isInitial && updatedPages.size >= cacheUpdateStalePageLimit) {
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

            // Initial mode: always include page 0 so the
            // client has the schema.
            if (isInitial && !updatedPages.has(0)) {
                const page0 = this._durableObjectStorage.readPage(0);
                if (page0 !== null && page0.data !== null) {
                    const clientTs = input.pageTimestampsByIndex.get(0);
                    if (clientTs === undefined || clientTs !== page0.timestamp) {
                        updatedPages.set(0, {timestamp: page0.timestamp, data: page0.data});
                    }
                }
            }

            // Update tracker based on mode.
            const staleSet = new Set(stalePageIndexes);
            if (isInitial) {
                // Replace: only matching pages (not updated
                // or stale).
                const matchingPages: Array<number> = [];
                for (const pageIndex of input.pageTimestampsByIndex.keys()) {
                    if (!updatedPages.has(pageIndex) && !staleSet.has(pageIndex)) {
                        matchingPages.push(pageIndex);
                    }
                }
                this._browserPageTracker.setPages(this._browserId, matchingPages);
            } else {
                // Incremental: add all valid pages (matching
                // + updated). Client will have these after
                // writing the response.
                const validPages: Array<number> = [];
                for (const pageIndex of input.pageTimestampsByIndex.keys()) {
                    if (!staleSet.has(pageIndex)) {
                        validPages.push(pageIndex);
                    }
                }
                this._browserPageTracker.addPages(this._browserId, validPages);
            }

            const fileSizeInPages = this._durableObjectStorage.getFileSize() / sqlitePageSize;
            return {updatedPages, stalePageIndexes, fileSizeInPages};
        },
    };

    public handleClose(): void {
        this._browserPageTracker.unregisterConnection(this._browserId, this._connectionId);
    }

    public async authorize(): Promise<void> {
        // No-op for now. Authorization is handled by
        // createDurableObject's token verification.
    }

    public transformEvent(
        _context: WorkerSessionActionContext,
        eventStub: DatabaseRealtimeEventStub,
    ): DatabaseRealtimeEvent {
        return {
            type: "PagesChanged",
            pages: eventStub.pages,
            mutationId: eventStub.mutationId,
            fileSizeInPages: eventStub.fileSizeInPages,
        };
    }
}
