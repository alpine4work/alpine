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
import {buildDatabasePageDiffs} from "~/server/databases/build_database_page_diffs.js";
import {
    DatabaseDurableObjectConnection,
    DatabaseRealtimeEventStub,
} from "~/server/databases/database_durable_object_connection.js";
import {DatabaseServer} from "~/server/databases/database_server.js";
import {isInternalDatabaseServiceActor} from "~/server/databases/is_internal_database_service_actor.js";
import {WebSocketServer} from "~/server/web_socket/web_socket_server.js";
import {DatabaseActionFetchResponseSchema} from "~/shared/databases/database_action_fetch_schema.js";
import {DatabaseActionObjectSchema} from "~/shared/databases/database_actions.js";
import {
    DatabaseRealtimeProtocol,
    DatabaseTableMetadataBroadcastRealtimeEventsSchema,
} from "~/shared/databases/database_realtime_protocol.js";
import {databaseMainTableId} from "~/shared/databases/sqlite_constants.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import type {DatabaseGroupId, DatabaseMutationId} from "~/shared/id/types/id_types.open_source.js";
import {
    authorizeDatabaseGroupAccess,
    getDatabaseGroupAccessPolicyReplicas,
} from "~/shared/rpc/database_tables_rpc_definitions.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.open_source.js";

type DatabaseGroupDurableObjectRoute =
    | "Main"
    | "Action"
    | "BroadcastTableMetadataRealtimeEvents"
    | "NotFound";

/**
 * How often the durable object reconciles its per-table access policy copies
 * against DynamoDB. The push paths (`DatabasesRynamo.broadcastEvents` and the
 * search index sync) are best-effort, so this pull is the delivery guarantee: a
 * lost push, or a site policy change with no table metadata write, heals within
 * one interval. Connection re-authorization runs on roughly the same cadence, so a
 * refresh piggybacks on about every other re-auth.
 */
const databaseTableAccessPolicyRefreshIntervalMs = 2 * 60 * 1000;

/**
 * How many tables one `getDatabaseGroupAccessPolicyReplicas` call covers. Matches
 * DynamoDB's 100-item batch-read limit so one refresh batch resolves in one
 * DynamoDB round trip.
 */
const tableAccessPolicyRefreshBatchSize = 100;

class DatabaseGroupDurableObject {
    public static readonly serviceName = "DatabaseGroupService";

    private readonly server: DatabaseServer;
    private readonly processContext: WorkerProcessContext;
    private readonly databaseGroupId: DatabaseGroupId;
    private lastTableAccessPolicyRefreshTime = 0;

    private readonly webSocketServer: WebSocketServer<
        WorkerProcessContextModules,
        WorkerSessionActionContextModules,
        typeof DatabaseRealtimeProtocol,
        DatabaseRealtimeEventStub,
        DatabaseDurableObjectConnection
    >;

    public static async initialize({
        processContext,
        initializeActionContext,
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
        const server = await DatabaseServer.create(storage);
        const durableObject = new DatabaseGroupDurableObject({
            processContext,
            databaseGroupId,
            server,
        });
        // A wake can follow arbitrarily long hibernation, during which every push was
        // lost, so reconcile immediately in the background without delaying the waking
        // request.
        durableObject.maybeRefreshTableAccessPolicies(initializeActionContext);
        return durableObject;
    }

    private constructor({
        processContext,
        databaseGroupId,
        server,
    }: {
        processContext: WorkerProcessContext;
        databaseGroupId: DatabaseGroupId;
        server: DatabaseServer;
    }) {
        this.processContext = processContext;
        this.databaseGroupId = databaseGroupId;
        this.server = server;

        this.webSocketServer = new WebSocketServer<
            WorkerProcessContextModules,
            WorkerSessionActionContextModules,
            typeof DatabaseRealtimeProtocol,
            DatabaseRealtimeEventStub,
            DatabaseDurableObjectConnection
        >(
            this.processContext,
            DatabaseRealtimeProtocol,
            ({sendEvent, sendEventToAllAndWaitForOne}) => {
                return new DatabaseDurableObjectConnection({
                    server: this.server,
                    sendEventToAllAndWaitForOne: event =>
                        sendEventToAllAndWaitForOne(this.processContext, event),
                    sendEventToSelf: event => sendEvent(this.processContext, event),
                    databaseGroupId: this.databaseGroupId,
                    maybeRefreshTableAccessPolicies: context =>
                        this.maybeRefreshTableAccessPolicies(context),
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
                return await this.webSocketServer.upgrade(
                    context.actor.authorizeSession(),
                    request,
                );
            case "Action":
                return await this.handleAction(context, request);
            case "BroadcastTableMetadataRealtimeEvents":
                return await this.handleBroadcastTableMetadataRealtimeEvents(context, request);
            case "NotFound":
                throw new NotFoundError("Route not found");
            default:
                throw exhaustive(route);
        }
    }

    private async handleBroadcastTableMetadataRealtimeEvents(
        context: WorkerActionContext,
        request: Request,
    ): Promise<Response> {
        if (!isInternalDatabaseServiceActor(context.actor)) {
            throw new PermissionDeniedError(
                "Only some services can broadcast database table metadata realtime events",
            );
        }

        const {events, resolvedAccessPolicyByTableId} =
            DatabaseTableMetadataBroadcastRealtimeEventsSchema.deserialize(await request.json());

        this.server.transactionSync(() => {
            for (const [tableId, replica] of resolvedAccessPolicyByTableId) {
                this.server.setDatabaseTableAccessPolicy(
                    tableId,
                    replica.accessPolicy,
                    replica.revision,
                );
            }
        });

        this.webSocketServer.sendEventToAll(context, {
            type: "TableMetadataChanged",
            events,
        });

        return new Response();
    }

    /**
     * Kick off a background reconciliation of the per-table access policy copies,
     * throttled to one pass per {@link databaseTableAccessPolicyRefreshIntervalMs}.
     * Called on wake (from {@link initialize}, since hibernation can outlast any push)
     * and from connection (re-)authorization while connections are active. Never
     * blocks the caller.
     */
    private maybeRefreshTableAccessPolicies(context: WorkerActionContext): void {
        const now = Date.now();
        if (
            now - this.lastTableAccessPolicyRefreshTime <
            databaseTableAccessPolicyRefreshIntervalMs
        ) {
            return;
        }
        this.lastTableAccessPolicyRefreshTime = now;
        // A failed pass logs through `waitUntil` and the next interval retries.
        context.process.waitUntil(this.refreshTableAccessPolicies(context));
    }

    private async refreshTableAccessPolicies(context: WorkerActionContext): Promise<void> {
        // Join tables derive access from their sides and the main table is a public
        // registry with hardcoded access, so only user tables have policy copies to
        // reconcile.
        const tableIds = this.server
            .listDatabaseTables()
            .filter(table => table.kind === "Table" && table.tableId !== databaseMainTableId)
            .map(table => table.tableId);

        // Sequential batches bound the request payloads and the DynamoDB read burst for
        // groups with many tables. Each batch commits on arrival, so a failed later batch
        // keeps the earlier batches' progress.
        for (
            let batchStart = 0;
            batchStart < tableIds.length;
            batchStart += tableAccessPolicyRefreshBatchSize
        ) {
            const {replicaByTableId} = await getDatabaseGroupAccessPolicyReplicas(context, {
                databaseGroupId: this.databaseGroupId,
                tableIds: tableIds.slice(
                    batchStart,
                    batchStart + tableAccessPolicyRefreshBatchSize,
                ),
            });

            // The monotonic revision guard inside `setDatabaseTableAccessPolicy` drops
            // replicas that lost a race against a fresher push.
            this.server.transactionSync(() => {
                for (const [tableId, replica] of replicaByTableId) {
                    this.server.setDatabaseTableAccessPolicy(
                        tableId,
                        replica.accessPolicy,
                        replica.revision,
                    );
                }
            });
        }
    }

    private async handleAction(context: WorkerActionContext, request: Request): Promise<Response> {
        // This route is for server code only (`fetchDatabaseGroupAction`). Browser traffic
        // reaches the durable object with EdgeService-issued tokens — the edge forwards
        // any subpath — and must use the WebSocket protocol, whose connection-level
        // authorization and per-account enforcement this route has no equivalent of.
        if (!isInternalDatabaseServiceActor(context.actor)) {
            throw new PermissionDeniedError(
                "Database actions over HTTP are restricted to internal services",
            );
        }

        // Internal-service provenance only establishes that the request came through a
        // trusted server transport; it does not authorize the forwarded actor to read this
        // database group. Re-run the same space-level check used by WebSocket connections
        // before executing any action. In particular, the per-table policy copies
        // intentionally use `getAccountAccessLevelAssumingSpaceAccess`, so they must never
        // be evaluated until this prerequisite has been established.
        await authorizeDatabaseGroupAccess(context, {
            databaseGroupId: this.databaseGroupId,
        });

        const actionObject = DatabaseActionObjectSchema.deserialize(
            (await request.json()) as SchemaSerializedValue,
        );

        const actionResult = this.server.executeAction(context, actionObject);
        const returnPages = new URL(request.url).searchParams.get("returnPages") !== "false";

        // Mutations through this route must reach realtime subscribers just like websocket
        // mutations, or every connected client keeps serving the pre-mutation state. No
        // client has this mutation queued optimistically, so a fresh `mutationId` is
        // delivered as an external mutation.
        const pageDiffs = buildDatabasePageDiffs(
            actionResult.changedPages,
            actionResult.readPages,
            actionResult.snapshotVersion,
        );
        if (pageDiffs.size > 0) {
            this.webSocketServer.sendEventToAll(this.processContext, {
                type: "PagesChanged",
                pageDiffs,
                mutationId: generateId<DatabaseMutationId>(),
            });
        }

        return new Response(
            JSON.stringify(
                DatabaseActionFetchResponseSchema.serialize({
                    result: {name: actionObject.name, output: actionResult.result} as any,
                    readPages: returnPages ? actionResult.readPages : new Map(),
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
        return this.webSocketServer.connectForTest(context, options);
    }
}

const DatabaseGroupDurableObjectWrapper = createDurableObject(DatabaseGroupDurableObject);
export {DatabaseGroupDurableObjectWrapper as DatabaseGroupDurableObject};
