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
import {authorizeSiteAccessForDurableObject} from "~/server/sites/realtime/authorize_site_access_for_durable_object.js";
import {
    SiteRealtimeConnection,
    SiteRealtimeEventStub,
} from "~/server/sites/realtime/site_realtime_connection.js";
import {WebSocketServer} from "~/server/web_socket/web_socket_server.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SiteId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {
    SiteBroadcastRealtimeEventsSchema,
    SiteRealtimeProtocol,
} from "~/shared/sites/site_realtime_protocol.js";

type SiteRealtimeDurableObjectRoute = "Main" | "BroadcastRealtimeEvents" | "NotFound";

class SiteRealtimeDurableObject {
    public static readonly serviceName = "SiteRealtimeService";

    private readonly _processContext: WorkerProcessContext;
    private readonly _spaceId: SpaceId;
    private readonly _siteId: SiteId;

    private readonly _webSocketServer: WebSocketServer<
        WorkerProcessContextModules,
        WorkerSessionActionContextModules,
        typeof SiteRealtimeProtocol,
        SiteRealtimeEventStub,
        SiteRealtimeConnection
    >;

    public static async initialize({
        processContext,
        initializeActionContext,
        idName,
    }: {
        processContext: WorkerProcessContext;
        initializeActionContext: WorkerActionContext;
        idName: string;
    }): Promise<SiteRealtimeDurableObject> {
        const siteId = Schema.id<SiteId>().deserialize(idName);

        const {spaceId} = await authorizeSiteAccessForDurableObject(
            initializeActionContext,
            siteId,
        );

        return new SiteRealtimeDurableObject({
            processContext,
            siteId,
            spaceId,
        });
    }

    private constructor({
        processContext,
        spaceId,
        siteId,
    }: {
        processContext: WorkerProcessContext;
        spaceId: SpaceId;
        siteId: SiteId;
    }) {
        // Propagate the site id to all logs for this durable object.
        processContext = processContext.tracer.withPropagatedData({context: {spaceId, siteId}});

        this._processContext = processContext;
        this._spaceId = spaceId;
        this._siteId = siteId;

        this._webSocketServer = new WebSocketServer<
            WorkerProcessContextModules,
            WorkerSessionActionContextModules,
            typeof SiteRealtimeProtocol,
            SiteRealtimeEventStub,
            SiteRealtimeConnection
        >(this._processContext, SiteRealtimeProtocol, () => {
            return new SiteRealtimeConnection({
                siteId: this._siteId,
            });
        });
    }

    public static parseRoute(url: URL): [string, SiteRealtimeDurableObjectRoute] {
        if (url.pathname === "/") return ["/", "Main"];

        if (url.pathname === "/broadcast-realtime-event-transaction") {
            return ["/broadcast-realtime-event-transaction", "BroadcastRealtimeEvents"];
        }

        return ["/*", "NotFound"];
    }

    public async fetch(
        context: WorkerActionContext,
        request: Request,
        route: SiteRealtimeDurableObjectRoute,
    ): Promise<Response> {
        // Propagate the site id to all logs for this durable object.
        context = context.tracer.withPropagatedData({
            context: {spaceId: this._spaceId, siteId: this._siteId},
        });

        switch (route) {
            case "Main": {
                return this._webSocketServer.upgrade(context.actor.authorizeSession(), request);
            }
            case "BroadcastRealtimeEvents": {
                // Make sure a user can't POST from their browser to broadcast a realtime event
                // transaction. A POST request from a browser would be from the `AppClient` or
                // `EdgeService` service.
                if (
                    context.actor.serviceName !== "AppService" &&
                    context.actor.serviceName !== "JobQueueService"
                ) {
                    throw new PermissionDeniedError(
                        "Only `AppService` or `JobQueueService` can broadcast realtime event transactions",
                    );
                }

                const {events} = SiteBroadcastRealtimeEventsSchema.deserialize(
                    await request.json(),
                );

                this._webSocketServer.sendEventToAll(context, {
                    type: "RealtimeEvents",
                    events,
                });

                return new Response();
            }
            case "NotFound":
                throw new NotFoundError("Route not found");
            default:
                throw exhaustive(route);
        }
    }

    public connectForTest(context: WorkerSessionActionContext) {
        return this._webSocketServer.connectForTest(context);
    }
}

const SiteRealtimeDurableObjectWrapper = createDurableObject(SiteRealtimeDurableObject);
export {SiteRealtimeDurableObjectWrapper as SiteRealtimeDurableObject};
