import {WebSocketConnectionProcedures} from "~/server/cloudflare/web_socket_server";
import {ProcessContext} from "~/server/dynamo/context/process_context";
import {
    backfillPostComments,
    createPostComment,
    deletePostComment,
    updatePostCommentContent,
} from "~/server/dynamo/forum_table";
import {
    BackfillMessagesFunction,
    CreateMessageFunction,
    CreateMessageModelFunction,
    DeleteMessageFunction,
    UpdateMessageContentFunction,
} from "~/server/messaging/messaging_implementation";
import {MessagingRealtimeConnection} from "~/server/messaging/messaging_realtime_connection";
import {PostCommentModel} from "~/shared/forum/post_model";
import {PostRealtimeEvent, PostRealtimeProtocol} from "~/shared/forum/post_realtime_protocol";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable";
import {PostId, SpaceId, WebSocketConnectionId} from "~/shared/id/types/id_types";

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
        sendEvent: (context: ProcessContext, event: PostRealtimeEvent) => void;
        sendEventToOthers: (context: ProcessContext, event: PostRealtimeEvent) => void;
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

            createMessageModel,
            createMessage,
            updateMessageContent,
            deleteMessage,
            backfillMessages,
        });
    }

    public readonly procedures: WebSocketConnectionProcedures<typeof PostRealtimeProtocol> = {
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

        createComment: (context, {parentCommentIndex: parentMessageIndex, content}) =>
            this._connection.createMessage(context, {parentMessageIndex, content}),

        updateCommentContent: (context, {commentIndex: messageIndex, content}) =>
            this._connection.updateMessageContent(context, {messageIndex, content}),

        deleteComment: (context, {commentIndex: messageIndex}) =>
            this._connection.deleteMessage(context, {messageIndex}),

        startTypingInCommentInput: (context, input) =>
            this._connection.startTypingInMessageInput(context, input),
        stopTypingInCommentInput: (context, input) =>
            this._connection.stopTypingInMessageInput(context, input),
    };

    public async handleClose(context: ProcessContext) {
        return this._connection.handleClose(context);
    }
}

const createMessageModel: CreateMessageModelFunction<PostId, PostCommentModel> = ({
    roomKey: postId,
    index,
    createdTime,
    author,
    payload,
}) => {
    return new PostCommentModel({
        postId,
        index,
        createdTime,
        author,
        payload,
    });
};

const createMessage: CreateMessageFunction<PostId> = async (
    context,
    {roomKey: postId, parentMessageIndex: parentCommentIndex, content},
) => {
    const comment = await createPostComment(context, {
        postId,
        parentCommentIndex,
        content,
    });

    return {
        index: comment.index,
        createdTime: comment.createdTime,
    };
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
    };
};
