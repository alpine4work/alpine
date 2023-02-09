import {
    createChannel,
    createPost,
    createPostComment,
    deletePostComment,
    getChannel,
    getPost,
    getPostComment,
    getPostCommentAuthors,
    getPostCommentsFromEnd,
    getPostCommentsFromStart,
    updatePostCommentContent,
} from "~/server/dynamo/forum_table";
import {createTestContext} from "~/server/dynamo/test/create_test_context";
import {createTestSession} from "~/server/dynamo/test/create_test_session";
import {createTestSpace} from "~/server/dynamo/test/create_test_space";
import {testMessagingImplementation} from "~/server/dynamo/test/test_messaging_implementation";
import {
    assertMessageContent,
    MessageContentProsemirrorSchema as messageSchema,
} from "~/shared/content/message_content_schema";
import {
    assertPostContent,
    PostContentProsemirrorSchema as schema,
} from "~/shared/content/post_content_schema";
import {PermissionDeniedError} from "~/shared/error/error";
import {generateId} from "~/shared/id/id";
import {PostId} from "~/shared/id/types/id_types";

const context = createTestContext();
const space = createTestSpace(context);
const session1 = createTestSession(context, space);
const session2 = createTestSession(context, space);
const session3 = createTestSession(context, space);
const session4 = createTestSession(context, space);
const session5 = createTestSession(context, space);
const session6 = createTestSession(context, space);
const session7 = createTestSession(context, space);
const session8 = createTestSession(context, space);
const otherSpace = createTestSpace(context);
const otherSession = createTestSession(context, otherSpace);

const testContent = assertPostContent(
    schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("test")])]),
);

const testMessageContent = assertMessageContent(
    messageSchema.node("doc", {}, [
        messageSchema.node("paragraph", {}, [messageSchema.text("test")]),
    ]),
);

test("can not create a channel for a different space", async () => {
    await expect(
        createChannel(context.request(session1), {
            spaceId: otherSpace.id,
            name: "Test",
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can create a channel", async () => {
    await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });
});

test("can not get a channel that does not exist", async () => {
    expect(await getChannel(context.request(otherSession), generateId())).toEqual(null);
});

test("can not get a channel for a different space", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    await expect(getChannel(context.request(otherSession), channel.id)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can get a channel", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    expect((await getChannel(context.request(session1), channel.id))?.name).toEqual("Test");
});

test("can not create a post for a different space", async () => {
    const channel = await createChannel(context.request(session1), {
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
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });
});

test("can not get a post that does not exist", async () => {
    expect(await getPost(context.request(session1), generateId())).toEqual(null);
});

test("can not get a post for a different space", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await expect(getPost(context.request(otherSession), post.id)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can get a post", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    expect((await getPost(context.request(session1), post.id))?.content.toJSON()).toEqual(
        testContent.toJSON(),
    );
});

test("can get the comment authors on a post", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    expect(
        await getPostCommentAuthors(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([]);

    await createPostComment(context.request(session1), {
        postId: post.id,
        parentCommentIndex: null,
        content: testMessageContent,
    });

    expect(
        await getPostCommentAuthors(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([session1.account]);

    await createPostComment(context.request(session2), {
        postId: post.id,
        parentCommentIndex: null,
        content: testMessageContent,
    });

    await createPostComment(context.request(session3), {
        postId: post.id,
        parentCommentIndex: null,
        content: testMessageContent,
    });

    expect(
        await getPostCommentAuthors(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([session1.account, session2.account, session3.account]);

    await createPostComment(context.request(session4), {
        postId: post.id,
        parentCommentIndex: null,
        content: testMessageContent,
    });

    await createPostComment(context.request(session5), {
        postId: post.id,
        parentCommentIndex: null,
        content: testMessageContent,
    });

    await createPostComment(context.request(session6), {
        postId: post.id,
        parentCommentIndex: null,
        content: testMessageContent,
    });

    await createPostComment(context.request(session7), {
        postId: post.id,
        parentCommentIndex: null,
        content: testMessageContent,
    });

    await createPostComment(context.request(session8), {
        postId: post.id,
        parentCommentIndex: null,
        content: testMessageContent,
    });

    expect(
        await getPostCommentAuthors(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        session1.account,
        session2.account,
        session3.account,
        session4.account,
        session5.account,
        session6.account,
        session7.account,
        session8.account,
    ]);

    await deletePostComment(context.request(session3), {
        postId: post.id,
        commentIndex: 2,
    });

    expect(
        await getPostCommentAuthors(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        session1.account,
        session2.account,
        session3.account,
        session4.account,
        session5.account,
        session6.account,
        session7.account,
        session8.account,
    ]);

    expect(
        await getPostCommentAuthors(context.request(session1), {postId: post.id, limit: 5}),
    ).toEqual([
        session1.account,
        session2.account,
        session3.account,
        session4.account,
        session5.account,
    ]);
});

test("can not get the comment authors in another space", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await expect(
        getPostCommentAuthors(context.request(otherSession), {postId: post.id, limit: 100}),
    ).rejects.toThrow(PermissionDeniedError);

    await createPostComment(context.request(session2), {
        postId: post.id,
        parentCommentIndex: null,
        content: testMessageContent,
    });

    await expect(
        getPostCommentAuthors(context.request(otherSession), {postId: post.id, limit: 100}),
    ).rejects.toThrow(PermissionDeniedError);
});

testMessagingImplementation<PostId>(context, {
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
    async updateMessageContent(context, {roomKey: postId, messageIndex: commentIndex, content}) {
        return updatePostCommentContent(context, {
            postId,
            commentIndex,
            content,
        });
    },
    async deleteMessage(context, {roomKey: postId, messageIndex: commentIndex}) {
        await deletePostComment(context, {postId, commentIndex});
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
        const {commentCount, comments} = await getPostCommentsFromStart(context, {
            postId,
            limit,
            afterCommentIndex,
            beforeCommentIndex,
        });
        return {
            messageCount: commentCount,
            messages: comments,
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
        const {commentCount, comments} = await getPostCommentsFromEnd(context, {
            postId,
            limit,
            afterCommentIndex,
            beforeCommentIndex,
        });
        return {
            messageCount: commentCount,
            messages: comments,
        };
    },
});
