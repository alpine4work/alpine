import {
    createChannel,
    createPost,
    createPostComment,
    deletePostComment,
    getChannel,
    getChannelPosts,
    getPost,
    getPostCommentAuthors,
    getPostNotificationSubscribers,
    updateChannelDescription,
    updateChannelName,
    updatePostCommentContent,
    updatePostContent,
} from "~/server/dynamo/forum_table";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context";
import {createTestSession} from "~/server/dynamo/test_helpers/shared/create_test_session";
import {createTestSpace} from "~/server/dynamo/test_helpers/shared/create_test_space";
import {emptyContentReferences} from "~/shared/content/content_references";
import {InvalidArgumentError, NotFoundError, PermissionDeniedError} from "~/shared/error/error";
import {
    PostContentProsemirrorSchema,
    PostContentWithReferences,
    assertPostContent,
    createSimplePostContent,
} from "~/shared/forum/post_content_schema";
import {assert} from "~/shared/helpers/control/assert";
import {generateId} from "~/shared/id/id";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
    createSimpleMessageContent,
    emptyMessageContent,
} from "~/shared/messaging/message_content_schema";

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

const testContent1 = createSimplePostContent("test1");
const testContent2 = createSimplePostContent("test2");
const testContent3 = createSimplePostContent("test3");

const testContent1WithReferences: PostContentWithReferences = {
    doc: testContent1,
    references: emptyContentReferences,
};
const testContent2WithReferences: PostContentWithReferences = {
    doc: testContent2,
    references: emptyContentReferences,
};
const testContent3WithReferences: PostContentWithReferences = {
    doc: testContent3,
    references: emptyContentReferences,
};

const testMessageContent1 = createSimpleMessageContent("test1");
const testMessageContent2 = createSimpleMessageContent("test2");

test("can not create a channel for a different space", async () => {
    await expect(
        createChannel(context.action(session1), {
            spaceId: otherSpace.id,
            name: "Test",
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can create a channel", async () => {
    await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test",
    });
});

test("can not get a channel that does not exist", async () => {
    await expect(getChannel(context.action(otherSession), generateId())).rejects.toThrow(
        NotFoundError,
    );
});

test("can not get a channel for a different space", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test",
    });

    await expect(getChannel(context.action(otherSession), channel.id)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can get a channel", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test",
    });

    expect((await getChannel(context.action(session1), channel.id))?.name).toEqual("Test");
});

test("can update a channel's name", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test 1",
    });

    expect((await getChannel(context.action(session1), channel.id))?.name).toEqual("Test 1");

    await updateChannelName(context.action(session1), {
        channelId: channel.id,
        name: "Test 2",
    });

    expect((await getChannel(context.action(session1), channel.id))?.name).toEqual("Test 2");
});

test("can not update a channel's name from a different space", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test 1",
    });

    expect((await getChannel(context.action(session1), channel.id))?.name).toEqual("Test 1");

    await expect(
        updateChannelName(context.action(otherSession), {
            channelId: channel.id,
            name: "Test 2",
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect((await getChannel(context.action(session1), channel.id))?.name).toEqual("Test 1");
});

test("can not update the name of a channel that does not exist", async () => {
    await expect(
        updateChannelName(context.action(otherSession), {
            channelId: generateId(),
            name: "Test 2",
        }),
    ).rejects.toThrow(NotFoundError);
});

test("can update a channel's description", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test 1",
    });

    expect((await getChannel(context.action(session1), channel.id))?.description.doc).toEqual(
        emptyMessageContent,
    );

    await updateChannelDescription(context.action(session1), {
        channelId: channel.id,
        description: testMessageContent1,
    });

    expect((await getChannel(context.action(session1), channel.id))?.description.doc).toEqual(
        testMessageContent1,
    );

    await updateChannelDescription(context.action(session1), {
        channelId: channel.id,
        description: testMessageContent2,
    });

    expect((await getChannel(context.action(session1), channel.id))?.description.doc).toEqual(
        testMessageContent2,
    );
});

test("can not update a channel's description from a different space", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test 1",
    });

    expect((await getChannel(context.action(session1), channel.id))?.description.doc).toEqual(
        emptyMessageContent,
    );

    await expect(
        updateChannelDescription(context.action(otherSession), {
            channelId: channel.id,
            description: testMessageContent1,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect((await getChannel(context.action(session1), channel.id))?.description.doc).toEqual(
        emptyMessageContent,
    );
});

test("can not update the description of a channel that does not exist", async () => {
    await expect(
        updateChannelDescription(context.action(otherSession), {
            channelId: generateId(),
            description: testMessageContent1,
        }),
    ).rejects.toThrow(NotFoundError);
});

test("can not update a channel's description with invalid content", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test 1",
    });

    expect((await getChannel(context.action(session1), channel.id))?.description.doc).toEqual(
        emptyMessageContent,
    );

    await updateChannelDescription(context.action(session1), {
        channelId: channel.id,
        description: testMessageContent1,
    });

    expect((await getChannel(context.action(session1), channel.id))?.description.doc).toEqual(
        testMessageContent1,
    );

    await expect(
        updateChannelDescription(context.action(session1), {
            channelId: channel.id,
            description: assertMessageContent(
                MessageContentProsemirrorSchema.nodes.doc.create({}, [
                    MessageContentProsemirrorSchema.nodes.unorderedListItem.create({}, [
                        MessageContentProsemirrorSchema.text("Hello, world!"),
                    ]),
                ]),
            ),
        }),
    ).rejects.toThrow(InvalidArgumentError);

    expect((await getChannel(context.action(session1), channel.id))?.description.doc).toEqual(
        testMessageContent1,
    );
});

test("can create a post", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test",
    });

    await createPost(context.action(session1), {
        channelId: channel.id,
        content: testContent1,
    });
});

test("can not create a post for a different space", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test",
    });

    await expect(
        createPost(context.action(otherSession), {
            channelId: channel.id,
            content: testContent1,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can not create a post with invalid content", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test",
    });

    await expect(
        createPost(context.action(session1), {
            channelId: channel.id,
            content: assertPostContent(
                PostContentProsemirrorSchema.nodes.doc.create({}, [
                    PostContentProsemirrorSchema.nodes.unorderedListItem.create({}, [
                        PostContentProsemirrorSchema.text("Hello, world!"),
                    ]),
                ]),
            ),
        }),
    ).rejects.toThrow(InvalidArgumentError);
});

test("can not get a post that does not exist", async () => {
    await expect(getPost(context.action(session1), generateId())).rejects.toThrow(NotFoundError);
});

test("can not get a post for a different space", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.action(session1), {
        channelId: channel.id,
        content: testContent1,
    });

    await expect(getPost(context.action(otherSession), post.id)).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("can get a post", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.action(session1), {
        channelId: channel.id,
        content: testContent1,
    });

    expect((await getPost(context.action(session1), post.id))?.content.doc.toJSON()).toEqual(
        testContent1.toJSON(),
    );
});

test("can get the comment authors on a post", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.action(session1), {
        channelId: channel.id,
        content: testContent1,
    });

    expect(
        await getPostCommentAuthors(context.action(session1), {postId: post.id, limit: 100}),
    ).toEqual([]);

    await createPostComment(context.action(session1), {
        postId: post.id,
        parentCommentIndex: null,
        content: testMessageContent1,
    });

    expect(
        await getPostCommentAuthors(context.action(session1), {postId: post.id, limit: 100}),
    ).toEqual([session1.account]);

    await createPostComment(context.action(session2), {
        postId: post.id,
        parentCommentIndex: null,
        content: testMessageContent1,
    });

    await createPostComment(context.action(session3), {
        postId: post.id,
        parentCommentIndex: null,
        content: testMessageContent1,
    });

    expect(
        await getPostCommentAuthors(context.action(session1), {postId: post.id, limit: 100}),
    ).toEqual([session1.account, session2.account, session3.account]);

    await createPostComment(context.action(session4), {
        postId: post.id,
        parentCommentIndex: null,
        content: testMessageContent1,
    });

    await createPostComment(context.action(session5), {
        postId: post.id,
        parentCommentIndex: null,
        content: testMessageContent1,
    });

    await createPostComment(context.action(session6), {
        postId: post.id,
        parentCommentIndex: null,
        content: testMessageContent1,
    });

    await createPostComment(context.action(session7), {
        postId: post.id,
        parentCommentIndex: null,
        content: testMessageContent1,
    });

    await createPostComment(context.action(session8), {
        postId: post.id,
        parentCommentIndex: null,
        content: testMessageContent1,
    });

    expect(
        await getPostCommentAuthors(context.action(session1), {postId: post.id, limit: 100}),
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

    await deletePostComment(context.action(session3), {
        postId: post.id,
        commentIndex: 2,
    });

    expect(
        await getPostCommentAuthors(context.action(session1), {postId: post.id, limit: 100}),
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
        await getPostCommentAuthors(context.action(session1), {postId: post.id, limit: 5}),
    ).toEqual([
        session1.account,
        session2.account,
        session3.account,
        session4.account,
        session5.account,
    ]);
});

test("can not get the comment authors in another space", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.action(session1), {
        channelId: channel.id,
        content: testContent1,
    });

    await expect(
        getPostCommentAuthors(context.action(otherSession), {postId: post.id, limit: 100}),
    ).rejects.toThrow(PermissionDeniedError);

    await createPostComment(context.action(session2), {
        postId: post.id,
        parentCommentIndex: null,
        content: testMessageContent1,
    });

    await expect(
        getPostCommentAuthors(context.action(otherSession), {postId: post.id, limit: 100}),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can not get channel posts for a channel that does not exist", async () => {
    await expect(
        getChannelPosts(context.action(session1), {channelId: generateId(), limit: 100}),
    ).rejects.toThrow(NotFoundError);
});

test("can not get channel posts for a different space", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test",
    });

    await expect(
        getChannelPosts(context.action(otherSession), {channelId: channel.id, limit: 100}),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can not get channel posts for a different space when there are a few posts", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test",
    });

    await createPost(context.action(session1), {
        channelId: channel.id,
        content: testContent1,
    });

    await createPost(context.action(session2), {
        channelId: channel.id,
        content: testContent2,
    });

    await createPost(context.action(session3), {
        channelId: channel.id,
        content: testContent3,
    });

    await expect(
        getChannelPosts(context.action(otherSession), {channelId: channel.id, limit: 100}),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can get channel posts when there are none", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test",
    });

    await expect(
        getChannelPosts(context.action(session1), {channelId: channel.id, limit: 100}),
    ).resolves.toEqual({
        hasMorePosts: false,
        posts: [],
    });
});

test("can get the first few posts in a channel", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post1 = await createPost(context.action(session1), {
        channelId: channel.id,
        content: testContent1,
    });

    await expect(
        getChannelPosts(context.action(session1), {channelId: channel.id, limit: 100}),
    ).resolves.toEqual({
        hasMorePosts: false,
        posts: [
            {
                id: post1.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session1.account,
                content: testContent1WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
        ],
    });

    const post2 = await createPost(context.action(session2), {
        channelId: channel.id,
        content: testContent2,
    });

    await expect(
        getChannelPosts(context.action(session1), {channelId: channel.id, limit: 100}),
    ).resolves.toEqual({
        hasMorePosts: false,
        posts: [
            {
                id: post2.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session2.account,
                content: testContent2WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
            {
                id: post1.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session1.account,
                content: testContent1WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
        ],
    });

    const post3 = await createPost(context.action(session3), {
        channelId: channel.id,
        content: testContent3,
    });

    await expect(
        getChannelPosts(context.action(session1), {channelId: channel.id, limit: 100}),
    ).resolves.toEqual({
        hasMorePosts: false,
        posts: [
            {
                id: post3.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session3.account,
                content: testContent3WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
            {
                id: post2.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session2.account,
                content: testContent2WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
            {
                id: post1.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session1.account,
                content: testContent1WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
        ],
    });
});

test("can get the first few posts in a channel with limit and cursor", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post1 = await createPost(context.action(session1), {
        channelId: channel.id,
        content: testContent1,
    });

    const post2 = await createPost(context.action(session2), {
        channelId: channel.id,
        content: testContent2,
    });

    const post3 = await createPost(context.action(session3), {
        channelId: channel.id,
        content: testContent3,
    });

    const post4 = await createPost(context.action(session1), {
        channelId: channel.id,
        content: testContent2,
    });

    const post5 = await createPost(context.action(session2), {
        channelId: channel.id,
        content: testContent1,
    });

    await expect(
        getChannelPosts(context.action(session1), {channelId: channel.id, limit: 100}),
    ).resolves.toEqual({
        hasMorePosts: false,
        posts: [
            {
                id: post5.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session2.account,
                content: testContent1WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
            {
                id: post4.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session1.account,
                content: testContent2WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
            {
                id: post3.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session3.account,
                content: testContent3WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
            {
                id: post2.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session2.account,
                content: testContent2WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
            {
                id: post1.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session1.account,
                content: testContent1WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
        ],
    });

    await expect(
        getChannelPosts(context.action(session1), {channelId: channel.id, limit: 3}),
    ).resolves.toEqual({
        hasMorePosts: true,
        posts: [
            {
                id: post5.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session2.account,
                content: testContent1WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
            {
                id: post4.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session1.account,
                content: testContent2WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
            {
                id: post3.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session3.account,
                content: testContent3WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
        ],
    });

    await expect(
        getChannelPosts(context.action(session1), {channelId: channel.id, limit: 4}),
    ).resolves.toEqual({
        hasMorePosts: true,
        posts: [
            {
                id: post5.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session2.account,
                content: testContent1WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
            {
                id: post4.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session1.account,
                content: testContent2WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
            {
                id: post3.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session3.account,
                content: testContent3WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
            {
                id: post2.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session2.account,
                content: testContent2WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
        ],
    });

    await expect(
        getChannelPosts(context.action(session1), {channelId: channel.id, limit: 5}),
    ).resolves.toEqual({
        hasMorePosts: false,
        posts: [
            {
                id: post5.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session2.account,
                content: testContent1WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
            {
                id: post4.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session1.account,
                content: testContent2WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
            {
                id: post3.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session3.account,
                content: testContent3WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
            {
                id: post2.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session2.account,
                content: testContent2WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
            {
                id: post1.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session1.account,
                content: testContent1WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
        ],
    });

    await expect(
        getChannelPosts(context.action(session1), {
            channelId: channel.id,
            limit: 100,
            afterCursor: {createdTime: post4.createdTime, postId: post4.id},
        }),
    ).resolves.toEqual({
        hasMorePosts: false,
        posts: [
            {
                id: post3.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session3.account,
                content: testContent3WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
            {
                id: post2.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session2.account,
                content: testContent2WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
            {
                id: post1.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session1.account,
                content: testContent1WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
        ],
    });

    await expect(
        getChannelPosts(context.action(session1), {
            channelId: channel.id,
            limit: 2,
            afterCursor: {createdTime: post4.createdTime, postId: post4.id},
        }),
    ).resolves.toEqual({
        hasMorePosts: true,
        posts: [
            {
                id: post3.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session3.account,
                content: testContent3WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
            {
                id: post2.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session2.account,
                content: testContent2WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
        ],
    });

    await expect(
        getChannelPosts(context.action(session1), {
            channelId: channel.id,
            limit: 2,
            afterCursor: {createdTime: post3.createdTime, postId: post3.id},
        }),
    ).resolves.toEqual({
        hasMorePosts: false,
        posts: [
            {
                id: post2.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session2.account,
                content: testContent2WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
            {
                id: post1.id,
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    createdTime: channel.createdTime,
                    name: "Test",
                    spaceId: space.id,
                },
                createdTime: expect.any(Date),
                author: session1.account,
                content: testContent1WithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            },
        ],
    });
});

test("can update a post's contents", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.action(session1), {
        channelId: channel.id,
        content: testContent1,
    });

    expect(await getPost(context.action(session1), post.id)).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: "Test",
            spaceId: space.id,
        },
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    const {contentUpdatedTime: contentUpdatedTime1} = await updatePostContent(
        context.action(session1),
        {
            postId: post.id,
            content: testContent2,
        },
    );

    expect(await getPost(context.action(session1), post.id)).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: "Test",
            spaceId: space.id,
        },
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent2WithReferences,
        contentUpdatedTime: contentUpdatedTime1,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    const {contentUpdatedTime: contentUpdatedTime2} = await updatePostContent(
        context.action(session1),
        {
            postId: post.id,
            content: testContent3,
        },
    );

    expect(await getPost(context.action(session1), post.id)).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: "Test",
            spaceId: space.id,
        },
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent3WithReferences,
        contentUpdatedTime: contentUpdatedTime2,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });
});

test("can not update another account's post", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.action(session1), {
        channelId: channel.id,
        content: testContent1,
    });

    expect(await getPost(context.action(session1), post.id)).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: "Test",
            spaceId: space.id,
        },
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    await expect(
        updatePostContent(context.action(session2), {
            postId: post.id,
            content: testContent2,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(await getPost(context.action(session1), post.id)).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: "Test",
            spaceId: space.id,
        },
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });
});

test("can not update another space's post", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.action(session1), {
        channelId: channel.id,
        content: testContent1,
    });

    expect(await getPost(context.action(session1), post.id)).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: "Test",
            spaceId: space.id,
        },
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    await expect(
        updatePostContent(context.action(otherSession), {
            postId: post.id,
            content: testContent2,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(await getPost(context.action(session1), post.id)).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: "Test",
            spaceId: space.id,
        },
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });
});

test("can not update a post with invalid content", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.action(session1), {
        channelId: channel.id,
        content: testContent1,
    });

    expect(await getPost(context.action(session1), post.id)).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: "Test",
            spaceId: space.id,
        },
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    await expect(
        updatePostContent(context.action(session1), {
            postId: post.id,
            content: assertPostContent(
                PostContentProsemirrorSchema.nodes.doc.create({}, [
                    PostContentProsemirrorSchema.nodes.unorderedListItem.create({}, [
                        PostContentProsemirrorSchema.text("Hello, world!"),
                    ]),
                ]),
            ),
        }),
    ).rejects.toThrow(InvalidArgumentError);

    expect(await getPost(context.action(session1), post.id)).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: "Test",
            spaceId: space.id,
        },
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });
});

test("if time hasn't moved forward updating a post will set it to +1ms of the last update time", async () => {
    const originalDateNow = Date.now;
    const mockTime = 1675809808692;
    Date.now = () => mockTime;

    try {
        const channel = await createChannel(context.action(session1), {
            spaceId: space.id,
            name: "Test",
        });

        const post = await createPost(context.action(session1), {
            channelId: channel.id,
            content: testContent1,
        });

        await updatePostContent(context.action(session1), {
            postId: post.id,
            content: testContent2,
        });

        {
            const updatedPost = await getPost(context.action(session1), post.id);
            assert(updatedPost);
            expect(updatedPost.contentUpdatedTime).toEqual(new Date(mockTime));
        }

        await updatePostContent(context.action(session1), {
            postId: post.id,
            content: testContent3,
        });

        {
            const updatedPost = await getPost(context.action(session1), post.id);
            assert(updatedPost);
            expect(updatedPost.contentUpdatedTime).toEqual(new Date(mockTime + 1));
        }
    } finally {
        Date.now = originalDateNow;
    }
});

describe("Notification subscribers", () => {
    test("throws when trying to access a post that doesn't exist", async () => {
        await expect(
            getPostNotificationSubscribers(context.systemAction(space.id), generateId()),
        ).rejects.toThrow(NotFoundError);
    });

    test("the post author is a subscriber of their own post", async () => {
        const channel = await createChannel(context.action(session1), {
            spaceId: space.id,
            name: "Test",
        });

        const post = await createPost(context.action(session1), {
            channelId: channel.id,
            content: testContent1,
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account]);
    });

    test("an account mentioned in the post's content is subscribed to notifications", async () => {
        const channel = await createChannel(context.action(session1), {
            spaceId: space.id,
            name: "Test",
        });

        const post = await createPost(context.action(session1), {
            channelId: channel.id,
            content: assertPostContent(
                PostContentProsemirrorSchema.node("doc", {}, [
                    PostContentProsemirrorSchema.node("paragraph", {}, [
                        PostContentProsemirrorSchema.text("Hello, "),
                        PostContentProsemirrorSchema.node("mention", {
                            mention: {accountId: session3.accountId},
                        }),
                        PostContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account, session3.account]);
    });

    test("an unknown account in the post's content is not subscribed to notifications", async () => {
        const channel = await createChannel(context.action(session1), {
            spaceId: space.id,
            name: "Test",
        });

        const post = await createPost(context.action(session1), {
            channelId: channel.id,
            content: assertPostContent(
                PostContentProsemirrorSchema.node("doc", {}, [
                    PostContentProsemirrorSchema.node("paragraph", {}, [
                        PostContentProsemirrorSchema.text("Hello, "),
                        PostContentProsemirrorSchema.node("mention", {
                            mention: {accountId: generateId()},
                        }),
                        PostContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account]);
    });

    test("a mentioned account from another space in the post's content is not subscribed to notifications", async () => {
        const channel = await createChannel(context.action(session1), {
            spaceId: space.id,
            name: "Test",
        });

        const post = await createPost(context.action(session1), {
            channelId: channel.id,
            content: assertPostContent(
                PostContentProsemirrorSchema.node("doc", {}, [
                    PostContentProsemirrorSchema.node("paragraph", {}, [
                        PostContentProsemirrorSchema.text("Hello, "),
                        PostContentProsemirrorSchema.node("mention", {
                            mention: {accountId: otherSession.accountId},
                        }),
                        PostContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account]);
    });

    test("an account mentioned in the post's content is subscribed to notifications even if it is removed from the post's content", async () => {
        const channel = await createChannel(context.action(session1), {
            spaceId: space.id,
            name: "Test",
        });

        const post = await createPost(context.action(session1), {
            channelId: channel.id,
            content: assertPostContent(
                PostContentProsemirrorSchema.node("doc", {}, [
                    PostContentProsemirrorSchema.node("paragraph", {}, [
                        PostContentProsemirrorSchema.text("Hello, "),
                        PostContentProsemirrorSchema.node("mention", {
                            mention: {accountId: session3.accountId},
                        }),
                        PostContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account, session3.account]);

        await updatePostContent(context.action(session1), {
            postId: post.id,
            content: assertPostContent(
                PostContentProsemirrorSchema.node("doc", {}, [
                    PostContentProsemirrorSchema.node("paragraph", {}, [
                        PostContentProsemirrorSchema.text("Hello, world!"),
                    ]),
                ]),
            ),
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account, session3.account]);
    });

    test("an account mentioned in the post's content after an update is subscribed to notifications", async () => {
        const channel = await createChannel(context.action(session1), {
            spaceId: space.id,
            name: "Test",
        });

        const post = await createPost(context.action(session1), {
            channelId: channel.id,
            content: assertPostContent(
                PostContentProsemirrorSchema.node("doc", {}, [
                    PostContentProsemirrorSchema.node("paragraph", {}, [
                        PostContentProsemirrorSchema.text("Hello, world!"),
                    ]),
                ]),
            ),
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account]);

        await updatePostContent(context.action(session1), {
            postId: post.id,
            content: assertPostContent(
                PostContentProsemirrorSchema.node("doc", {}, [
                    PostContentProsemirrorSchema.node("paragraph", {}, [
                        PostContentProsemirrorSchema.text("Hello, "),
                        PostContentProsemirrorSchema.node("mention", {
                            mention: {accountId: session3.accountId},
                        }),
                        PostContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account, session3.account]);
    });

    test("an account that comments on a post is subscribed to notifications", async () => {
        const channel = await createChannel(context.action(session1), {
            spaceId: space.id,
            name: "Test",
        });

        const post = await createPost(context.action(session1), {
            channelId: channel.id,
            content: testContent1,
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account]);

        await createPostComment(context.action(session3), {
            postId: post.id,
            parentCommentIndex: null,
            content: testMessageContent1,
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account, session3.account]);

        await createPostComment(context.action(session3), {
            postId: post.id,
            parentCommentIndex: null,
            content: testMessageContent2,
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account, session3.account]);

        await createPostComment(context.action(session2), {
            postId: post.id,
            parentCommentIndex: null,
            content: testMessageContent1,
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account, session3.account, session2.account]);
    });

    test("an account that comments on a post is subscribed to notifications even if the comment is deleted", async () => {
        const channel = await createChannel(context.action(session1), {
            spaceId: space.id,
            name: "Test",
        });

        const post = await createPost(context.action(session1), {
            channelId: channel.id,
            content: testContent1,
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account]);

        await createPostComment(context.action(session3), {
            postId: post.id,
            parentCommentIndex: null,
            content: testMessageContent1,
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account, session3.account]);

        await deletePostComment(context.action(session3), {
            postId: post.id,
            commentIndex: 0,
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account, session3.account]);
    });

    test("an account that is mentioned in a post comment is subscribed to notifications", async () => {
        const channel = await createChannel(context.action(session1), {
            spaceId: space.id,
            name: "Test",
        });

        const post = await createPost(context.action(session1), {
            channelId: channel.id,
            content: testContent1,
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account]);

        await createPostComment(context.action(session3), {
            postId: post.id,
            parentCommentIndex: null,
            content: assertMessageContent(
                MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Hello, "),
                        MessageContentProsemirrorSchema.node("mention", {
                            mention: {accountId: session4.accountId},
                        }),
                        MessageContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account, session3.account, session4.account]);
    });

    test("an unknown account that is mentioned in a post comment is not subscribed to notifications", async () => {
        const channel = await createChannel(context.action(session1), {
            spaceId: space.id,
            name: "Test",
        });

        const post = await createPost(context.action(session1), {
            channelId: channel.id,
            content: testContent1,
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account]);

        await createPostComment(context.action(session3), {
            postId: post.id,
            parentCommentIndex: null,
            content: assertMessageContent(
                MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Hello, "),
                        MessageContentProsemirrorSchema.node("mention", {
                            mention: {accountId: generateId()},
                        }),
                        MessageContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account, session3.account]);
    });

    test("a mentioned account from another space in a post comment is not subscribed to notifications", async () => {
        const channel = await createChannel(context.action(session1), {
            spaceId: space.id,
            name: "Test",
        });

        const post = await createPost(context.action(session1), {
            channelId: channel.id,
            content: testContent1,
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account]);

        await createPostComment(context.action(session3), {
            postId: post.id,
            parentCommentIndex: null,
            content: assertMessageContent(
                MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Hello, "),
                        MessageContentProsemirrorSchema.node("mention", {
                            mention: {accountId: otherSession.accountId},
                        }),
                        MessageContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account, session3.account]);
    });

    test("an account that is mentioned in a post comment is subscribed to notifications even if the message is updated to remove the mention", async () => {
        const channel = await createChannel(context.action(session1), {
            spaceId: space.id,
            name: "Test",
        });

        const post = await createPost(context.action(session1), {
            channelId: channel.id,
            content: testContent1,
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account]);

        await createPostComment(context.action(session3), {
            postId: post.id,
            parentCommentIndex: null,
            content: assertMessageContent(
                MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Hello, "),
                        MessageContentProsemirrorSchema.node("mention", {
                            mention: {accountId: session4.accountId},
                        }),
                        MessageContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account, session3.account, session4.account]);

        await updatePostCommentContent(context.action(session3), {
            postId: post.id,
            commentIndex: 0,
            content: assertMessageContent(
                MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Hello, world!"),
                    ]),
                ]),
            ),
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account, session3.account, session4.account]);
    });

    test("an account that is mentioned in a post comment is subscribed to notifications even if the message is deleted", async () => {
        const channel = await createChannel(context.action(session1), {
            spaceId: space.id,
            name: "Test",
        });

        const post = await createPost(context.action(session1), {
            channelId: channel.id,
            content: testContent1,
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account]);

        await createPostComment(context.action(session3), {
            postId: post.id,
            parentCommentIndex: null,
            content: assertMessageContent(
                MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Hello, "),
                        MessageContentProsemirrorSchema.node("mention", {
                            mention: {accountId: session4.accountId},
                        }),
                        MessageContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account, session3.account, session4.account]);

        await deletePostComment(context.action(session3), {
            postId: post.id,
            commentIndex: 0,
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account, session3.account, session4.account]);
    });

    test("an account that is mentioned in a post comment after it is updated is subscribed to notifications", async () => {
        const channel = await createChannel(context.action(session1), {
            spaceId: space.id,
            name: "Test",
        });

        const post = await createPost(context.action(session1), {
            channelId: channel.id,
            content: testContent1,
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account]);

        await createPostComment(context.action(session3), {
            postId: post.id,
            parentCommentIndex: null,
            content: assertMessageContent(
                MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Hello, world!"),
                    ]),
                ]),
            ),
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account, session3.account]);

        await updatePostCommentContent(context.action(session3), {
            postId: post.id,
            commentIndex: 0,
            content: assertMessageContent(
                MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Hello, "),
                        MessageContentProsemirrorSchema.node("mention", {
                            mention: {accountId: session4.accountId},
                        }),
                        MessageContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account, session3.account, session4.account]);
    });

    test("notification subscribers are not duplicated and can be added from many different sources", async () => {
        const channel = await createChannel(context.action(session1), {
            spaceId: space.id,
            name: "Test",
        });

        const post = await createPost(context.action(session1), {
            channelId: channel.id,
            content: assertPostContent(
                PostContentProsemirrorSchema.node("doc", {}, [
                    PostContentProsemirrorSchema.node("paragraph", {}, [
                        PostContentProsemirrorSchema.text("Hello, "),
                        PostContentProsemirrorSchema.node("mention", {
                            mention: {accountId: session2.accountId},
                        }),
                        PostContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account, session2.account]);

        await createPostComment(context.action(session1), {
            postId: post.id,
            parentCommentIndex: null,
            content: assertMessageContent(
                MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Hello, world!"),
                    ]),
                ]),
            ),
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account, session2.account]);

        await createPostComment(context.action(session3), {
            postId: post.id,
            parentCommentIndex: null,
            content: assertMessageContent(
                MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Hello, "),
                        MessageContentProsemirrorSchema.node("mention", {
                            mention: {accountId: session1.accountId},
                        }),
                        MessageContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account, session3.account, session2.account]);

        const comment = await createPostComment(context.action(session2), {
            postId: post.id,
            parentCommentIndex: null,
            content: assertMessageContent(
                MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Hello, "),
                        MessageContentProsemirrorSchema.node("mention", {
                            mention: {accountId: session4.accountId},
                        }),
                        MessageContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([session1.account, session3.account, session2.account, session4.account]);

        await updatePostCommentContent(context.action(session2), {
            postId: post.id,
            commentIndex: comment.index,
            content: assertMessageContent(
                MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Hello, "),
                        MessageContentProsemirrorSchema.node("mention", {
                            mention: {accountId: session5.accountId},
                        }),
                        MessageContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accounts}) => accounts,
            ),
        ).toEqual([
            session1.account,
            session3.account,
            session2.account,
            session4.account,
            session5.account,
        ]);
    });
});
