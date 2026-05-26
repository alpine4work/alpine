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
import {authorizePostAccessForDurableObject} from "~/server/forum/realtime/authorize_post_access_for_durable_object.js";
import {
    PostRealtimeConnection,
    PostRealtimeEventStub,
} from "~/server/forum/realtime/post_realtime_connection.js";
import {WebSocketServer} from "~/server/web_socket/web_socket_server.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {
    PostBroadcastRealtimeEventsSchema,
    PostRealtimeProtocol,
} from "~/shared/forum/post_realtime_protocol.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {PostId, SpaceId} from "~/shared/id/types/id_types.js";
import {
    MessagingRealtimeBroadcastCompleteMessageStreamRequestSchema,
    MessagingRealtimeBroadcastNewMessageRequestSchema,
    MessagingRealtimeBroadcastPutMessageStreamPartRequestSchema,
} from "~/shared/messaging/messaging_realtime_protocol.js";
import {Schema} from "~/shared/schema/schema.js";

type PostRealtimeDurableObjectRoute =
    | "Main"
    | "BroadcastRealtimeEvents"
    | "BroadcastNewMessage"
    | "BroadcastPutMessageStreamPart"
    | "BroadcastCompleteMessageStream"
    | "NotFound";

class PostRealtimeDurableObject {
    public static readonly serviceName = "PostRealtimeService";

    private readonly _processContext: WorkerProcessContext;
    private readonly _spaceId: SpaceId;
    private readonly _postId: PostId;

    private readonly _webSocketServer: WebSocketServer<
        WorkerProcessContextModules,
        WorkerSessionActionContextModules,
        typeof PostRealtimeProtocol,
        PostRealtimeEventStub,
        PostRealtimeConnection
    >;

    public static async initialize({
        processContext,
        initializeActionContext,
        idName,
    }: {
        processContext: WorkerProcessContext;
        initializeActionContext: WorkerActionContext;
        idName: string;
    }): Promise<PostRealtimeDurableObject> {
        const postId = Schema.id<PostId>().deserialize(idName);

        const {spaceId} = await authorizePostAccessForDurableObject(
            initializeActionContext,
            postId,
        );

        return new PostRealtimeDurableObject({
            processContext,
            postId,
            spaceId,
        });
    }

    private constructor({
        processContext,
        spaceId,
        postId,
    }: {
        processContext: WorkerProcessContext;
        spaceId: SpaceId;
        postId: PostId;
    }) {
        // Propagate the post id to all logs for this durable object.
        processContext = processContext.tracer.withPropagatedData({context: {spaceId, postId}});

        this._processContext = processContext;
        this._spaceId = spaceId;
        this._postId = postId;

        this._webSocketServer = new WebSocketServer<
            WorkerProcessContextModules,
            WorkerSessionActionContextModules,
            typeof PostRealtimeProtocol,
            PostRealtimeEventStub,
            PostRealtimeConnection
        >(
            this._processContext,
            PostRealtimeProtocol,
            ({accountId, connectionId, sendEvent, sendEventToOthers, iterateOtherConnections}) => {
                return new PostRealtimeConnection({
                    connectionId,
                    spaceId,
                    accountId,
                    postId,
                    sendEvent,
                    sendEventToOthers,
                    iterateOtherConnections,
                });
            },
        );
    }

    public static parseRoute(url: URL): [string, PostRealtimeDurableObjectRoute] {
        if (url.pathname === "/") return ["/", "Main"];

        if (url.pathname === "/broadcast-realtime-event-transaction") {
            return [url.pathname, "BroadcastRealtimeEvents"];
        }

        if (url.pathname === "/broadcast-new-message") {
            return [url.pathname, "BroadcastNewMessage"];
        }

        if (url.pathname === "/broadcast-put-message-stream-part") {
            return [url.pathname, "BroadcastPutMessageStreamPart"];
        }

        if (url.pathname === "/broadcast-complete-message-stream") {
            return [url.pathname, "BroadcastCompleteMessageStream"];
        }

        return ["/*", "NotFound"];
    }

    public async fetch(
        context: WorkerActionContext,
        request: Request,
        route: PostRealtimeDurableObjectRoute,
    ): Promise<Response> {
        // Propagate the post id to all logs for this durable object.
        context = context.tracer.withPropagatedData({
            context: {spaceId: this._spaceId, postId: this._postId},
        });

        switch (route) {
            case "NotFound": {
                throw new NotFoundError("Route not found");
            }
            case "Main": {
                return await this._webSocketServer.upgrade(
                    context.actor.authorizeSession(),
                    request,
                );
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

                const {events} = PostBroadcastRealtimeEventsSchema.deserialize(
                    await request.json(),
                );

                this._webSocketServer.sendEventToAll(context, {
                    type: "RealtimeEvents",
                    events,
                });

                return new Response();
            }
            case "BroadcastNewMessage": {
                if (request.method !== "POST") {
                    return new Response("405 Method Not Allowed", {
                        status: 405,
                        headers: {"content-type": "text/plain"},
                    });
                }

                const requestBody = MessagingRealtimeBroadcastNewMessageRequestSchema.deserialize(
                    await request.json(),
                );

                PostRealtimeConnection.broadcastNewMessage(context, requestBody, () =>
                    this._webSocketServer.iterateAllConnections(),
                );

                return new Response(null, {status: 200});
            }
            case "BroadcastPutMessageStreamPart": {
                if (request.method !== "POST") {
                    return new Response("405 Method Not Allowed", {
                        status: 405,
                        headers: {"content-type": "text/plain"},
                    });
                }

                const requestBody =
                    MessagingRealtimeBroadcastPutMessageStreamPartRequestSchema.deserialize(
                        await request.json(),
                    );

                PostRealtimeConnection.broadcastPutMessageStreamPart(context, requestBody, () =>
                    this._webSocketServer.iterateAllConnections(),
                );

                return new Response(null, {status: 200});
            }
            case "BroadcastCompleteMessageStream": {
                if (request.method !== "POST") {
                    return new Response("405 Method Not Allowed", {
                        status: 405,
                        headers: {"content-type": "text/plain"},
                    });
                }

                const requestBody =
                    MessagingRealtimeBroadcastCompleteMessageStreamRequestSchema.deserialize(
                        await request.json(),
                    );

                PostRealtimeConnection.broadcastCompleteMessageStream(context, requestBody, () =>
                    this._webSocketServer.iterateAllConnections(),
                );

                return new Response(null, {status: 200});
            }
            default:
                throw exhaustive(route);
        }
    }

    public connectForTest(context: WorkerSessionActionContext) {
        return this._webSocketServer.connectForTest(context);
    }
}

const PostRealtimeDurableObjectWrapper = createDurableObject(PostRealtimeDurableObject);
export {PostRealtimeDurableObjectWrapper as PostRealtimeDurableObject};
