import {createTestWorkerContext} from "~/server/cloudflare/test_helpers/create_test_worker_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {createChannel, createPost} from "~/server/forum/data/forum_table.js";
import {PostRealtimeDurableObject} from "~/server/forum/realtime/post_realtime_durable_object.js";
import {
    testMessagingRealtimeImplementation,
    testMessagingRealtimeImplementationContextOptions,
} from "~/server/messaging/realtime/test_helpers/test_messaging_realtime_implementation.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {createSimplePostContent, emptyPostContent} from "~/shared/forum/post_content_schema.js";
import {PostCommentModel} from "~/shared/forum/post_model.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {generateId} from "~/shared/id/id.js";
import {PostId} from "~/shared/id/types/id_types.js";
import {
    createPostComment,
    deletePostComment,
    updatePostCommentContent,
} from "~/shared/rpc/forum_rpc_definitions.js";

const context = createTestWorkerContext(testMessagingRealtimeImplementationContextOptions);
const {connectForTest} = PostRealtimeDurableObject.test(context);
const space = createTestSpace(context);
const session = createTestSession(context, space);
const otherSpace = createTestSpace(context);
const otherSession = createTestSession(context, otherSpace);

test("can not connect to a post that does not exist", async () => {
    await expect(connectForTest(context.action(session), generateId())).rejects.toThrow(
        NotFoundError,
    );
});

test("can not connect to a post in a different space", async () => {
    const channel = await createChannel(context.action(session), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.action(session), {
        channelId: channel.id,
        content: emptyPostContent,
    });

    await expect(connectForTest(context.action(otherSession), post.id)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can not connect to an existing post durable object in a different space", async () => {
    const channel = await createChannel(context.action(session), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.action(session), {
        channelId: channel.id,
        content: emptyPostContent,
    });

    await connectForTest(context.action(session), post.id);

    await expect(connectForTest(context.action(otherSession), post.id)).rejects.toThrow(
        PermissionDeniedError,
    );
});

testMessagingRealtimeImplementation<PostId>(context, {
    async createRoom(sessions) {
        const channel = await createChannel(sessions[0].action(), {
            spaceId: sessions[0].space.id,
            name: "Test",
        });

        const post = await createPost(sessions[0].action(), {
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
    async connectForTest(context, roomKey) {
        const connection = await connectForTest(context, roomKey);

        return {
            procedures: {
                backfillMessages: async ({
                    clientMessageCount: clientCommentCount,
                    clientLastMessageChangeTime: clientLastCommentChangeTime,
                    newMessageLimit: newCommentLimit,
                }) => {
                    const {
                        commentCount: messageCount,
                        lastCommentChangeTime: lastMessageChangeTime,
                        newComments: newMessages,
                        newOtherReferencedComments: newOtherReferencedMessages,
                        commentChangesResult: messageChangesResult,
                        typingStateByConnectionId,
                    } = await connection.procedures.backfillComments({
                        clientCommentCount,
                        clientLastCommentChangeTime,
                        newCommentLimit,
                    });
                    return {
                        messageCount,
                        lastMessageChangeTime,
                        newMessages,
                        newOtherReferencedMessages,
                        messageChangesResult,
                        typingStateByConnectionId,
                    };
                },
                createMessage: ({parentMessageIndex: parentCommentIndex, content, fileIds}) =>
                    connection.procedures.createComment({parentCommentIndex, content, fileIds}),
                updateMessageContent: ({messageIndex: commentIndex, content}) =>
                    connection.procedures.updateCommentContent({commentIndex, content}),
                deleteMessage: ({messageIndex: commentIndex}) =>
                    connection.procedures.deleteComment({commentIndex}),
                startTypingInMessageInput: ({}) =>
                    connection.procedures.startTypingInCommentInput({}),
                stopTypingInMessageInput: ({}) =>
                    connection.procedures.stopTypingInCommentInput({}),
            },
            takeEvents: () => {
                return filterMapArray(connection.takeEvents(), event => {
                    if (event.type !== "Comments") return;
                    return event.event;
                });
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
    createMessage(
        context,
        {roomKey: postId, parentMessageIndex: parentCommentIndex, content, fileIds},
    ) {
        return createPostComment(context, {
            postId,
            parentCommentIndex,
            content,
            fileIds,
        });
    },
    updateMessageContent(context, {roomKey: postId, messageIndex: commentIndex, content}) {
        return updatePostCommentContent(context, {
            postId,
            commentIndex,
            content,
        });
    },
    deleteMessage(context, {roomKey: postId, messageIndex: commentIndex}) {
        return deletePostComment(context, {postId, commentIndex});
    },
});
