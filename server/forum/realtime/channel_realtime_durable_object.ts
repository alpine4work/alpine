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
import {authorizeChannelAccessForDurableObject} from "~/server/forum/realtime/authorize_channel_access_for_durable_object.js";
import {ChannelRealtimeConnection} from "~/server/forum/realtime/channel_realtime_connection.js";
import {WebSocketServer} from "~/server/web_socket/web_socket_server.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {
    ChannelBroadcastRealtimeEventTransactionSchema,
    ChannelRealtimeEvent,
    ChannelRealtimeProtocol,
} from "~/shared/forum/channel_realtime_protocol.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {ChannelId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

type ChannelRealtimeDurableObjectRoute = "Main" | "BroadcastRealtimeEventTransaction" | "NotFound";

class ChannelRealtimeDurableObject {
    public static readonly serviceName = "ChannelRealtimeService";

    private readonly _processContext: WorkerProcessContext;
    private readonly _spaceId: SpaceId;
    private readonly _channelId: ChannelId;

    private readonly _webSocketServer: WebSocketServer<
        WorkerProcessContextModules,
        WorkerSessionActionContextModules,
        typeof ChannelRealtimeProtocol,
        // TODO(calebmer, #content-references-privacy-fix): Implement a proper event stub.
        ChannelRealtimeEvent,
        ChannelRealtimeConnection
    >;

    public static async initialize({
        processContext,
        initializeActionContext,
        idName,
    }: {
        processContext: WorkerProcessContext;
        initializeActionContext: WorkerActionContext;
        idName: string;
    }): Promise<ChannelRealtimeDurableObject> {
        const channelId = Schema.id<ChannelId>().deserialize(idName);

        const {spaceId} = await authorizeChannelAccessForDurableObject(
            initializeActionContext,
            channelId,
        );

        return new ChannelRealtimeDurableObject({
            processContext,
            channelId,
            spaceId,
        });
    }

    private constructor({
        processContext,
        spaceId,
        channelId,
    }: {
        processContext: WorkerProcessContext;
        spaceId: SpaceId;
        channelId: ChannelId;
    }) {
        // Propagate the channel id to all logs for this durable object.
        processContext = processContext.tracer.withPropagatedData({context: {spaceId, channelId}});

        this._processContext = processContext;
        this._spaceId = spaceId;
        this._channelId = channelId;

        this._webSocketServer = new WebSocketServer<
            WorkerProcessContextModules,
            WorkerSessionActionContextModules,
            typeof ChannelRealtimeProtocol,
            // TODO(calebmer, #content-references-privacy-fix): Implement a proper event stub.
            ChannelRealtimeEvent,
            ChannelRealtimeConnection
        >(this._processContext, ChannelRealtimeProtocol, () => {
            return new ChannelRealtimeConnection({
                channelId: this._channelId,
            });
        });
    }

    public static parseRoute(url: URL): [string, ChannelRealtimeDurableObjectRoute] {
        if (url.pathname === "/") return ["/", "Main"];

        if (url.pathname === "/broadcast-realtime-event-transaction") {
            return ["/broadcast-realtime-event-transaction", "BroadcastRealtimeEventTransaction"];
        }

        return ["/*", "NotFound"];
    }

    public async fetch(
        context: WorkerActionContext,
        request: Request,
        route: ChannelRealtimeDurableObjectRoute,
    ): Promise<Response> {
        // Propagate the channel id to all logs for this durable object.
        context = context.tracer.withPropagatedData({
            context: {spaceId: this._spaceId, channelId: this._channelId},
        });

        switch (route) {
            case "Main": {
                return this._webSocketServer.upgrade(context.actor.authorizeSession(), request);
            }
            case "BroadcastRealtimeEventTransaction": {
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

                const {readTime, eventTransaction} =
                    ChannelBroadcastRealtimeEventTransactionSchema.deserialize(
                        await request.json(),
                    );

                // Forward the event transaction to all our connected clients...
                this._webSocketServer.sendEventToAll(context, {
                    type: "RealtimeEventTransaction",
                    readTime,
                    eventTransaction,
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

const ChannelRealtimeDurableObjectWrapper = createDurableObject(ChannelRealtimeDurableObject);
export {ChannelRealtimeDurableObjectWrapper as ChannelRealtimeDurableObject};
