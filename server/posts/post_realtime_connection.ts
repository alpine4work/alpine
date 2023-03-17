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
import {PostId, SpaceId} from "~/shared/id/types/id_types";
import {PostCommentModel} from "~/shared/models/post_model";
import {
    PostRealtimeMessageFromClient,
    PostRealtimeMessageFromServer,
} from "~/shared/posts/post_realtime_schema";

export class PostRealtimeConnection {
    private readonly _messaging: MessagingRealtimeConnection<PostId, PostCommentModel>;

    constructor({
        spaceId,
        postId,
        sendMessage,
        iterateOtherConnections,
    }: {
        spaceId: SpaceId;
        postId: PostId;
        sendMessage: (context: ProcessContext, message: PostRealtimeMessageFromServer) => void;
        iterateOtherConnections: () => Iterable<PostRealtimeConnection>;
    }) {
        this._messaging = new MessagingRealtimeConnection({
            spaceId,
            roomKey: postId,

            sendMessage: (context, message) =>
                sendMessage(context, {type: "PostComments", message}),
            iterateOtherConnections: () =>
                mapIterable(iterateOtherConnections(), connection => connection._messaging),

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

        return this._messaging.handleMessage(context, message.message);
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
    {roomKey: postId, parentMessageIndex: parentPostCommentIndex, content},
) => {
    const comment = await createPostComment(context, {
        postId,
        parentPostCommentIndex,
        content,
    });

    return {
        index: comment.index,
        createdTime: comment.createdTime,
    };
};

const updateMessageContent: UpdateMessageContentFunction<PostId> = async (
    context,
    {roomKey: postId, messageIndex: postCommentIndex, content},
) => {
    return updatePostCommentContent(context, {
        postId,
        postCommentIndex,
        content,
    });
};

const deleteMessage: DeleteMessageFunction<PostId> = async (
    context,
    {roomKey: postId, messageIndex: postCommentIndex},
) => {
    return deletePostComment(context, {postId, postCommentIndex});
};

const backfillMessages: BackfillMessagesFunction<PostId, PostCommentModel> = async (
    context,
    {
        roomKey: postId,
        clientMessageCount: clientPostCommentCount,
        clientLastMessageChangeTime: clientLastPostCommentChangeTime,
        newMessageLimit: newPostCommentLimit,
    },
) => {
    const {
        postCommentCount,
        lastPostCommentChangeTime,
        newPostComments,
        newOtherReferencedPostComments,
        postCommentChangesResult,
    } = await backfillPostComments(context, {
        postId,
        clientPostCommentCount,
        clientLastPostCommentChangeTime,
        newPostCommentLimit,
    });
    return {
        messageCount: postCommentCount,
        lastMessageChangeTime: lastPostCommentChangeTime,
        newMessages: newPostComments,
        newOtherReferencedMessages: newOtherReferencedPostComments,
        messageChangesResult: postCommentChangesResult,
    };
};
