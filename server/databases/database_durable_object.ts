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
import {buildDatabasePageDiffs} from "~/server/databases/build_database_page_diffs.js";
import {
    DatabaseDurableObjectConnection,
    DatabaseRealtimeEventStub,
} from "~/server/databases/database_durable_object_connection.js";
import {DatabaseDurableObjectStorage} from "~/server/databases/database_durable_object_storage.js";
import {runDatabaseDurableObjectSqlMigrations} from "~/server/databases/database_durable_object_sql_migrations.js";
import {DatabaseServer} from "~/server/databases/database_server.js";
import {isTrustedDatabaseServiceActor} from "~/server/databases/is_trusted_database_service_actor.js";
import {WebSocketServer} from "~/server/web_socket/web_socket_server.js";
import {DatabaseActionFetchResponseSchema} from "~/shared/databases/database_action_fetch_schema.js";
import {DatabaseActionObjectSchema} from "~/shared/databases/database_actions.js";
import {
    DatabaseRealtimeProtocol,
    DatabaseTableMetadataBroadcastRealtimeEventsSchema,
} from "~/shared/databases/database_realtime_protocol.js";
import {InvalidArgumentError, NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {generateId} from "~/shared/id/id.js";
import type {BrowserId, DatabaseGroupId, DatabaseMutationId} from "~/shared/id/types/id_types.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";

type DatabaseGroupDurableObjectRoute =
    | "Main"
    | "Action"
    | "BroadcastTableMetadataRealtimeEvents"
    | "NotFound";

/**
 * Durable-object KV key holding the group's private salt. Distinct namespace from
 * {@link DatabaseDurableObjectStorage}, which stores pages in its own SQL tables.
 */
const databasePrivateSaltStorageKey = "alpine_database_private_salt";

class DatabaseGroupDurableObject {
    public static readonly serviceName = "DatabaseGroupService";

    private readonly _server: DatabaseServer;
    private readonly _durableObjectStorage: DatabaseDurableObjectStorage;
    private readonly _processContext: WorkerProcessContext;
    private readonly _databaseGroupId: DatabaseGroupId;
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
        idName,
    }: {
        processContext: WorkerProcessContext;
        initializeActionContext: WorkerActionContext;
        idName: string;
        destroy: () => void;
        storage: DurableObjectStorage;
    }): Promise<DatabaseGroupDurableObject> {
        const databaseGroupId = idName as DatabaseGroupId;
        await runDatabaseDurableObjectSqlMigrations(storage);
        const durableObjectStorage = new DatabaseDurableObjectStorage(storage);

        // The group's private salt keys the registry's `table_name_hash` index (see
        // `hashWithPrivateSalt`). It lives only in this durable object's key-value storage
        // — never in the replicated SQLite pages — so group members can't
        // dictionary-attack the name hashes. Generated once at the group's first boot;
        // losing it is recoverable (rotate + re-hash every table's name).
        let privateSalt = await storage.get<Uint8Array>(databasePrivateSaltStorageKey);
        if (privateSalt === undefined) {
            privateSalt = crypto.getRandomValues(new Uint8Array(32));
            await storage.put(databasePrivateSaltStorageKey, privateSalt);
        }

        const server = await DatabaseServer.create(durableObjectStorage, privateSalt);
        return new DatabaseGroupDurableObject({
            processContext,
            databaseGroupId,
            server,
            durableObjectStorage,
        });
    }

    private constructor({
        processContext,
        databaseGroupId,
        server,
        durableObjectStorage,
    }: {
        processContext: WorkerProcessContext;
        databaseGroupId: DatabaseGroupId;
        server: DatabaseServer;
        durableObjectStorage: DatabaseDurableObjectStorage;
    }) {
        this._processContext = processContext;
        this._databaseGroupId = databaseGroupId;
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
                const trackPages = searchParams.get("trackPages") !== "false";
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
                    databaseGroupId: this._databaseGroupId,
                    browserId,
                    connectionId,
                    browserPageTracker: this._browserPageTracker,
                    trackPages,
                });
            },
        );
    }

    public static parseRoute(url: URL): [string, DatabaseGroupDurableObjectRoute] {
        if (url.pathname === "/") return ["/", "Main"];
        if (url.pathname === "/action") return ["/action", "Action"];
        if (url.pathname === "/broadcast-table-metadata-realtime-event-transaction") {
            return [
                "/broadcast-table-metadata-realtime-event-transaction",
                "BroadcastTableMetadataRealtimeEvents",
            ];
        }
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
            case "BroadcastTableMetadataRealtimeEvents":
                return await this._handleBroadcastTableMetadataRealtimeEvents(context, request);
            case "NotFound":
                throw new NotFoundError("Route not found");
            default:
                throw exhaustive(route);
        }
    }

    private async _handleBroadcastTableMetadataRealtimeEvents(
        context: WorkerActionContext,
        request: Request,
    ): Promise<Response> {
        if (
            context.actor.serviceName !== "AppService" &&
            context.actor.serviceName !== "JobQueueService" &&
            context.actor.serviceName !== "ApiService"
        ) {
            throw new PermissionDeniedError(
                "Only some services can broadcast database table metadata realtime events",
            );
        }

        const {events, resolvedAccessPolicyByTableId} =
            DatabaseTableMetadataBroadcastRealtimeEventsSchema.deserialize(await request.json());

        this._durableObjectStorage.transactionSync(() => {
            for (const [tableId, accessPolicy] of resolvedAccessPolicyByTableId) {
                this._durableObjectStorage.setDatabaseTableAccessPolicy(tableId, accessPolicy);
            }
        });

        this._webSocketServer.sendEventToAll(context, {
            type: "TableMetadataChanged",
            events,
        });

        return new Response();
    }

    private async _handleAction(context: WorkerActionContext, request: Request): Promise<Response> {
        // This route is for server code only (`fetchDatabaseGroupAction`). Browser traffic
        // reaches the durable object with EdgeService-issued tokens — the edge forwards
        // any subpath — and must use the WebSocket protocol, whose connection-level
        // authorization and per-account enforcement this route has no equivalent of.
        if (!isTrustedDatabaseServiceActor(context.actor)) {
            throw new PermissionDeniedError(
                "Database actions over HTTP are restricted to internal services",
            );
        }

        const actionObject = DatabaseActionObjectSchema.deserialize(
            (await request.json()) as SchemaSerializedValue,
        );

        const actionResult = this._server.executeAction(context, actionObject);

        // Mutations through this route must reach realtime subscribers just like websocket
        // mutations, or every connected client keeps serving the pre-mutation state. No
        // client has this mutation queued optimistically, so a fresh `mutationId` is
        // delivered as an external mutation.
        const pageDiffs = buildDatabasePageDiffs(actionResult.changedPages, actionResult.readPages);
        if (pageDiffs.size > 0) {
            this._webSocketServer.sendEventToAll(this._processContext, {
                type: "PagesChanged",
                pageDiffs,
                mutationId: generateId<DatabaseMutationId>(),
            });
        }

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
