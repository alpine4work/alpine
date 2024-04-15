import {addMinutes} from "date-fns";
import {dynamoGeneralRealtimeStaleEventualReadConsistencyWindowMinutes} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {
    backfillChannelPosts,
    createChannel,
    createPost,
    createPostComment,
    deletePostComment,
    getChannel,
    getChannelNameAndDescriptionContent,
    getChannelPosts,
    getPost,
    getPostCommentAuthors,
    getPostNotificationSubscribers,
    updateChannelDescription,
    updateChannelName,
    updatePostCommentContent,
    updatePostContent,
} from "~/server/forum/data/forum_table.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {InvalidArgumentError, NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {
    PostContentProsemirrorSchema,
    PostContentWithReferences,
    assertPostContent,
    createSimplePostContent,
} from "~/shared/forum/post_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
    createSimpleMessageContent,
    emptyMessageContent,
} from "~/shared/messaging/message_content_schema.js";

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
    await expect(
        getChannelNameAndDescriptionContent(context.action(otherSession), generateId()),
    ).rejects.toThrow(NotFoundError);
});

test("can not get a channel for a different space", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test",
    });

    await expect(getChannel(context.action(otherSession), channel.id)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        getChannelNameAndDescriptionContent(context.action(otherSession), channel.id),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can get a channel", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test",
    });

    expect((await getChannel(context.action(session1), channel.id)).model.name).toEqual("Test");
    expect(
        (await getChannelNameAndDescriptionContent(context.action(session1), channel.id)).name,
    ).toEqual("Test");
});

test("can update a channel's name", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test 1",
    });

    expect((await getChannel(context.action(session1), channel.id)).model.name).toEqual("Test 1");
    expect(
        (await getChannelNameAndDescriptionContent(context.action(session1), channel.id)).name,
    ).toEqual("Test 1");

    await updateChannelName(context.action(session1), {
        channelId: channel.id,
        name: "Test 2",
    });

    expect((await getChannel(context.action(session1), channel.id)).model.name).toEqual("Test 2");
    expect(
        (await getChannelNameAndDescriptionContent(context.action(session1), channel.id)).name,
    ).toEqual("Test 2");
});

test("can not update a channel's name from a different space", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test 1",
    });

    expect((await getChannel(context.action(session1), channel.id)).model.name).toEqual("Test 1");

    await expect(
        updateChannelName(context.action(otherSession), {
            channelId: channel.id,
            name: "Test 2",
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect((await getChannel(context.action(session1), channel.id)).model.name).toEqual("Test 1");
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

    expect((await getChannel(context.action(session1), channel.id)).model.description.doc).toEqual(
        emptyMessageContent,
    );

    await updateChannelDescription(context.action(session1), {
        channelId: channel.id,
        description: testMessageContent1,
    });

    expect((await getChannel(context.action(session1), channel.id)).model.description.doc).toEqual(
        testMessageContent1,
    );

    await updateChannelDescription(context.action(session1), {
        channelId: channel.id,
        description: testMessageContent2,
    });

    expect((await getChannel(context.action(session1), channel.id)).model.description.doc).toEqual(
        testMessageContent2,
    );
});

test("can not update a channel's description from a different space", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test 1",
    });

    expect((await getChannel(context.action(session1), channel.id)).model.description.doc).toEqual(
        emptyMessageContent,
    );

    await expect(
        updateChannelDescription(context.action(otherSession), {
            channelId: channel.id,
            description: testMessageContent1,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect((await getChannel(context.action(session1), channel.id)).model.description.doc).toEqual(
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

    expect((await getChannel(context.action(session1), channel.id)).model.description.doc).toEqual(
        emptyMessageContent,
    );

    await updateChannelDescription(context.action(session1), {
        channelId: channel.id,
        description: testMessageContent1,
    });

    expect((await getChannel(context.action(session1), channel.id)).model.description.doc).toEqual(
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

    expect((await getChannel(context.action(session1), channel.id)).model.description.doc).toEqual(
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
        getChannelPosts(context.action(session1), {
            channelId: generateId(),
            limit: 100,
            beforeCursor: null,
        }),
    ).rejects.toThrow(NotFoundError);
});

test("can not get channel posts for a different space", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test",
    });

    await expect(
        getChannelPosts(context.action(otherSession), {
            channelId: channel.id,
            limit: 100,
            beforeCursor: null,
        }),
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
        getChannelPosts(context.action(otherSession), {
            channelId: channel.id,
            limit: 100,
            beforeCursor: null,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can get channel posts when there are none", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test",
    });

    await expect(
        getChannelPosts(context.action(session1), {
            channelId: channel.id,
            limit: 100,
            beforeCursor: null,
        }),
    ).resolves.toEqual({
        indexName: "ChannelPosts",
        readTime: expect.any(Date),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromEnd",
            hasPreviousPage: false,
            beforeCursor: null,
        },
        items: [],
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
        getChannelPosts(context.action(session1), {
            channelId: channel.id,
            limit: 100,
            beforeCursor: null,
        }),
    ).resolves.toEqual({
        indexName: "ChannelPosts",
        readTime: expect.any(Date),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromEnd",
            hasPreviousPage: false,
            beforeCursor: null,
        },
        items: [
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
        ],
    });

    const post2 = await createPost(context.action(session2), {
        channelId: channel.id,
        content: testContent2,
    });

    await expect(
        getChannelPosts(context.action(session1), {
            channelId: channel.id,
            limit: 100,
            beforeCursor: null,
        }),
    ).resolves.toEqual({
        indexName: "ChannelPosts",
        readTime: expect.any(Date),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromEnd",
            hasPreviousPage: false,
            beforeCursor: null,
        },
        items: [
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
        ],
    });

    const post3 = await createPost(context.action(session3), {
        channelId: channel.id,
        content: testContent3,
    });

    await expect(
        getChannelPosts(context.action(session1), {
            channelId: channel.id,
            limit: 100,
            beforeCursor: null,
        }),
    ).resolves.toEqual({
        indexName: "ChannelPosts",
        readTime: expect.any(Date),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromEnd",
            hasPreviousPage: false,
            beforeCursor: null,
        },
        items: [
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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

    const channelPostsResult = await getChannelPosts(context.action(session1), {
        channelId: channel.id,
        limit: 100,
        beforeCursor: null,
    });

    expect(channelPostsResult).toEqual({
        indexName: "ChannelPosts",
        readTime: expect.any(Date),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromEnd",
            hasPreviousPage: false,
            beforeCursor: null,
        },
        items: [
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
        ],
    });

    await expect(
        getChannelPosts(context.action(session1), {
            channelId: channel.id,
            limit: 3,
            beforeCursor: null,
        }),
    ).resolves.toEqual({
        indexName: "ChannelPosts",
        readTime: expect.any(Date),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromEnd",
            hasPreviousPage: true,
            beforeCursor: null,
        },
        items: [
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
        ],
    });

    await expect(
        getChannelPosts(context.action(session1), {
            channelId: channel.id,
            limit: 4,
            beforeCursor: null,
        }),
    ).resolves.toEqual({
        indexName: "ChannelPosts",
        readTime: expect.any(Date),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromEnd",
            hasPreviousPage: true,
            beforeCursor: null,
        },
        items: [
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
        ],
    });

    await expect(
        getChannelPosts(context.action(session1), {
            channelId: channel.id,
            limit: 5,
            beforeCursor: null,
        }),
    ).resolves.toEqual({
        indexName: "ChannelPosts",
        readTime: expect.any(Date),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromEnd",
            hasPreviousPage: false,
            beforeCursor: null,
        },
        items: [
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
        ],
    });

    await expect(
        getChannelPosts(context.action(session1), {
            channelId: channel.id,
            limit: 100,
            beforeCursor: channelPostsResult.items[3]!.cursor,
        }),
    ).resolves.toEqual({
        indexName: "ChannelPosts",
        readTime: expect.any(Date),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromEnd",
            hasPreviousPage: false,
            beforeCursor: channelPostsResult.items[3]!.cursor,
        },
        items: [
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
        ],
    });

    await expect(
        getChannelPosts(context.action(session1), {
            channelId: channel.id,
            limit: 2,
            beforeCursor: channelPostsResult.items[3]!.cursor,
        }),
    ).resolves.toEqual({
        indexName: "ChannelPosts",
        readTime: expect.any(Date),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromEnd",
            hasPreviousPage: true,
            beforeCursor: channelPostsResult.items[3]!.cursor,
        },
        items: [
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
        ],
    });

    await expect(
        getChannelPosts(context.action(session1), {
            channelId: channel.id,
            limit: 2,
            beforeCursor: channelPostsResult.items[2]!.cursor,
        }),
    ).resolves.toEqual({
        indexName: "ChannelPosts",
        readTime: expect.any(Date),
        startCursorBound: null,
        endCursorBound: null,
        pageInfo: {
            type: "FromEnd",
            hasPreviousPage: false,
            beforeCursor: channelPostsResult.items[2]!.cursor,
        },
        items: [
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 0,
                model: {
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
            },
        ],
    });
});

test("can backfill realtime updates in a channel", async () => {
    const readTime1 = new Date();

    const channel1 = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test 1",
    });

    const channel2 = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test 2",
    });

    const post1 = await createPost(context.action(session1), {
        channelId: channel1.id,
        content: testContent1,
    });

    const post2 = await createPost(context.action(session1), {
        channelId: channel2.id,
        content: testContent2,
    });

    const post3 = await createPost(context.action(session1), {
        channelId: channel1.id,
        content: testContent3,
    });

    const post4 = await createPost(context.action(session1), {
        channelId: channel2.id,
        content: testContent2,
    });

    await ProcessContextModule.waitForTestTasks();

    const readTime2 = addMinutes(
        new Date(),
        dynamoGeneralRealtimeStaleEventualReadConsistencyWindowMinutes,
    );

    const channel1PostsResult = await getChannelPosts(context.action(session1), {
        channelId: channel1.id,
        limit: 100,
        beforeCursor: null,
    });

    const channel2PostsResult = await getChannelPosts(context.action(session1), {
        channelId: channel2.id,
        limit: 100,
        beforeCursor: null,
    });

    await expect(
        backfillChannelPosts(context.action(otherSession), {
            channelId: channel1.id,
            readTime: readTime1,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    const post1a = await getPost(context.action(session1), post1.id);
    const post2a = await getPost(context.action(session1), post2.id);
    const post3a = await getPost(context.action(session1), post3.id);
    const post4a = await getPost(context.action(session1), post4.id);

    expect(
        await backfillChannelPosts(context.action(session1), {
            channelId: channel1.id,
            readTime: readTime1,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                cursorByIndexName: new Map([
                    ["ChannelPosts", channel1PostsResult.items[0]!.cursor],
                ]),
                item: {
                    key: channel1PostsResult.items[0]!.key,
                    version: 0,
                    model: post1a,
                },
            },
            {
                type: "PutItem",
                cursorByIndexName: new Map([
                    ["ChannelPosts", channel1PostsResult.items[1]!.cursor],
                ]),
                item: {
                    key: channel1PostsResult.items[1]!.key,
                    version: 0,
                    model: post3a,
                },
            },
        ],
    });

    expect(
        await backfillChannelPosts(context.action(session1), {
            channelId: channel2.id,
            readTime: readTime1,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                cursorByIndexName: new Map([
                    ["ChannelPosts", channel2PostsResult.items[0]!.cursor],
                ]),
                item: {
                    key: channel2PostsResult.items[0]!.key,
                    version: 0,
                    model: post2a,
                },
            },
            {
                type: "PutItem",
                cursorByIndexName: new Map([
                    ["ChannelPosts", channel2PostsResult.items[1]!.cursor],
                ]),
                item: {
                    key: channel2PostsResult.items[1]!.key,
                    version: 0,
                    model: post4a,
                },
            },
        ],
    });

    expect(
        await backfillChannelPosts(context.action(session1), {
            channelId: channel1.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [],
    });

    expect(
        await backfillChannelPosts(context.action(session1), {
            channelId: channel2.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [],
    });

    await updatePostContent(context.action(session1), {
        postId: post1.id,
        content: createSimplePostContent("Updated test content 1"),
    });

    const post1b = await getPost(context.action(session1), post1.id);

    expect(
        await backfillChannelPosts(context.action(session1), {
            channelId: channel1.id,
            readTime: readTime1,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                cursorByIndexName: new Map([
                    ["ChannelPosts", channel1PostsResult.items[0]!.cursor],
                ]),
                item: {
                    key: channel1PostsResult.items[0]!.key,
                    version: 1,
                    model: post1b,
                },
            },
            {
                type: "PutItem",
                cursorByIndexName: new Map([
                    ["ChannelPosts", channel1PostsResult.items[1]!.cursor],
                ]),
                item: {
                    key: channel1PostsResult.items[1]!.key,
                    version: 0,
                    model: post3a,
                },
            },
        ],
    });

    expect(
        await backfillChannelPosts(context.action(session1), {
            channelId: channel2.id,
            readTime: readTime1,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                cursorByIndexName: new Map([
                    ["ChannelPosts", channel2PostsResult.items[0]!.cursor],
                ]),
                item: {
                    key: channel2PostsResult.items[0]!.key,
                    version: 0,
                    model: post2a,
                },
            },
            {
                type: "PutItem",
                cursorByIndexName: new Map([
                    ["ChannelPosts", channel2PostsResult.items[1]!.cursor],
                ]),
                item: {
                    key: channel2PostsResult.items[1]!.key,
                    version: 0,
                    model: post4a,
                },
            },
        ],
    });

    expect(
        await backfillChannelPosts(context.action(session1), {
            channelId: channel1.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                cursorByIndexName: new Map([
                    ["ChannelPosts", channel1PostsResult.items[0]!.cursor],
                ]),
                item: {
                    key: channel1PostsResult.items[0]!.key,
                    version: 1,
                    model: post1b,
                },
            },
        ],
    });

    expect(
        await backfillChannelPosts(context.action(session1), {
            channelId: channel2.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [],
    });

    await updatePostContent(context.action(session1), {
        postId: post4.id,
        content: createSimplePostContent("Updated test content 2"),
    });

    const post4b = await getPost(context.action(session1), post4.id);

    expect(
        await backfillChannelPosts(context.action(session1), {
            channelId: channel1.id,
            readTime: readTime1,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                cursorByIndexName: new Map([
                    ["ChannelPosts", channel1PostsResult.items[0]!.cursor],
                ]),
                item: {
                    key: channel1PostsResult.items[0]!.key,
                    version: 1,
                    model: post1b,
                },
            },
            {
                type: "PutItem",
                cursorByIndexName: new Map([
                    ["ChannelPosts", channel1PostsResult.items[1]!.cursor],
                ]),
                item: {
                    key: channel1PostsResult.items[1]!.key,
                    version: 0,
                    model: post3a,
                },
            },
        ],
    });

    expect(
        await backfillChannelPosts(context.action(session1), {
            channelId: channel2.id,
            readTime: readTime1,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                cursorByIndexName: new Map([
                    ["ChannelPosts", channel2PostsResult.items[0]!.cursor],
                ]),
                item: {
                    key: channel2PostsResult.items[0]!.key,
                    version: 0,
                    model: post2a,
                },
            },
            {
                type: "PutItem",
                cursorByIndexName: new Map([
                    ["ChannelPosts", channel2PostsResult.items[1]!.cursor],
                ]),
                item: {
                    key: channel2PostsResult.items[1]!.key,
                    version: 1,
                    model: post4b,
                },
            },
        ],
    });

    expect(
        await backfillChannelPosts(context.action(session1), {
            channelId: channel1.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                cursorByIndexName: new Map([
                    ["ChannelPosts", channel1PostsResult.items[0]!.cursor],
                ]),
                item: {
                    key: channel1PostsResult.items[0]!.key,
                    version: 1,
                    model: post1b,
                },
            },
        ],
    });

    expect(
        await backfillChannelPosts(context.action(session1), {
            channelId: channel2.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                cursorByIndexName: new Map([
                    ["ChannelPosts", channel2PostsResult.items[1]!.cursor],
                ]),
                item: {
                    key: channel2PostsResult.items[1]!.key,
                    version: 1,
                    model: post4b,
                },
            },
        ],
    });

    const post5 = await createPost(context.action(session1), {
        channelId: channel1.id,
        content: testContent1,
    });

    const post5a = await getPost(context.action(session1), post5.id);

    expect(
        await backfillChannelPosts(context.action(session1), {
            channelId: channel1.id,
            readTime: readTime1,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                cursorByIndexName: new Map([
                    ["ChannelPosts", channel1PostsResult.items[0]!.cursor],
                ]),
                item: {
                    key: channel1PostsResult.items[0]!.key,
                    version: 1,
                    model: post1b,
                },
            },
            {
                type: "PutItem",
                cursorByIndexName: new Map([
                    ["ChannelPosts", channel1PostsResult.items[1]!.cursor],
                ]),
                item: {
                    key: channel1PostsResult.items[1]!.key,
                    version: 0,
                    model: post3a,
                },
            },
            {
                type: "PutItem",
                cursorByIndexName: new Map([["ChannelPosts", expect.any(String)]]),
                item: {
                    key: expect.any(String),
                    version: 0,
                    model: post5a,
                },
            },
        ],
    });

    expect(
        await backfillChannelPosts(context.action(session1), {
            channelId: channel2.id,
            readTime: readTime1,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                cursorByIndexName: new Map([
                    ["ChannelPosts", channel2PostsResult.items[0]!.cursor],
                ]),
                item: {
                    key: channel2PostsResult.items[0]!.key,
                    version: 0,
                    model: post2a,
                },
            },
            {
                type: "PutItem",
                cursorByIndexName: new Map([
                    ["ChannelPosts", channel2PostsResult.items[1]!.cursor],
                ]),
                item: {
                    key: channel2PostsResult.items[1]!.key,
                    version: 1,
                    model: post4b,
                },
            },
        ],
    });

    expect(
        await backfillChannelPosts(context.action(session1), {
            channelId: channel1.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                cursorByIndexName: new Map([
                    ["ChannelPosts", channel1PostsResult.items[0]!.cursor],
                ]),
                item: {
                    key: channel1PostsResult.items[0]!.key,
                    version: 1,
                    model: post1b,
                },
            },
            {
                type: "PutItem",
                cursorByIndexName: new Map([["ChannelPosts", expect.any(String)]]),
                item: {
                    key: expect.any(String),
                    version: 0,
                    model: post5a,
                },
            },
        ],
    });

    expect(
        await backfillChannelPosts(context.action(session1), {
            channelId: channel2.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                cursorByIndexName: new Map([
                    ["ChannelPosts", channel2PostsResult.items[1]!.cursor],
                ]),
                item: {
                    key: channel2PostsResult.items[1]!.key,
                    version: 1,
                    model: post4b,
                },
            },
        ],
    });
});

test("won't backfill realtime updates when comment count changes", async () => {
    const readTime1 = new Date();

    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test 1",
    });

    const post = await createPost(context.action(session1), {
        channelId: channel.id,
        content: testContent1,
    });

    await ProcessContextModule.waitForTestTasks();

    const readTime2 = addMinutes(new Date(), 3);

    const post1a = await getPost(context.action(session1), post.id);

    expect(post1a.commentCount).toEqual(0);
    expect(post1a.lastCommentChangeTime).toEqual(null);

    expect(
        await backfillChannelPosts(context.action(session1), {
            channelId: channel.id,
            readTime: readTime1,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                cursorByIndexName: new Map([["ChannelPosts", expect.any(String)]]),
                item: {
                    key: expect.any(String),
                    version: 0,
                    model: post1a,
                },
            },
        ],
    });

    expect(
        await backfillChannelPosts(context.action(session1), {
            channelId: channel.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [],
    });

    const comment1 = await createPostComment(context.action(session1), {
        postId: post.id,
        parentCommentIndex: null,
        content: createSimpleMessageContent("comment1"),
    });

    const post1b = await getPost(context.action(session1), post.id);

    expect(post1a.commentCount).toEqual(0);
    expect(post1a.lastCommentChangeTime).toEqual(null);
    expect(post1b.commentCount).toEqual(1);
    expect(post1b.lastCommentChangeTime).toEqual(null);

    expect(
        await backfillChannelPosts(context.action(session1), {
            channelId: channel.id,
            readTime: readTime1,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                cursorByIndexName: new Map([["ChannelPosts", expect.any(String)]]),
                item: {
                    key: expect.any(String),
                    version: 1,
                    model: post1b,
                },
            },
        ],
    });

    expect(
        await backfillChannelPosts(context.action(session1), {
            channelId: channel.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [],
    });

    const comment2 = await createPostComment(context.action(session1), {
        postId: post.id,
        parentCommentIndex: null,
        content: createSimpleMessageContent("comment2"),
    });

    const post1c = await getPost(context.action(session1), post.id);

    expect(post1a.commentCount).toEqual(0);
    expect(post1a.lastCommentChangeTime).toEqual(null);
    expect(post1c.commentCount).toEqual(2);
    expect(post1c.lastCommentChangeTime).toEqual(null);

    expect(
        await backfillChannelPosts(context.action(session1), {
            channelId: channel.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [],
    });

    const {contentUpdatedTime: comment2ContentUpdatedTime} = await updatePostCommentContent(
        context.action(session1),
        {
            postId: post.id,
            commentIndex: comment2.index,
            content: createSimpleMessageContent("comment2 (updated)"),
        },
    );

    const post1d = await getPost(context.action(session1), post.id);

    expect(post1a.commentCount).toEqual(0);
    expect(post1a.lastCommentChangeTime).toEqual(null);
    expect(post1d.commentCount).toEqual(2);
    expect(post1d.lastCommentChangeTime).toEqual(comment2ContentUpdatedTime);

    expect(
        await backfillChannelPosts(context.action(session1), {
            channelId: channel.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [],
    });

    const {deletedTime: comment1DeletedTime} = await deletePostComment(context.action(session1), {
        postId: post.id,
        commentIndex: comment1.index,
    });

    const post1e = await getPost(context.action(session1), post.id);

    expect(post1a.commentCount).toEqual(0);
    expect(post1a.lastCommentChangeTime).toEqual(null);
    expect(post1e.commentCount).toEqual(2);
    expect(post1e.lastCommentChangeTime).toEqual(comment1DeletedTime);

    expect(
        await backfillChannelPosts(context.action(session1), {
            channelId: channel.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [],
    });

    await createPostComment(context.action(session1), {
        postId: post.id,
        parentCommentIndex: null,
        content: createSimpleMessageContent("comment3"),
    });

    const post1f = await getPost(context.action(session1), post.id);

    expect(post1a.commentCount).toEqual(0);
    expect(post1a.lastCommentChangeTime).toEqual(null);
    expect(post1f.commentCount).toEqual(3);
    expect(post1f.lastCommentChangeTime).toEqual(comment1DeletedTime);

    expect(
        await backfillChannelPosts(context.action(session1), {
            channelId: channel.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [],
    });

    await updatePostContent(context.action(session1), {
        postId: post.id,
        content: createSimplePostContent("Updated test content"),
    });

    await ProcessContextModule.waitForTestTasks();

    const readTime3 = addMinutes(
        new Date(),
        dynamoGeneralRealtimeStaleEventualReadConsistencyWindowMinutes,
    );

    const post1g = await getPost(context.action(session1), post.id);

    expect(post1a.commentCount).toEqual(0);
    expect(post1a.lastCommentChangeTime).toEqual(null);
    expect(post1g.commentCount).toEqual(3);
    expect(post1g.lastCommentChangeTime).toEqual(comment1DeletedTime);

    expect(
        await backfillChannelPosts(context.action(session1), {
            channelId: channel.id,
            readTime: readTime2,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [
            {
                type: "PutItem",
                cursorByIndexName: new Map([["ChannelPosts", expect.any(String)]]),
                item: {
                    key: expect.any(String),
                    version: 6,
                    model: post1g,
                },
            },
        ],
    });

    expect(
        await backfillChannelPosts(context.action(session1), {
            channelId: channel.id,
            readTime: readTime3,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [],
    });

    await createPostComment(context.action(session1), {
        postId: post.id,
        parentCommentIndex: null,
        content: createSimpleMessageContent("comment4"),
    });

    const post1h = await getPost(context.action(session1), post.id);

    expect(post1a.commentCount).toEqual(0);
    expect(post1a.lastCommentChangeTime).toEqual(null);
    expect(post1g.commentCount).toEqual(3);
    expect(post1g.lastCommentChangeTime).toEqual(comment1DeletedTime);
    expect(post1h.commentCount).toEqual(4);
    expect(post1h.lastCommentChangeTime).toEqual(comment1DeletedTime);

    expect(
        await backfillChannelPosts(context.action(session1), {
            channelId: channel.id,
            readTime: readTime3,
        }),
    ).toEqual({
        type: "Available",
        readTime: expect.any(Date),
        eventTransaction: [],
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
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id]));
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
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session3.account.id]));
    });

    test("an unknown account in the post's content is not subscribed to notifications", async () => {
        const channel = await createChannel(context.action(session1), {
            spaceId: space.id,
            name: "Test",
        });

        const missingAccountId = generateId<AccountId>();

        const post = await createPost(context.action(session1), {
            channelId: channel.id,
            content: assertPostContent(
                PostContentProsemirrorSchema.node("doc", {}, [
                    PostContentProsemirrorSchema.node("paragraph", {}, [
                        PostContentProsemirrorSchema.text("Hello, "),
                        PostContentProsemirrorSchema.node("mention", {
                            mention: {accountId: missingAccountId},
                        }),
                        PostContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, missingAccountId]));
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
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, otherSession.accountId]));
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
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session3.account.id]));

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
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session3.account.id]));
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
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id]));

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
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session3.account.id]));
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
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id]));

        await createPostComment(context.action(session3), {
            postId: post.id,
            parentCommentIndex: null,
            content: testMessageContent1,
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session3.account.id]));

        await createPostComment(context.action(session3), {
            postId: post.id,
            parentCommentIndex: null,
            content: testMessageContent2,
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session3.account.id]));

        await createPostComment(context.action(session2), {
            postId: post.id,
            parentCommentIndex: null,
            content: testMessageContent1,
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session3.account.id, session2.account.id]));
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
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id]));

        await createPostComment(context.action(session3), {
            postId: post.id,
            parentCommentIndex: null,
            content: testMessageContent1,
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session3.account.id]));

        await deletePostComment(context.action(session3), {
            postId: post.id,
            commentIndex: 0,
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session3.account.id]));
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
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id]));

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
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session3.account.id, session4.account.id]));
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
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id]));

        const missingAccountId = generateId<AccountId>();

        await createPostComment(context.action(session3), {
            postId: post.id,
            parentCommentIndex: null,
            content: assertMessageContent(
                MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Hello, "),
                        MessageContentProsemirrorSchema.node("mention", {
                            mention: {accountId: missingAccountId},
                        }),
                        MessageContentProsemirrorSchema.text("!"),
                    ]),
                ]),
            ),
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session3.account.id, missingAccountId]));
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
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id]));

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
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session3.account.id, otherSession.accountId]));
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
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id]));

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
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session3.account.id, session4.account.id]));

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
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session3.account.id, session4.account.id]));
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
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id]));

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
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session3.account.id, session4.account.id]));

        await deletePostComment(context.action(session3), {
            postId: post.id,
            commentIndex: 0,
        });

        expect(
            await getPostNotificationSubscribers(context.systemAction(space.id), post.id).then(
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session3.account.id, session4.account.id]));
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
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id]));

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
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session3.account.id]));

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
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session3.account.id, session4.account.id]));
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
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session2.account.id]));

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
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session2.account.id]));

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
                ({accountIds}) => accountIds,
            ),
        ).toEqual(new Set([session1.account.id, session3.account.id, session2.account.id]));

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
                ({accountIds}) => accountIds,
            ),
        ).toEqual(
            new Set([
                session1.account.id,
                session3.account.id,
                session2.account.id,
                session4.account.id,
            ]),
        );

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
                ({accountIds}) => accountIds,
            ),
        ).toEqual(
            new Set([
                session1.account.id,
                session3.account.id,
                session2.account.id,
                session4.account.id,
                session5.account.id,
            ]),
        );
    });
});
