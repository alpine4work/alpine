import {
    createChannel,
    deletePostComment,
    updatePostCommentContent,
} from "~/server/dynamo/forum_table";
import {createPost, createPostComment} from "~/server/dynamo/forum_table";
import {
    TestMessagingRealtimeConnectionProcedures,
    testMessagingRealtimeImplementation,
} from "~/server/dynamo/test_helpers/jest/test_messaging_realtime_implementation";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context";
import {PostRealtimeConnection} from "~/server/posts/post_realtime_connection";
import {createSimplePostContent} from "~/shared/content/post_content_schema";
import {cast} from "~/shared/helpers/control/cast";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable";
import {generateId} from "~/shared/id/id";
import {PostId} from "~/shared/id/types/id_types";
import {PostCommentModel} from "~/shared/models/post_model";

const context = createTestContext();

type TestPostRealtimeConnection = {
    readonly actualConnection: PostRealtimeConnection;
    readonly procedures: TestMessagingRealtimeConnectionProcedures<PostCommentModel>;
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
        sendEvent,
        sendEventToOthers,
        iterateOtherConnections,
    }) {
        const connection = new PostRealtimeConnection({
            connectionId: generateId(),
            spaceId,
            postId,
            sendEvent: (context, event) => {
                cast<"Comments">(event.type);
                return sendEvent(context, event.event);
            },
            sendEventToOthers: (context, event) => {
                cast<"Comments">(event.type);
                return sendEventToOthers(context, event.event);
            },
            iterateOtherConnections: () =>
                mapIterable(iterateOtherConnections(), connection => connection.actualConnection),
        });

        return {
            actualConnection: connection,
            procedures: {
                backfillMessages: async (
                    context,
                    {
                        clientMessageCount: clientCommentCount,
                        clientLastMessageChangeTime: clientLastCommentChangeTime,
                        newMessageLimit: newCommentLimit,
                    },
                    span,
                ) => {
                    const {
                        commentCount: messageCount,
                        lastCommentChangeTime: lastMessageChangeTime,
                        newComments: newMessages,
                        newOtherReferencedComments: newOtherReferencedMessages,
                        commentChangesResult: messageChangesResult,
                        typingStateByConnectionId,
                    } = await connection.procedures.backfillComments(
                        context,
                        {clientCommentCount, clientLastCommentChangeTime, newCommentLimit},
                        span,
                    );
                    return {
                        messageCount,
                        lastMessageChangeTime,
                        newMessages,
                        newOtherReferencedMessages,
                        messageChangesResult,
                        typingStateByConnectionId,
                    };
                },
                createMessage: (context, {parentMessageIndex: parentCommentIndex, content}, span) =>
                    connection.procedures.createComment(
                        context,
                        {parentCommentIndex, content},
                        span,
                    ),
                updateMessageContent: (context, {messageIndex: commentIndex, content}, span) =>
                    connection.procedures.updateCommentContent(
                        context,
                        {commentIndex, content},
                        span,
                    ),
                deleteMessage: (context, {messageIndex: commentIndex}, span) =>
                    connection.procedures.deleteComment(context, {commentIndex}, span),
                startTypingInMessageInput: (context, {}, span) =>
                    connection.procedures.startTypingInCommentInput(context, {}, span),
                stopTypingInMessageInput: (context, {}, span) =>
                    connection.procedures.stopTypingInCommentInput(context, {}, span),
            },
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
        {roomKey: postId, parentMessageIndex: parentCommentIndex, content},
    ) {
        const comment = await createPostComment(context, {
            postId,
            parentCommentIndex,
            content,
        });

        return {
            index: comment.index,
            createdTime: comment.createdTime,
        };
    },
    async updateMessageContent(context, {roomKey: postId, messageIndex: commentIndex, content}) {
        return updatePostCommentContent(context, {
            postId,
            commentIndex,
            content,
        });
    },
    async deleteMessage(context, {roomKey: postId, messageIndex: commentIndex}) {
        return deletePostComment(context, {postId, commentIndex});
    },
});
