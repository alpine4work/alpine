import {
    WorkerActionContext,
    WorkerSessionActionContext,
} from "~/server/cloudflare/context/worker_action_context.js";
import {WorkerProcessContext} from "~/server/cloudflare/context/worker_process_context.js";
import {createDurableObject} from "~/server/cloudflare/create_durable_object.js";
import {WebSocketServer} from "~/server/cloudflare/web_socket_server.js";
import {PostRealtimeConnection} from "~/server/forum/post_realtime_connection.js";
import {ContextCache} from "~/shared/context/cache_context_module.js";
import {NotFoundError} from "~/shared/error/error.js";
import {PostRealtimeProtocol} from "~/shared/forum/post_realtime_protocol.js";
import {PostId, SpaceId} from "~/shared/id/types/id_types.js";
import {authorizePostAccess as actuallyAuthorizePostAccess} from "~/shared/rpc/forum_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";

class PostRealtimeDurableObject {
    public static readonly serviceName = "PostRealtimeService";

    private readonly _processContext: WorkerProcessContext;
    private readonly _spaceId: SpaceId;
    private readonly _postId: PostId;

    private readonly _webSocketServer: WebSocketServer<
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
        const {spaceId} = await authorizePostAccess(initializeActionContext, postId);

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

        this._webSocketServer = new WebSocketServer(
            this._processContext,
            PostRealtimeProtocol,
            async ({
                connectActionContext,
                connectionId,
                sendEvent,
                sendEventToOthers,
                iterateOtherConnections,
            }) => {
                await authorizePostAccess(connectActionContext, postId);

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

    public async fetch(context: WorkerActionContext, request: Request): Promise<Response> {
        // Propagate the post id to all logs for this durable object.
        context = context.tracer.withPropagatedData({
            context: {spaceId: this._spaceId, postId: this._postId},
        });

        const url = new URL(request.url);
        if (url.pathname !== "/") throw new NotFoundError("Unexpected path");
        return this._webSocketServer.upgrade(context.actor.authorizeSession(), request);
    }

    public connectForTest(context: WorkerSessionActionContext) {
        return this._webSocketServer.connectForTest(context);
    }
}

const PostRealtimeDurableObjectWrapper = createDurableObject(PostRealtimeDurableObject);
export {PostRealtimeDurableObjectWrapper as PostRealtimeDurableObject};

const PostAccessCache = new ContextCache<PostId, {spaceId: SpaceId}>();

function authorizePostAccess(context: WorkerActionContext, postId: PostId) {
    // Authorize chat access once per action then cache the result.
    return PostAccessCache.get(context, postId, () =>
        actuallyAuthorizePostAccess(context, {postId}),
    );
}
