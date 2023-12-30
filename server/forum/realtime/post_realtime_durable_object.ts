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
import {PostRealtimeConnection} from "~/server/forum/realtime/post_realtime_connection.js";
import {WebSocketServer} from "~/server/web_socket/web_socket_server.js";
import {NotFoundError} from "~/shared/error/error.js";
import {PostRealtimeProtocol} from "~/shared/forum/post_realtime_protocol.js";
import {PostId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

type PostRealtimeDurableObjectRoute = "Main" | "NotFound";

class PostRealtimeDurableObject {
    public static readonly serviceName = "PostRealtimeService";

    private readonly _processContext: WorkerProcessContext;
    private readonly _spaceId: SpaceId;
    private readonly _postId: PostId;

    private readonly _webSocketServer: WebSocketServer<
        WorkerProcessContextModules,
        WorkerSessionActionContextModules,
        typeof PostRealtimeProtocol,
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
            PostRealtimeConnection
        >(
            this._processContext,
            PostRealtimeProtocol,
            ({connectionId, sendEvent, sendEventToOthers, iterateOtherConnections}) => {
                return new PostRealtimeConnection({
                    connectionId,
                    spaceId,
                    postId,
                    sendEvent,
                    sendEventToOthers,
                    iterateOtherConnections,
                });
            },
        );
    }

    public static parseRoute(url: URL): [string, PostRealtimeDurableObjectRoute] {
        if (url.pathname !== "/") return ["/*", "NotFound"];
        return ["/", "Main"];
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

        if (route === "NotFound") throw new NotFoundError("Route not found");
        return this._webSocketServer.upgrade(context.actor.authorizeSession(), request);
    }

    public connectForTest(context: WorkerSessionActionContext) {
        return this._webSocketServer.connectForTest(context);
    }
}

const PostRealtimeDurableObjectWrapper = createDurableObject(PostRealtimeDurableObject);
export {PostRealtimeDurableObjectWrapper as PostRealtimeDurableObject};
