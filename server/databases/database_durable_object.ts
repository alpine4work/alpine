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
import {WebSocketServer} from "~/server/web_socket/web_socket_server.js";
import {DatabaseActionFetchResponseSchema} from "~/shared/databases/database_action_fetch_schema.js";
import {DatabaseActionObjectSchema} from "~/shared/databases/database_actions.js";
import {DatabaseRealtimeProtocol} from "~/shared/databases/database_realtime_protocol.js";
import {InvalidArgumentError, NotFoundError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import type {BrowserId} from "~/shared/id/types/id_types.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";

type DatabaseGroupDurableObjectRoute = "Main" | "Action" | "NotFound";

class DatabaseGroupDurableObject {
    public static readonly serviceName = "DatabaseGroupService";

    private readonly _server: DatabaseServer;
    private readonly _durableObjectStorage: DatabaseDurableObjectStorage;
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
        storage,
    }: {
        processContext: WorkerProcessContext;
        initializeActionContext: WorkerActionContext;
        idName: string;
        destroy: () => void;
        storage: DurableObjectStorage;
    }): Promise<DatabaseGroupDurableObject> {
        const durableObjectStorage = new DatabaseDurableObjectStorage(storage);
        const server = await DatabaseServer.create(durableObjectStorage);
        return new DatabaseGroupDurableObject({
            processContext,
            server,
            durableObjectStorage,
        });
    }

    private constructor({
        processContext,
        server,
        durableObjectStorage,
    }: {
        processContext: WorkerProcessContext;
        server: DatabaseServer;
        durableObjectStorage: DatabaseDurableObjectStorage;
    }) {
        this._processContext = processContext;
        this._server = server;
        this._durableObjectStorage = durableObjectStorage;

        this._webSocketServer = new WebSocketServer<
            WorkerProcessContextModules,
            WorkerSessionActionContextModules,
            typeof DatabaseRealtimeProtocol,
            DatabaseRealtimeEventStub,
            DatabaseDurableObjectConnection
        >(
            this._processContext,
            DatabaseRealtimeProtocol,
            ({connectionId, searchParams, sendEvent}) => {
                const browserId = searchParams.get("browserId") as BrowserId | null;
                if (browserId === null) {
                    throw new InvalidArgumentError("Missing browserId query parameter");
                }
                return new DatabaseDurableObjectConnection({
                    processContext: this._processContext,
                    durableObjectStorage: this._durableObjectStorage,
                    server: this._server,
                    sendEventToAll: (context, event) => {
                        this._webSocketServer.sendEventToAll(context, event);
                    },
                    sendEventToSelf: (context, event) => {
                        void sendEvent(context, event);
                    },
                    browserId,
                    connectionId,
                    browserPageTracker: this._browserPageTracker,
                });
            },
        );
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

        const actionResult = this._server.executeAction(context, actionObject);
        return new Response(
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
        );
    }

    public connectForTest(
        context: WorkerSessionActionContext,
        options?: {searchParams?: URLSearchParams},
    ) {
        return this._webSocketServer.connectForTest(context, options);
    }
}

const DatabaseGroupDurableObjectWrapper = createDurableObject(DatabaseGroupDurableObject);
export {DatabaseGroupDurableObjectWrapper as DatabaseGroupDurableObject};
