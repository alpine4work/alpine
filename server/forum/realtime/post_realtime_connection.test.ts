import {createTestWorkerContext} from "~/server/cloudflare/test_helpers/create_test_worker_context.js";
import {createChannel, createPost} from "~/server/forum/data/forum_table.js";
import {PostRealtimeConnection} from "~/server/forum/realtime/post_realtime_connection.js";
import {
    TestMessagingRealtimeConnectionProcedures,
    testMessagingRealtimeImplementation,
} from "~/server/messaging/realtime/test_helpers/test_messaging_realtime_implementation.js";
import {createSimplePostContent} from "~/shared/forum/post_content_schema.js";
import {PostCommentModel} from "~/shared/forum/post_model.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {generateId} from "~/shared/id/id.js";
import {PostId} from "~/shared/id/types/id_types.js";
import {
    createPostComment,
    deletePostComment,
    updatePostCommentContent,
} from "~/shared/rpc/forum_rpc_definitions.js";

const context = createTestWorkerContext();

type TestPostRealtimeConnection = {
    readonly actualConnection: PostRealtimeConnection;
    readonly procedures: TestMessagingRealtimeConnectionProcedures<PostCommentModel>;
};

testMessagingRealtimeImplementation<PostId, TestPostRealtimeConnection>(context, {
    async createRoom(context, space) {
        const channel = await createChannel(context, {
            spaceId: space.id,
            name: "Test",
        });

        const post = await createPost(context, {
            channelId: channel.id,
            content: createSimplePostContent("test"),
        });

        return {
            key: post.id,
            spaceId: space.id,
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
                if (event.type === "Comments") {
                    sendEvent(context, event.event);
                }
            },
            sendEventToOthers: (context, event) => {
                if (event.type === "Comments") {
                    sendEventToOthers(context, event.event);
                }
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
                createMessage: (
                    context,
                    {parentMessageIndex: parentCommentIndex, content, fileIds},
                    span,
                ) =>
                    connection.procedures.createComment(
                        context,
                        {parentCommentIndex, content, fileIds},
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
        {roomKey: postId, parentMessageIndex: parentCommentIndex, content, fileIds},
    ) {
        const {comment} = await createPostComment(context, {
            postId,
            parentCommentIndex,
            content,
            fileIds,
        });

        return comment;
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
