import {
    WorkerSessionActionContext,
    WorkerSessionActionContextModules,
} from "~/server/cloudflare/context/worker_action_context.js";
import {WorkerProcessContext} from "~/server/cloudflare/context/worker_process_context.js";
import {authorizePostAccessForDurableObject} from "~/server/forum/realtime/authorize_post_access_for_durable_object.js";
import {
    BackfillMessagesFunction,
    CreateMessageFunction,
    DeleteMessageFunction,
    MessagingRealtimeConnection,
    UpdateMessageContentFunction,
} from "~/server/messaging/realtime/messaging_realtime_connection.js";
import {WebSocketConnectionProcedures} from "~/server/web_socket/web_socket_server.js";
import {PostCommentModel} from "~/shared/forum/post_model.js";
import {PostRealtimeEvent, PostRealtimeProtocol} from "~/shared/forum/post_realtime_protocol.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {SafeFloatingPromise} from "~/shared/helpers/types/safe_floating_promise.js";
import {PostId, SpaceId, WebSocketConnectionId} from "~/shared/id/types/id_types.js";
import {
    backfillPostComments,
    createPostComment,
    deletePostComment,
    updatePostCommentContent,
} from "~/shared/rpc/forum_rpc_definitions.js";

export class PostRealtimeConnection {
    private readonly _connection: MessagingRealtimeConnection<PostId, PostCommentModel>;

    constructor({
        connectionId,
        spaceId,
        postId,
        sendEvent,
        sendEventToOthers,
        iterateOtherConnections,
    }: {
        connectionId: WebSocketConnectionId;
        spaceId: SpaceId;
        postId: PostId;
        sendEvent: (
            context: WorkerProcessContext,
            event: PostRealtimeEvent,
        ) => SafeFloatingPromise<void>;
        sendEventToOthers: (context: WorkerProcessContext, event: PostRealtimeEvent) => void;
        iterateOtherConnections: () => Iterable<PostRealtimeConnection>;
    }) {
        this._connection = new MessagingRealtimeConnection({
            connectionId,
            spaceId,
            roomKey: postId,

            sendEvent: (context, event) => sendEvent(context, {type: "Comments", event}),
            sendEventToOthers: (context, event) =>
                sendEventToOthers(context, {type: "Comments", event}),
            iterateOtherConnections: () =>
                mapIterable(iterateOtherConnections(), connection => connection._connection),

            createMessage,
            updateMessageContent,
            deleteMessage,
            backfillMessages,
        });
    }

    public async authorize(context: WorkerSessionActionContext) {
        await authorizePostAccessForDurableObject(context, this._connection.roomKey);
    }

    public readonly procedures: WebSocketConnectionProcedures<
        WorkerSessionActionContextModules,
        typeof PostRealtimeProtocol
    > = {
        backfillComments: async (
            context,
            {
                clientCommentCount: clientMessageCount,
                clientLastCommentChangeTime: clientLastMessageChangeTime,
                newCommentLimit: newMessageLimit,
            },
        ) => {
            const {
                messageCount: commentCount,
                lastMessageChangeTime: lastCommentChangeTime,
                newMessages: newComments,
                newOtherReferencedMessages: newOtherReferencedComments,
                messageChangesResult: commentChangesResult,
                typingStateByConnectionId,
            } = await this._connection.backfillMessages(context, {
                clientMessageCount,
                clientLastMessageChangeTime,
                newMessageLimit,
            });

            return {
                commentCount,
                lastCommentChangeTime,
                newComments,
                newOtherReferencedComments,
                commentChangesResult,
                typingStateByConnectionId,
            };
        },

        createComment: (context, {parentCommentIndex: parentMessageIndex, content, fileIds}) =>
            this._connection.createMessage(context, {parentMessageIndex, content, fileIds}),

        updateCommentContent: (context, {commentIndex: messageIndex, content}) =>
            this._connection.updateMessageContent(context, {messageIndex, content}),

        deleteComment: (context, {commentIndex: messageIndex}) =>
            this._connection.deleteMessage(context, {messageIndex}),

        startTypingInCommentInput: (context, input) =>
            this._connection.startTypingInMessageInput(context, input),
        stopTypingInCommentInput: (context, input) =>
            this._connection.stopTypingInMessageInput(context, input),
    };

    public async transformEvent(
        context: WorkerSessionActionContext,
        eventStub: PostRealtimeEvent,
    ): Promise<PostRealtimeEvent> {
        // TODO(calebmer, #content-references-privacy-fix): Implement a proper event stub.
        return eventStub;
    }

    public async handleClose(context: WorkerProcessContext) {
        return this._connection.handleClose(context);
    }
}

const createMessage: CreateMessageFunction<PostId, PostCommentModel> = async (
    context,
    {roomKey: postId, parentMessageIndex: parentCommentIndex, content, fileIds},
) => {
    const {comment} = await createPostComment(context, {
        postId,
        parentCommentIndex,
        content,
        fileIds,
    });

    return comment;
};

const updateMessageContent: UpdateMessageContentFunction<PostId> = async (
    context,
    {roomKey: postId, messageIndex: commentIndex, content},
) => {
    return updatePostCommentContent(context, {
        postId,
        commentIndex,
        content,
    });
};

const deleteMessage: DeleteMessageFunction<PostId> = async (
    context,
    {roomKey: postId, messageIndex: commentIndex},
) => {
    return deletePostComment(context, {postId, commentIndex});
};

const backfillMessages: BackfillMessagesFunction<PostId, PostCommentModel> = async (
    context,
    {
        roomKey: postId,
        clientMessageCount: clientCommentCount,
        clientLastMessageChangeTime: clientLastCommentChangeTime,
        newMessageLimit: newCommentLimit,
    },
) => {
    const {
        commentCount,
        lastCommentChangeTime,
        newComments,
        newOtherReferencedComments,
        commentChangesResult,
    } = await backfillPostComments(context, {
        postId,
        clientCommentCount,
        clientLastCommentChangeTime,
        newCommentLimit,
    });

    return {
        messageCount: commentCount,
        lastMessageChangeTime: lastCommentChangeTime,
        newMessages: newComments,
        newOtherReferencedMessages: newOtherReferencedComments,
        messageChangesResult: commentChangesResult,
        extra: null,
    };
};
