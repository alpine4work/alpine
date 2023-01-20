import {createChannel} from "~/server/dynamo/channels_table";
import {
    createPost,
    createPostComment,
    deletePostComment,
    getPost,
    getPostComment,
    getPostCommentsFromEnd,
    getPostCommentsFromStart,
    updatePostCommentContent,
} from "~/server/dynamo/posts_table";
import {createTestContext} from "~/server/dynamo/test/create_test_context";
import {createTestSession} from "~/server/dynamo/test/create_test_session";
import {createTestSpace} from "~/server/dynamo/test/create_test_space";
import {testMessageImplementation} from "~/server/dynamo/test/test_messaging_implementation";
import {
    assertPostContent,
    PostContentProsemirrorSchema as schema,
} from "~/shared/content/post_content_schema";
import {PermissionDeniedError} from "~/shared/error/error";
import {generateId} from "~/shared/id/id";
import {PostId} from "~/shared/id/types/id_types";

const context = createTestContext();
const space = createTestSpace(context);
const session = createTestSession(context, space);
const otherSpace = createTestSpace(context);
const otherSession = createTestSession(context, otherSpace);

const testContent = assertPostContent(
    schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("test")])]),
);

test("can not create a post for a different space", async () => {
    const channel = await createChannel(context.request(session), {
        spaceId: space.id,
        name: "Test",
    });

    await expect(
        createPost(context.request(otherSession), {
            channelId: channel.id,
            content: testContent,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can create a post", async () => {
    const channel = await createChannel(context.request(session), {
        spaceId: space.id,
        name: "Test",
    });

    await createPost(context.request(session), {
        channelId: channel.id,
        content: testContent,
    });
});

test("can not get a post that does not exist", async () => {
    expect(await getPost(context.request(session), generateId())).toEqual(null);
});

test("can not get a post for a different space", async () => {
    const channel = await createChannel(context.request(session), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session), {
        channelId: channel.id,
        content: testContent,
    });

    await expect(getPost(context.request(otherSession), post.id)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can get a post", async () => {
    const channel = await createChannel(context.request(session), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session), {
        channelId: channel.id,
        content: testContent,
    });

    expect((await getPost(context.request(session), post.id))?.content.toJSON()).toEqual(
        testContent.toJSON(),
    );
});

testMessageImplementation<PostId>(context, {
    async createRoom(context, spaceId) {
        const channel = await createChannel(context, {
            spaceId,
            name: "Test",
        });

        const post = await createPost(context, {
            channelId: channel.id,
            content: testContent,
        });

        return {
            key: post.id,
            spaceId,
            messageCount: 0,
        };
    },
    async getRoom(context, postId) {
        const post = await getPost(context, postId);
        if (!post) return null;

        return {
            key: post.id,
            spaceId: post.spaceId,
            messageCount: post.commentCount,
        };
    },
    getMissingRoomKey() {
        return generateId();
    },
    async createMessage(context, {roomKey: postId, parentMessageId: parentCommentId, content}) {
        const comment = await createPostComment(context, {
            postId,
            parentCommentId,
            content,
        });

        return {
            id: comment.id,
            createdTime: comment.createdTime,
        };
    },
    async getMessage(context, {roomKey: postId, messageId: commentId}) {
        return getPostComment(context, {postId, commentId});
    },
    async updateMessageContent(context, {roomKey: postId, messageId: commentId, content}) {
        return updatePostCommentContent(context, {
            postId,
            commentId,
            content,
        });
    },
    async deleteMessage(context, {roomKey: postId, messageId: commentId}) {
        return deletePostComment(context, {postId, commentId});
    },
    async getMessagesFromStart(context, {roomKey: postId, limit, afterMessageId: afterCommentId}) {
        const {comments, hasMoreCommentsAfter} = await getPostCommentsFromStart(context, {
            postId,
            limit,
            afterCommentId,
        });
        return {
            messages: comments,
            hasMoreMessagesAfter: hasMoreCommentsAfter,
        };
    },
    async getMessagesFromEnd(context, {roomKey: postId, limit, beforeMessageId: beforeCommentId}) {
        const {comments, hasMoreCommentsBefore} = await getPostCommentsFromEnd(context, {
            postId,
            limit,
            beforeCommentId,
        });
        return {
            messages: comments,
            hasMoreMessagesBefore: hasMoreCommentsBefore,
        };
    },
});
