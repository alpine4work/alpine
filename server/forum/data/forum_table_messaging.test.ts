import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    backfillPostComments,
    createChannel,
    createPost,
    createPostComment,
    deletePostComment,
    getPost,
    getPostComment,
    getPostCommentPayload,
    getPostCommentsFromEnd,
    getPostCommentsFromStart,
    updatePostCommentContent,
} from "~/server/forum/data/forum_table.js";
import {testMessagingImplementation} from "~/server/messaging/test_helpers/test_messaging_implementation.js";
import {createSimplePostContent} from "~/shared/forum/post_content_schema.js";
import {generateId} from "~/shared/id/id.js";
import {PostId} from "~/shared/id/types/id_types.js";

const context = createTestContext();

testMessagingImplementation<PostId>(context, {
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

    // TODO(calebmer): Implement when we can have private channels!
    createPrivateRoom: "Unimplemented",

    async getRoom(context, postId) {
        const post = await getPost(context, postId);
        return {
            key: post.id,
            spaceId: post.spaceId,
            createdTime: post.createdTime,
            messageCount: post.commentCount,
        };
    },
    getMissingRoomKey() {
        return generateId();
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
    async getMessage(context, {roomKey: postId, messageIndex: commentIndex}) {
        return getPostComment(context, {postId, commentIndex});
    },
    async getMessagePayload(context, {roomKey: postId, messageIndex: commentIndex}) {
        return (await getPostCommentPayload(context, {postId, commentIndex})).payload;
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
    async getMessagesFromStart(
        context,
        {
            roomKey: postId,
            limit,
            afterMessageIndex: afterCommentIndex,
            beforeMessageIndex: beforeCommentIndex,
        },
    ) {
        const {commentCount, comments, otherReferencedComments, lastCommentChangeTime} =
            await getPostCommentsFromStart(context, {
                postId,
                limit,
                afterCommentIndex,
                beforeCommentIndex,
            });
        return {
            messageCount: commentCount,
            messages: comments,
            otherReferencedMessages: otherReferencedComments,
            lastMessageChangeTime: lastCommentChangeTime,
        };
    },
    async getMessagesFromEnd(
        context,
        {
            roomKey: postId,
            limit,
            afterMessageIndex: afterCommentIndex,
            beforeMessageIndex: beforeCommentIndex,
        },
    ) {
        const {commentCount, comments, otherReferencedComments, lastCommentChangeTime} =
            await getPostCommentsFromEnd(context, {
                postId,
                limit,
                afterCommentIndex,
                beforeCommentIndex,
            });
        return {
            messageCount: commentCount,
            messages: comments,
            otherReferencedMessages: otherReferencedComments,
            lastMessageChangeTime: lastCommentChangeTime,
        };
    },
    async backfillMessages(
        context,
        {
            roomKey: postId,
            clientMessageCount: clientCommentCount,
            clientLastMessageChangeTime: clientLastCommentChangeTime,
            newMessageLimit: newCommentLimit,
        },
    ) {
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
    },
});
