import {RequestContext} from "~/server/dynamo/context/request_context";
import {
    createChannel,
    deletePostComment,
    updatePostCommentContent,
} from "~/server/dynamo/forum_table";
import {createPost, createPostComment} from "~/server/dynamo/forum_table";
import {testMessagingRealtimeImplementation} from "~/server/dynamo/test_helpers/jest/test_messaging_realtime_implementation";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context";
import {PostRealtimeConnection} from "~/server/posts/post_realtime_connection";
import {createSimplePostContent} from "~/shared/content/post_content_schema";
import {cast} from "~/shared/helpers/control/cast";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable";
import {generateId} from "~/shared/id/id";
import {PostId} from "~/shared/id/types/id_types";
import {MessagingRealtimeMessageFromClient} from "~/shared/messaging/messaging_realtime_schema";
import {PostCommentModel} from "~/shared/models/post_model";

const context = createTestContext();

type TestPostRealtimeConnection = {
    readonly actualConnection: PostRealtimeConnection;
    handleMessage(
        context: RequestContext,
        message: MessagingRealtimeMessageFromClient,
    ): Promise<void>;
};

testMessagingRealtimeImplementation<PostId, TestPostRealtimeConnection>(context, {
    async createRoom(context, spaceId) {
        const channel = await createChannel(context, {
            spaceId,
            name: "Test",
        });

        const post = await createPost(context, {
            channelId: channel.id,
            content: createSimplePostContent("test"),
        });

        return {
            key: post.id,
            spaceId,
            createdTime: post.createdTime,
            messageCount: 0,
        };
    },
    createRealtimeConnection({
        spaceId,
        roomKey: postId,
        sendMessage,
        sendMessageToOthers,
        iterateOtherConnections,
    }) {
        const connection = new PostRealtimeConnection({
            connectionId: generateId(),
            spaceId,
            postId,
            sendMessage: (context, message) => {
                cast<"PostComments">(message.type);
                return sendMessage(context, message.message);
            },
            sendMessageToOthers: (context, message) => {
                cast<"PostComments">(message.type);
                return sendMessageToOthers(context, message.message);
            },
            iterateOtherConnections: () =>
                mapIterable(iterateOtherConnections(), connection => connection.actualConnection),
        });

        return {
            actualConnection: connection,
            handleMessage: (context, message) =>
                connection.handleMessage(context, {type: "PostComments", message}),
        };
    },
    createMessageModel({roomKey: postId, index, createdTime, author, payload}) {
        return new PostCommentModel({
            postId,
            index,
            createdTime,
            author,
            payload,
        });
    },
    async createMessage(
        context,
        {roomKey: postId, parentMessageIndex: parentPostCommentIndex, content},
    ) {
        const comment = await createPostComment(context, {
            postId,
            parentPostCommentIndex,
            content,
        });

        return {
            index: comment.index,
            createdTime: comment.createdTime,
        };
    },
    async updateMessageContent(
        context,
        {roomKey: postId, messageIndex: postCommentIndex, content},
    ) {
        return updatePostCommentContent(context, {
            postId,
            postCommentIndex,
            content,
        });
    },
    async deleteMessage(context, {roomKey: postId, messageIndex: postCommentIndex}) {
        return deletePostComment(context, {postId, postCommentIndex});
    },
});
