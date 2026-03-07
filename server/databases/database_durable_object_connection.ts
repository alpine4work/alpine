import {
    WorkerSessionActionContext,
    WorkerSessionActionContextModules,
} from "~/server/cloudflare/context/worker_action_context.js";
import {WorkerProcessContext} from "~/server/cloudflare/context/worker_process_context.js";
import {DatabaseServer} from "~/server/databases/database_server.js";
import {WebSocketConnectionProcedures} from "~/server/web_socket/web_socket_server.js";
import {
    DatabaseRealtimeEvent,
    DatabaseRealtimeProtocol,
} from "~/shared/databases/database_realtime_protocol.js";
import {type PageDiff, diffPage} from "~/shared/databases/page_diff.js";
import type {DatabaseMutationId} from "~/shared/id/types/id_types.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";

export interface DatabaseRealtimeEventStub {
    pages: Array<{pageIndex: number; timestamp: number; diff: PageDiff}>;
    mutationId: DatabaseMutationId;
}

export class DatabaseDurableObjectConnection {
    private readonly _server: DatabaseServer;
    private readonly _storage: DurableObjectStorage;
    private readonly _sendEventToAll: (
        context: WorkerProcessContext,
        event: DatabaseRealtimeEventStub,
    ) => void;
    private readonly _processContext: WorkerProcessContext;

    constructor({
        server,
        storage,
        processContext,
        sendEventToAll,
    }: {
        server: DatabaseServer;
        storage: DurableObjectStorage;
        processContext: WorkerProcessContext;
        sendEventToAll: (context: WorkerProcessContext, event: DatabaseRealtimeEventStub) => void;
    }) {
        this._server = server;
        this._storage = storage;
        this._processContext = processContext;
        this._sendEventToAll = sendEventToAll;
    }

    public readonly procedures: WebSocketConnectionProcedures<
        WorkerSessionActionContextModules,
        typeof DatabaseRealtimeProtocol
    > = {
        execute: async (_context, input) => {
            if (input.allowWrites) {
                const {rows, pages} = this._storage.transactionSync(() => {
                    const {rows, changedPages, timestamp} = this._server.execute(input.sql, {
                        allowWrites: true,
                    });
                    const pages = [...changedPages].map(([pageIndex, {before, after}]) => ({
                        pageIndex,
                        timestamp,
                        diff: diffPage(before, after),
                    }));
                    return {rows, pages};
                });

                this._sendEventToAll(this._processContext, {
                    pages,
                    mutationId: input.mutationId,
                });

                return {rows: rows as Array<SchemaSerializedValue>, pages: []};
            }

            return this._storage.transactionSync(() => {
                const {rows, pages: pagesMap} = this._server.execute(input.sql, {
                    allowWrites: false,
                });
                const pages = [...pagesMap].map(([pageIndex, {data, timestamp}]) => ({
                    pageIndex,
                    timestamp,
                    data,
                }));
                return {rows: rows as Array<SchemaSerializedValue>, pages};
            });
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
        };
    }
}
