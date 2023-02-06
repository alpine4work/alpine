import {createDurableObject} from "~/server/cloudflare/create_durable_object";
import {WebSocketServer} from "~/server/cloudflare/web_socket_server";
import {ProcessContext} from "~/server/dynamo/context/process_context";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {
    authorizePostAccess,
    createPostComment,
    deletePostComment,
    updatePostCommentContent,
} from "~/server/dynamo/posts_table";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
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
        destroy,
    }: {
        processContext: ProcessContext;
        initializeRequestContext: RequestContext;
        idName: string;
        destroy: () => void;
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
            ({}) => new PostRealtimeDurableObjectConnection({postId}),
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

class PostRealtimeDurableObjectConnection {
    private readonly _postId: PostId;

    constructor({postId}: {postId: PostId}) {
        this._postId = postId;
    }

    public async handleMessage(
        context: RequestContext,
        message: PostRealtimeMessageFromClient,
    ): Promise<void> {
        switch (message.type) {
            case "CreatePostComment": {
                await createPostComment(context, {
                    ...message,
                    postId: this._postId,
                });
                break;
            }
            case "UpdatePostCommentContent": {
                await updatePostCommentContent(context, {
                    ...message,
                    postId: this._postId,
                });
                break;
            }
            case "DeletePostComment": {
                await deletePostComment(context, {
                    ...message,
                    postId: this._postId,
                });
                break;
            }
            default:
                throw exhaustive(message);
        }
    }
}
