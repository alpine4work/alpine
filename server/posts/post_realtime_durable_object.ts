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
import {PostCommentModel} from "~/shared/models/post_model";
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
            ({}) =>
                new PostRealtimeDurableObjectConnection({
                    postId,
                    sendMessageToAll: (context, message) =>
                        this._webSocketServer.sendMessageToAll(context, message),
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

class PostRealtimeDurableObjectConnection {
    private readonly _postId: PostId;
    private readonly _sendMessageToAll: (
        context: ProcessContext,
        message: PostRealtimeMessageFromServer,
    ) => void;

    constructor({
        postId,
        sendMessageToAll,
    }: {
        postId: PostId;
        sendMessageToAll: (context: ProcessContext, message: PostRealtimeMessageFromServer) => void;
    }) {
        this._postId = postId;
        this._sendMessageToAll = sendMessageToAll;
    }

    public async handleMessage(
        context: RequestContext,
        message: PostRealtimeMessageFromClient,
    ): Promise<void> {
        // TODO(calebmer): Message ordering??
        // TODO(calebmer): Backfilling??

        switch (message.type) {
            case "BackfillComments": {
                break;
            }
            case "CreatePostComment": {
                const {index, createdTime} = await createPostComment(context, {
                    ...message,
                    postId: this._postId,
                });

                this._sendMessageToAll(context, {
                    type: "CreatedPostComment",
                    comment: new PostCommentModel({
                        postId: this._postId,
                        index,
                        createdTime,
                        author: await context.auth.getAccount(),
                        payload: {
                            type: "Content",
                            parentMessageIndex: message.parentCommentIndex,
                            content: message.content,
                            contentUpdatedTime: null,
                        },
                    }),
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
