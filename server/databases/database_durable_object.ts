import {
    WorkerActionContext,
    WorkerSessionActionContext,
    WorkerSessionActionContextModules,
} from "~/server/cloudflare/context/worker_action_context.js";
import {
    WorkerProcessContext,
    WorkerProcessContextModules,
} from "~/server/cloudflare/context/worker_process_context.js";
import {createDurableObject} from "~/server/cloudflare/create_durable_object.js";
import {
    DatabaseDurableObjectConnection,
    DatabaseRealtimeEventStub,
} from "~/server/databases/database_durable_object_connection.js";
import {DatabaseDurableObjectStorage} from "~/server/databases/database_durable_object_storage.js";
import {DatabaseServer} from "~/server/databases/database_server.js";
import {WebSocketServer} from "~/server/web_socket/web_socket_server.js";
import {
    DatabaseQueryRequestSchema,
    DatabaseQueryResponseSchema,
} from "~/shared/databases/database_query_schema.js";
import {DatabaseRealtimeProtocol} from "~/shared/databases/database_realtime_protocol.js";
import {NotFoundError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";

type DatabaseDurableObjectRoute = "Main" | "Query" | "NotFound";

class DatabaseDurableObject {
    public static readonly serviceName = "DatabaseService";

    private readonly _server: DatabaseServer;
    private readonly _storage: DurableObjectStorage;
    private readonly _processContext: WorkerProcessContext;

    private readonly _webSocketServer: WebSocketServer<
        WorkerProcessContextModules,
        WorkerSessionActionContextModules,
        typeof DatabaseRealtimeProtocol,
        DatabaseRealtimeEventStub,
        DatabaseDurableObjectConnection
    >;

    public static async initialize({
        processContext,
        storage,
    }: {
        processContext: WorkerProcessContext;
        initializeActionContext: WorkerActionContext;
        idName: string;
        destroy: () => void;
        storage: DurableObjectStorage;
    }): Promise<DatabaseDurableObject> {
        const durableObjectStorage = new DatabaseDurableObjectStorage(storage.sql);
        const server = await DatabaseServer.create(durableObjectStorage);
        return new DatabaseDurableObject({processContext, server, storage});
    }

    private constructor({
        processContext,
        server,
        storage,
    }: {
        processContext: WorkerProcessContext;
        server: DatabaseServer;
        storage: DurableObjectStorage;
    }) {
        this._processContext = processContext;
        this._server = server;
        this._storage = storage;

        this._webSocketServer = new WebSocketServer<
            WorkerProcessContextModules,
            WorkerSessionActionContextModules,
            typeof DatabaseRealtimeProtocol,
            DatabaseRealtimeEventStub,
            DatabaseDurableObjectConnection
        >(this._processContext, DatabaseRealtimeProtocol, () => {
            return new DatabaseDurableObjectConnection({
                server: this._server,
                processContext: this._processContext,
                storage,
                sendEventToAll: (context, event) => {
                    this._webSocketServer.sendEventToAll(context, event);
                },
            });
        });
    }

    public static parseRoute(url: URL): [string, DatabaseDurableObjectRoute] {
        if (url.pathname === "/") return ["/", "Main"];
        if (url.pathname === "/query") return ["/query", "Query"];
        return ["/*", "NotFound"];
    }

    public async fetch(
        context: WorkerActionContext,
        request: Request,
        route: DatabaseDurableObjectRoute,
    ): Promise<Response> {
        switch (route) {
            case "Main":
                return await this._webSocketServer.upgrade(
                    context.actor.authorizeSession(),
                    request,
                );
            case "Query":
                return await this._handleQuery(request);
            case "NotFound":
                throw new NotFoundError("Route not found");
            default:
                throw exhaustive(route);
        }
    }

    private async _handleQuery(request: Request): Promise<Response> {
        const {sql} = DatabaseQueryRequestSchema.deserialize(
            (await request.json()) as SchemaSerializedValue,
        );

        const {rows, pages: pagesMap} = this._storage.transactionSync(() =>
            this._server.query(sql),
        );

        const pages = [...pagesMap].map(([pageIndex, data]) => ({
            pageIndex,
            data,
        }));

        return new Response(
            JSON.stringify(
                DatabaseQueryResponseSchema.serialize({
                    rows: rows as Array<SchemaSerializedValue>,
                    pages,
                }),
            ),
            {
                status: 200,
                headers: {"content-type": "application/json"},
            },
        );
    }

    public connectForTest(context: WorkerSessionActionContext) {
        return this._webSocketServer.connectForTest(context);
    }
}

const DatabaseDurableObjectWrapper = createDurableObject(DatabaseDurableObject);
export {DatabaseDurableObjectWrapper as DatabaseDurableObject};
