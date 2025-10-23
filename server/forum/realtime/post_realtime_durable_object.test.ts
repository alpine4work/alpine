import {createTestWorkerContext} from "~/server/cloudflare/test_helpers/create_test_worker_context.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {createChannel} from "~/server/forum/data/create_channel.js";
import {createPost} from "~/server/forum/data/create_post.js";
import {PostRealtimeDurableObject} from "~/server/forum/realtime/post_realtime_durable_object.js";
import {
    testMessagingRealtimeImplementation,
    testMessagingRealtimeImplementationSearchInjection,
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

const context = createTestWorkerContext({
    documentsInjection,
    searchInjection: testMessagingRealtimeImplementationSearchInjection,
});
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
            getConnection: () => connection.connection.getConnectionForTest(),
            procedures: {
                backfillMessages: async ({
                    checkpoint,
                    clientMessageCount: clientCommentCount,
                    newMessageLimit: newCommentLimit,
                }) => {
                    const {
                        commentCount: messageCount,
                        newComments: newMessages,
                        newOtherReferencedComments: newOtherReferencedMessages,
                        commentUpdatesResult: messageUpdatesResult,
                        typingStateByConnectionId,
                    } = await connection.procedures.backfillComments({
                        checkpoint,
                        clientCommentCount,
                        newCommentLimit,
                    });
                    return {
                        messageCount,
                        newMessages,
                        newOtherReferencedMessages,
                        messageUpdatesResult,
                        typingStateByConnectionId,
                    };
                },
                createMessage: ({parent, content, fileIds}) =>
                    connection.procedures.createComment({parent, content, fileIds}),
                updateMessageContent: ({messageIndex: commentIndex, contentVersion, steps}) =>
                    connection.procedures.updateCommentContent({
                        commentIndex,
                        contentVersion,
                        steps,
                    }),
                deleteMessage: ({messageIndex: commentIndex}) =>
                    connection.procedures.deleteComment({commentIndex}),
                setMessageReaction: ({messageIndex: commentIndex, contentVersion, pos, reaction}) =>
                    connection.procedures.setCommentReaction({
                        commentIndex,
                        contentVersion,
                        pos,
                        reaction,
                    }),
                deleteMessageReaction: ({messageIndex: commentIndex, contentVersion, pos}) =>
                    connection.procedures.deleteCommentReaction({
                        commentIndex,
                        contentVersion,
                        pos,
                    }),
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
    createMessageModel({roomKey: postId, index, version, createdTime, author, payload}) {
        return new PostCommentModel({
            postId,
            index,
            version,
            createdTime,
            author,
            payload,
            stream: null,
        });
    },
    createMessage(context, {roomKey: postId, parent, content, fileIds}) {
        return createPostComment(context, {
            postId,
            parent,
            content,
            fileIds,
        });
    },
    updateMessageContent(
        context,
        {roomKey: postId, messageIndex: commentIndex, contentVersion, steps},
    ) {
        return updatePostCommentContent(context, {
            postId,
            commentIndex,
            contentVersion,
            steps,
        });
    },
    deleteMessage(context, {roomKey: postId, messageIndex: commentIndex}) {
        return deletePostComment(context, {postId, commentIndex});
    },
});
