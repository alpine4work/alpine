import {
    WorkerSessionActionContext,
    WorkerSessionActionContextModules,
} from "~/server/cloudflare/context/worker_action_context.js";
import {WorkerProcessContext} from "~/server/cloudflare/context/worker_process_context.js";
import {DatabaseDurableObjectStorage} from "~/server/databases/database_durable_object_storage.js";
import {DatabaseServer} from "~/server/databases/database_server.js";
import {WebSocketConnectionProcedures} from "~/server/web_socket/web_socket_server.js";
import {
    DatabaseRealtimeEvent,
    DatabaseRealtimeProtocol,
} from "~/shared/databases/database_realtime_protocol.js";
import {type PageDiff, diffPage} from "~/shared/databases/page_diff.js";
import {cacheUpdateStalePageLimit, sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import type {DatabaseMutationId} from "~/shared/id/types/id_types.js";

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

    constructor({
        server,
        storage,
        durableObjectStorage,
        processContext,
        sendEventToAll,
    }: {
        server: DatabaseServer;
        storage: DurableObjectStorage;
        durableObjectStorage: DatabaseDurableObjectStorage;
        processContext: WorkerProcessContext;
        sendEventToAll: (context: WorkerProcessContext, event: DatabaseRealtimeEventStub) => void;
    }) {
        this._server = server;
        this._storage = storage;
        this._durableObjectStorage = durableObjectStorage;
        this._processContext = processContext;
        this._sendEventToAll = sendEventToAll;
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

                return {
                    result: input.returnResult
                        ? ({name: input.action.name, output: result.result} as any)
                        : null,
                    readPages: input.returnPages ? result.readPages : null,
                };
            });
        },
        ensureCacheIsUpToDate: async (_context, input) => {
            const updatedPages = new Map<number, {timestamp: number; data: Uint8Array}>();
            const stalePageIndexes: Array<number> = [];
            let overLimit = false;

            for (const [pageIndex, clientTs] of input.pageTimestampsByIndex) {
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
                    const clientTs = input.pageTimestampsByIndex.get(0);
                    if (clientTs === undefined || clientTs !== page0.timestamp) {
                        updatedPages.set(0, {timestamp: page0.timestamp, data: page0.data});
                    }
                }
            }

            const fileSizeInPages = this._durableObjectStorage.getFileSize() / sqlitePageSize;
            return {updatedPages, stalePageIndexes, fileSizeInPages};
        },
    };

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
