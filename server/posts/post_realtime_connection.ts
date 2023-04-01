import {ProcessContext} from "~/server/dynamo/context/process_context";
import {RequestContext} from "~/server/dynamo/context/request_context";
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
import {cast} from "~/shared/helpers/control/cast";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable";
import {PostId, SpaceId, WebSocketConnectionId} from "~/shared/id/types/id_types";
import {PostCommentModel} from "~/shared/models/post_model";
import {
    PostRealtimeMessageFromClient,
    PostRealtimeMessageFromServer,
} from "~/shared/posts/post_realtime_schema";

export class PostRealtimeConnection {
    private readonly _connection: MessagingRealtimeConnection<PostId, PostCommentModel>;

    constructor({
        connectionId,
        spaceId,
        postId,
        sendMessage,
        sendMessageToOthers,
        iterateOtherConnections,
    }: {
        connectionId: WebSocketConnectionId;
        spaceId: SpaceId;
        postId: PostId;
        sendMessage: (context: ProcessContext, message: PostRealtimeMessageFromServer) => void;
        sendMessageToOthers: (
            context: ProcessContext,
            message: PostRealtimeMessageFromServer,
        ) => void;
        iterateOtherConnections: () => Iterable<PostRealtimeConnection>;
    }) {
        this._connection = new MessagingRealtimeConnection({
            connectionId,
            spaceId,
            roomKey: postId,

            sendMessage: (context, message) =>
                sendMessage(context, {type: "PostComments", message}),
            sendMessageToOthers: (context, message) =>
                sendMessageToOthers(context, {type: "PostComments", message}),
            iterateOtherConnections: () =>
                mapIterable(iterateOtherConnections(), connection => connection._connection),

            createMessageModel,
            createMessage,
            updateMessageContent,
            deleteMessage,
            backfillMessages,
        });
    }

    public async handleMessage(
        context: RequestContext,
        message: PostRealtimeMessageFromClient,
    ): Promise<void> {
        // TypeScript will error if we ever add other message types here. At that point
        // this code should turn into a switch.
        cast<"PostComments">(message.type);

        return this._connection.handleMessage(context, message.message);
    }

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
