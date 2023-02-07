import {createDurableObject} from "~/server/cloudflare/create_durable_object";
import {WebSocketServer} from "~/server/cloudflare/web_socket_server";
import {ProcessContext} from "~/server/dynamo/context/process_context";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {authorizePostAccess} from "~/server/dynamo/posts_table";
import {PostRealtimeDurableObjectConnection} from "~/server/posts/post_realtime_durable_object_connection";
import {PostId, SpaceId} from "~/shared/id/types/id_types";
import {
    PostRealtimeMessageFromClient,
    PostRealtimeMessageFromClientSchema,
    PostRealtimeMessageFromServer,
    PostRealtimeMessageFromServerSchema,
} from "~/shared/posts/post_realtime_schema";
import {Schema} from "~/shared/schema/schema";

class PostRealtimeDurableObject {
    public static serviceName = "PostRealtimeService" as const;

    private readonly _context: ProcessContext;
    private readonly _spaceId: SpaceId;
    private readonly _postId: PostId;

    private readonly _webSocketServer: WebSocketServer<
        PostRealtimeMessageFromClient,
        PostRealtimeMessageFromServer,
        PostRealtimeDurableObjectConnection
    >;

    public static async initialize({
        processContext,
        initializeRequestContext,
        idName,
    }: {
        processContext: ProcessContext;
        initializeRequestContext: RequestContext;
        idName: string;
    }): Promise<PostRealtimeDurableObject> {
        const postId = Schema.id<PostId>().deserialize(idName);
        const {spaceId} = await authorizePostAccess(initializeRequestContext, postId);

        return new PostRealtimeDurableObject({
            context: processContext,
            postId,
            spaceId,
        });
    }

    private constructor({
        context,
        spaceId,
        postId,
    }: {
        context: ProcessContext;
        spaceId: SpaceId;
        postId: PostId;
    }) {
        // Propagate the post id to all logs for this durable object.
        context = context.tracer.withPropagatedData({context: {spaceId, postId}});

        this._context = context;
        this._spaceId = spaceId;
        this._postId = postId;

        this._webSocketServer = new WebSocketServer(
            this._context,
            PostRealtimeMessageFromClientSchema,
            PostRealtimeMessageFromServerSchema,
            ({sendMessage, iterateOtherConnections}) =>
                new PostRealtimeDurableObjectConnection({
                    postId,
                    sendMessage,
                    sendMessageToAll: (context, message) =>
                        this._webSocketServer.sendMessageToAll(context, message),
                    iterateOtherConnections,
                }),
        );
    }

    public async fetch(context: RequestContext, request: Request): Promise<Response> {
        // Propagate the post id to all logs for this durable object.
        context = context.tracer.withPropagatedData({
            context: {spaceId: this._spaceId, postId: this._postId},
        });

        return this._webSocketServer.upgrade(context, request);
    }
}

const PostRealtimeDurableObjectWrapper = createDurableObject(PostRealtimeDurableObject);
export {PostRealtimeDurableObjectWrapper as PostRealtimeDurableObject};
