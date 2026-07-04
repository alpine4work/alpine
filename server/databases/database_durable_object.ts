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
import {DatabaseServer} from "~/server/databases/database_server.js";
import {
    drainDatabaseTableReplicationOutbox,
    enqueueDatabaseTableReplication,
    initializeDatabaseTableReplicationOutbox,
} from "~/server/databases/database_table_replication_outbox.js";
import {WebSocketServer} from "~/server/web_socket/web_socket_server.js";
import {DatabaseActionFetchResponseSchema} from "~/shared/databases/database_action_fetch_schema.js";
import {DatabaseActionObjectSchema} from "~/shared/databases/database_actions.js";
import {DatabaseRealtimeProtocol} from "~/shared/databases/database_realtime_protocol.js";
import {InvalidArgumentError, NotFoundError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import type {BrowserId, DatabaseGroupId, SpaceId} from "~/shared/id/types/id_types.js";
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
    private _isDrainingReplicationOutbox = false;

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
        initializeDatabaseTableReplicationOutbox(storage.sql);
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
            const spaceId = searchParams.get("spaceId") as SpaceId | null;
            if (spaceId === null) {
                throw new InvalidArgumentError("Missing spaceId query parameter");
            }
            return new DatabaseDurableObjectConnection({
                server: this._server,
                processContext: this._processContext,
                storage,
                durableObjectStorage: this._durableObjectStorage,
                drainReplicationOutboxIfPossible: context =>
                    this._drainReplicationOutboxIfPossible(context, spaceId),
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
        const spaceId = new URL(request.url).searchParams.get("spaceId") as SpaceId | null;
        if (spaceId === null) {
            throw new InvalidArgumentError("Missing spaceId query parameter");
        }

        const {result, readPages} = this._storage.transactionSync(() => {
            const actionResult = this._server.executeAction(actionObject);
            enqueueDatabaseTableReplication(this._storage.sql, {
                storageVersion: actionResult.writeVersion,
                tableIds: actionResult.changedTables,
            });
            return actionResult;
        });

        await this._drainReplicationOutboxIfPossible(context, spaceId);

        return new Response(
            JSON.stringify(
                DatabaseActionFetchResponseSchema.serialize({
                    result: {name: actionObject.name, output: result} as any,
                    readPages,
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

    private async _drainReplicationOutboxIfPossible(
        context: WorkerActionContext | WorkerSessionActionContext,
        spaceId: SpaceId,
    ): Promise<void> {
        if (this._isDrainingReplicationOutbox) return;
        this._isDrainingReplicationOutbox = true;
        try {
            await drainDatabaseTableReplicationOutbox(
                context,
                this._storage.sql,
                spaceId,
                this._databaseGroupId,
            );
        } catch (error) {
            context.tracer.logException("Drain database table replication outbox", error);
            // The outbox row stays durable and will be retried by a later action.
        } finally {
            this._isDrainingReplicationOutbox = false;
        }
    }
}

const DatabaseGroupDurableObjectWrapper = createDurableObject(DatabaseGroupDurableObject);
export {DatabaseGroupDurableObjectWrapper as DatabaseGroupDurableObject};
