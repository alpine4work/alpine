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
import {BrowserPageTracker} from "~/server/databases/browser_page_tracker.js";
import {
    DatabaseDurableObjectConnection,
    DatabaseRealtimeEventStub,
} from "~/server/databases/database_durable_object_connection.js";
import {DatabaseDurableObjectStorage} from "~/server/databases/database_durable_object_storage.js";
import {
    DatabaseServer,
    type DatabaseServerActionResult,
    type DatabaseServerChangedTables,
} from "~/server/databases/database_server.js";
import {WebSocketServer} from "~/server/web_socket/web_socket_server.js";
import {DatabaseActionFetchResponseSchema} from "~/shared/databases/database_action_fetch_schema.js";
import {
    type DatabaseActionName,
    type DatabaseActionObject,
    DatabaseActionObjectSchema,
} from "~/shared/databases/database_actions.js";
import {DatabaseRealtimeProtocol} from "~/shared/databases/database_realtime_protocol.js";
import {InvalidArgumentError, NotFoundError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import type {BrowserId, DatabaseGroupId} from "~/shared/id/types/id_types.js";
import {enqueueDatabaseTableReplicationJob} from "~/shared/rpc/database_replication_rpc_definitions.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";

type DatabaseGroupDurableObjectRoute = "Main" | "Action" | "NotFound";

class DatabaseGroupDurableObject {
    public static readonly serviceName = "DatabaseGroupService";

    private readonly _server: DatabaseServer;
    private readonly _storage: DurableObjectStorage;
    private readonly _durableObjectStorage: DatabaseDurableObjectStorage;
    private readonly _databaseGroupId: DatabaseGroupId;
    private readonly _processContext: WorkerProcessContext;
    private readonly _browserPageTracker = new BrowserPageTracker();

    private readonly _webSocketServer: WebSocketServer<
        WorkerProcessContextModules,
        WorkerSessionActionContextModules,
        typeof DatabaseRealtimeProtocol,
        DatabaseRealtimeEventStub,
        DatabaseDurableObjectConnection
    >;

    public static async initialize({
        processContext,
        idName,
        storage,
    }: {
        processContext: WorkerProcessContext;
        initializeActionContext: WorkerActionContext;
        idName: string;
        destroy: () => void;
        storage: DurableObjectStorage;
    }): Promise<DatabaseGroupDurableObject> {
        const durableObjectStorage = new DatabaseDurableObjectStorage(storage.sql);
        const server = await DatabaseServer.create(durableObjectStorage);
        return new DatabaseGroupDurableObject({
            databaseGroupId: idName as DatabaseGroupId,
            processContext,
            server,
            storage,
            durableObjectStorage,
        });
    }

    private constructor({
        processContext,
        server,
        storage,
        durableObjectStorage,
        databaseGroupId,
    }: {
        databaseGroupId: DatabaseGroupId;
        processContext: WorkerProcessContext;
        server: DatabaseServer;
        storage: DurableObjectStorage;
        durableObjectStorage: DatabaseDurableObjectStorage;
    }) {
        this._processContext = processContext;
        this._server = server;
        this._storage = storage;
        this._durableObjectStorage = durableObjectStorage;
        this._databaseGroupId = databaseGroupId;

        this._webSocketServer = new WebSocketServer<
            WorkerProcessContextModules,
            WorkerSessionActionContextModules,
            typeof DatabaseRealtimeProtocol,
            DatabaseRealtimeEventStub,
            DatabaseDurableObjectConnection
        >(this._processContext, DatabaseRealtimeProtocol, ({connectionId, searchParams}) => {
            const browserId = searchParams.get("browserId") as BrowserId | null;
            if (browserId === null) {
                throw new InvalidArgumentError("Missing browserId query parameter");
            }
            return new DatabaseDurableObjectConnection({
                processContext: this._processContext,
                durableObjectStorage: this._durableObjectStorage,
                executeAction: (context, actionObject, handleResult) =>
                    this._executeAction(context, actionObject, handleResult),
                sendEventToAll: (context, event) => {
                    this._webSocketServer.sendEventToAll(context, event);
                },
                browserId,
                connectionId,
                browserPageTracker: this._browserPageTracker,
            });
        });
    }

    public static parseRoute(url: URL): [string, DatabaseGroupDurableObjectRoute] {
        if (url.pathname === "/") return ["/", "Main"];
        if (url.pathname === "/action") return ["/action", "Action"];
        return ["/*", "NotFound"];
    }

    public async fetch(
        context: WorkerActionContext,
        request: Request,
        route: DatabaseGroupDurableObjectRoute,
    ): Promise<Response> {
        switch (route) {
            case "Main":
                return await this._webSocketServer.upgrade(
                    context.actor.authorizeSession(),
                    request,
                );
            case "Action":
                return await this._handleAction(context, request);
            case "NotFound":
                throw new NotFoundError("Route not found");
            default:
                throw exhaustive(route);
        }
    }

    private async _handleAction(context: WorkerActionContext, request: Request): Promise<Response> {
        const actionObject = DatabaseActionObjectSchema.deserialize(
            (await request.json()) as SchemaSerializedValue,
        );

        return await this._executeAction(
            context,
            actionObject,
            actionResult =>
                new Response(
                    JSON.stringify(
                        DatabaseActionFetchResponseSchema.serialize({
                            result: {name: actionObject.name, output: actionResult.result} as any,
                            readPages: actionResult.readPages,
                        }),
                    ),
                    {
                        status: 200,
                        headers: {"content-type": "application/json"},
                    },
                ),
        );
    }

    public connectForTest(context: WorkerSessionActionContext) {
        return this._webSocketServer.connectForTest(context);
    }

    private async _executeAction<N extends DatabaseActionName, T>(
        context: WorkerActionContext | WorkerSessionActionContext,
        actionObject: DatabaseActionObject<N>,
        handleResult: (result: DatabaseServerActionResult<N>) => T,
    ): Promise<T> {
        let actionResult: DatabaseServerActionResult<N> | null = null;
        const response = this._storage.transactionSync(() => {
            const persistedActionResult = this._server.executeAction(actionObject);
            actionResult = persistedActionResult;
            return handleResult(persistedActionResult);
        });
        const persistedActionResult = assertExists<DatabaseServerActionResult<N>>(actionResult);

        await this._enqueueReplicationJob(context, {
            storageVersion: persistedActionResult.writeVersion,
            tableIds: persistedActionResult.changedTables,
        });

        return response;
    }

    private async _enqueueReplicationJob(
        context: WorkerActionContext | WorkerSessionActionContext,
        {
            storageVersion,
            tableIds,
        }: {
            storageVersion: number;
            tableIds: DatabaseServerChangedTables;
        },
    ): Promise<void> {
        if (storageVersion === 0 || tableIds.size === 0) return;

        await enqueueDatabaseTableReplicationJob(context, {
            databaseGroupId: this._databaseGroupId,
            storageVersion,
            tableIds,
        });
    }
}

const DatabaseGroupDurableObjectWrapper = createDurableObject(DatabaseGroupDurableObject);
export {DatabaseGroupDurableObjectWrapper as DatabaseGroupDurableObject};
