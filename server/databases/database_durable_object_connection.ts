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
import {SchemaSerializedValue} from "~/shared/schema/schema.js";

export interface DatabaseRealtimeEventStub {
    pages: Array<{pageIndex: number; data: Uint8Array}>;
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
        query: async (_context, input) => {
            return this._storage.transactionSync(() => {
                const {rows} = this._server.query(input.sql);
                return {rows: rows as Array<SchemaSerializedValue>};
            });
        },
        mutate: async (_context, input) => {
            const {rows, pages} = this._storage.transactionSync(() => {
                const {rows, changedPages} = this._server.mutate(input.sql);
                const pages = [...changedPages].map(([pageIndex, {after}]) => ({
                    pageIndex,
                    data: after,
                }));
                return {rows, pages};
            });

            this._sendEventToAll(this._processContext, {pages});

            return {rows: rows as Array<SchemaSerializedValue>};
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
        return {type: "PagesChanged", pages: eventStub.pages};
    }
}
