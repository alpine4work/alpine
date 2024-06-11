import {addMinutes} from "date-fns";
import {dynamoGeneralRealtimeStaleEventualReadConsistencyWindowMinutes} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {TestLocalEdgeServiceContextModule} from "~/server/dynamo/test_helpers/test_local_edge_service_context_module.js";
import {
    backfillChannelPosts,
    createAlphaSpaceAsAdmin,
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
    updateChannelNameAndDescription,
    updatePostCommentContent,
    updatePostContent,
} from "~/server/forum/data/forum_table.js";
import {
    dangerouslyAddSpaceAccountAsAdmin,
    getAccount,
    getOurAccountSpaceIds,
} from "~/server/spaces/spaces_table.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {
    FailedPreconditionError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
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
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test 1",
    });

    expect((await getChannel(context.action(session1), channel.id)).model.name).toEqual("Test 1");
    expect(
        (await getChannel(context.action(session1), channel.id)).model.description.doc.toJSON(),
    ).toEqual(emptyMessageContent.toJSON());
});

test("can create a channel with a description", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test 2",
        description: createSimpleMessageContent("This is a description"),
    });

    expect((await getChannel(context.action(session1), channel.id)).model.name).toEqual("Test 2");
    expect(
        (await getChannel(context.action(session1), channel.id)).model.description.doc.toJSON(),
    ).toEqual(createSimpleMessageContent("This is a description").toJSON());
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

test("can update a channel's name and description", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test 1",
    });

    expect((await getChannel(context.action(session1), channel.id)).model.name).toEqual("Test 1");
    expect((await getChannel(context.action(session1), channel.id)).model.description.doc).toEqual(
        emptyMessageContent,
    );

    await updateChannelNameAndDescription(context.action(session1), {
        channelId: channel.id,
        name: "Test 2",
        description: testMessageContent1,
    });

    expect((await getChannel(context.action(session1), channel.id)).model.name).toEqual("Test 2");
    expect((await getChannel(context.action(session1), channel.id)).model.description.doc).toEqual(
        testMessageContent1,
    );
});

test("can not update a channel's name and description from a different space", async () => {
    const channel = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test 1",
    });

    expect((await getChannel(context.action(session1), channel.id)).model.name).toEqual("Test 1");

    await expect(
        updateChannelNameAndDescription(context.action(otherSession), {
            channelId: channel.id,
            name: "Test 2",
            description: emptyMessageContent,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect((await getChannel(context.action(session1), channel.id)).model.name).toEqual("Test 1");
});

test("can not update the name and description of a channel that does not exist", async () => {
    await expect(
        updateChannelNameAndDescription(context.action(otherSession), {
            channelId: generateId(),
            name: "Test 2",
            description: emptyMessageContent,
        }),
    ).rejects.toThrow(NotFoundError);
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

    expect((await getPost(context.action(session1), post.id)).model.content.doc.toJSON()).toEqual(
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
    ).toEqual([await getAccount(context.action(session1), space.id, session1.accountId)]);

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
    ).toEqual([
        await getAccount(context.action(session1), space.id, session1.accountId),
        await getAccount(context.action(session2), space.id, session2.accountId),
        await getAccount(context.action(session3), space.id, session3.accountId),
    ]);

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
        await getAccount(context.action(session1), space.id, session1.accountId),
        await getAccount(context.action(session2), space.id, session2.accountId),
        await getAccount(context.action(session3), space.id, session3.accountId),
        await getAccount(context.action(session4), space.id, session4.accountId),
        await getAccount(context.action(session5), space.id, session5.accountId),
        await getAccount(context.action(session6), space.id, session6.accountId),
        await getAccount(context.action(session7), space.id, session7.accountId),
        await getAccount(context.action(session8), space.id, session8.accountId),
    ]);

    await deletePostComment(context.action(session3), {
        postId: post.id,
        commentIndex: 2,
    });

    expect(
        await getPostCommentAuthors(context.action(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        await getAccount(context.action(session1), space.id, session1.accountId),
        await getAccount(context.action(session2), space.id, session2.accountId),
        await getAccount(context.action(session3), space.id, session3.accountId),
        await getAccount(context.action(session4), space.id, session4.accountId),
        await getAccount(context.action(session5), space.id, session5.accountId),
        await getAccount(context.action(session6), space.id, session6.accountId),
        await getAccount(context.action(session7), space.id, session7.accountId),
        await getAccount(context.action(session8), space.id, session8.accountId),
    ]);

    expect(
        await getPostCommentAuthors(context.action(session1), {postId: post.id, limit: 5}),
    ).toEqual([
        await getAccount(context.action(session1), space.id, session1.accountId),
        await getAccount(context.action(session2), space.id, session2.accountId),
        await getAccount(context.action(session3), space.id, session3.accountId),
        await getAccount(context.action(session4), space.id, session4.accountId),
        await getAccount(context.action(session5), space.id, session5.accountId),
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
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session2),
                        space.id,
                        session2.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session2),
                        space.id,
                        session2.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session3),
                        space.id,
                        session3.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session2),
                        space.id,
                        session2.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session3),
                        space.id,
                        session3.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session2),
                        space.id,
                        session2.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session3),
                        space.id,
                        session3.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session2),
                        space.id,
                        session2.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session2),
                        space.id,
                        session2.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session3),
                        space.id,
                        session3.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session2),
                        space.id,
                        session2.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session2),
                        space.id,
                        session2.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session3),
                        space.id,
                        session3.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session2),
                        space.id,
                        session2.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session2),
                        space.id,
                        session2.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session3),
                        space.id,
                        session3.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session2),
                        space.id,
                        session2.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session3),
                        space.id,
                        session3.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session1),
                        space.id,
                        session1.accountId,
                    ),
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
                    author: await getAccount(
                        context.action(session2),
                        space.id,
                        session2.accountId,
                    ),
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

    const post1a = (await getPost(context.action(session1), post1.id)).model;
    const post2a = (await getPost(context.action(session1), post2.id)).model;
    const post3a = (await getPost(context.action(session1), post3.id)).model;
    const post4a = (await getPost(context.action(session1), post4.id)).model;

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

    const post1b = (await getPost(context.action(session1), post1.id)).model;

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

    const post4b = (await getPost(context.action(session1), post4.id)).model;

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

    const post5a = (await getPost(context.action(session1), post5.id)).model;

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

    const post1a = (await getPost(context.action(session1), post.id)).model;

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

    const post1b = (await getPost(context.action(session1), post.id)).model;

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

    const post1c = (await getPost(context.action(session1), post.id)).model;

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

    const post1d = (await getPost(context.action(session1), post.id)).model;

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

    const post1e = (await getPost(context.action(session1), post.id)).model;

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

    const post1f = (await getPost(context.action(session1), post.id)).model;

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

    const post1g = (await getPost(context.action(session1), post.id)).model;

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

    const post1h = (await getPost(context.action(session1), post.id)).model;

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

    expect((await getPost(context.action(session1), post.id)).model).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: "Test",
            spaceId: space.id,
        },
        createdTime: expect.any(Date),
        author: await getAccount(context.action(session1), space.id, session1.accountId),
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

    expect((await getPost(context.action(session1), post.id)).model).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: "Test",
            spaceId: space.id,
        },
        createdTime: expect.any(Date),
        author: await getAccount(context.action(session1), space.id, session1.accountId),
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

    expect((await getPost(context.action(session1), post.id)).model).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: "Test",
            spaceId: space.id,
        },
        createdTime: expect.any(Date),
        author: await getAccount(context.action(session1), space.id, session1.accountId),
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

    expect((await getPost(context.action(session1), post.id)).model).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: "Test",
            spaceId: space.id,
        },
        createdTime: expect.any(Date),
        author: await getAccount(context.action(session1), space.id, session1.accountId),
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

    expect((await getPost(context.action(session1), post.id)).model).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: "Test",
            spaceId: space.id,
        },
        createdTime: expect.any(Date),
        author: await getAccount(context.action(session1), space.id, session1.accountId),
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

    expect((await getPost(context.action(session1), post.id)).model).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: "Test",
            spaceId: space.id,
        },
        createdTime: expect.any(Date),
        author: await getAccount(context.action(session1), space.id, session1.accountId),
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

    expect((await getPost(context.action(session1), post.id)).model).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: "Test",
            spaceId: space.id,
        },
        createdTime: expect.any(Date),
        author: await getAccount(context.action(session1), space.id, session1.accountId),
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

    expect((await getPost(context.action(session1), post.id)).model).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: "Test",
            spaceId: space.id,
        },
        createdTime: expect.any(Date),
        author: await getAccount(context.action(session1), space.id, session1.accountId),
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

    expect((await getPost(context.action(session1), post.id)).model).toEqual({
        id: post.id,
        spaceId: space.id,
        channel: {
            id: channel.id,
            createdTime: channel.createdTime,
            name: "Test",
            spaceId: space.id,
        },
        createdTime: expect.any(Date),
        author: await getAccount(context.action(session1), space.id, session1.accountId),
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
            const updatedPost = (await getPost(context.action(session1), post.id)).model;
            assert(updatedPost);
            expect(updatedPost.contentUpdatedTime).toEqual(new Date(mockTime));
        }

        await updatePostContent(context.action(session1), {
            postId: post.id,
            content: testContent3,
        });

        {
            const updatedPost = (await getPost(context.action(session1), post.id)).model;
            assert(updatedPost);
            expect(updatedPost.contentUpdatedTime).toEqual(new Date(mockTime + 1));
        }
    } finally {
        Date.now = originalDateNow;
    }
});

test("broadcasts channel realtime events to channel", async () => {
    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([]);

    const channel1 = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test 1",
    });
    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([]);

    const channel2 = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test 2",
    });
    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([]);

    const otherChannel = await createChannel(context.action(otherSession), {
        spaceId: otherSpace.id,
        name: "Test 3",
    });
    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([]);

    await updateChannelName(context.action(session1), {
        channelId: channel2.id,
        name: "Test 2 (updated)",
    });
    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
    ]);

    await updateChannelName(context.action(otherSession), {
        channelId: otherChannel.id,
        name: "Test 3 (updated)",
    });
    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
    ]);

    await updateChannelDescription(context.action(session1), {
        channelId: channel1.id,
        description: createSimpleMessageContent("A description"),
    });
    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
    ]);
});

test("broadcasts post realtime events to channel and post", async () => {
    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([]);

    const channel1 = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test 1",
    });

    const channel2 = await createChannel(context.action(session1), {
        spaceId: space.id,
        name: "Test 2",
    });

    const otherChannel = await createChannel(context.action(otherSession), {
        spaceId: otherSpace.id,
        name: "Test 3",
    });

    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([]);

    await createPost(context.action(session1), {
        channelId: channel2.id,
        content: createSimplePostContent("Post 1"),
    });
    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
    ]);

    const post2 = await createPost(context.action(otherSession), {
        channelId: otherChannel.id,
        content: createSimplePostContent("Post 2"),
    });
    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
    ]);

    const post3 = await createPost(context.action(session1), {
        channelId: channel1.id,
        content: createSimplePostContent("Post 2"),
    });
    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
    ]);

    await createPost(context.action(session1), {
        channelId: channel1.id,
        content: createSimplePostContent("Post 4"),
    });
    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
    ]);

    await createPost(context.action(session1), {
        channelId: channel2.id,
        content: createSimplePostContent("Post 5"),
    });
    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
    ]);

    await updatePostContent(context.action(otherSession), {
        postId: post2.id,
        content: createSimplePostContent("Post 2 (updated)"),
    });
    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/posts/${post2.id}/broadcast-realtime-event-transaction`,
    ]);

    await updatePostContent(context.action(session1), {
        postId: post3.id,
        content: createSimplePostContent("Post 3 (updated)"),
    });
    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/posts/${post2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/posts/${post3.id}/broadcast-realtime-event-transaction`,
    ]);

    await createPost(context.action(session1), {
        channelId: channel2.id,
        content: createSimplePostContent("Post 6"),
    });
    await ProcessContextModule.waitForTestTasks();

    expect(
        TestLocalEdgeServiceContextModule.getDurableObjectBroadcasts().map(({url}) => url),
    ).toEqual([
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${otherChannel.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/posts/${post2.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel1.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/posts/${post3.id}/broadcast-realtime-event-transaction`,
        `/api/durable-objects/channels/${channel2.id}/broadcast-realtime-event-transaction`,
    ]);
});

test("can create alpha spaces as admin", async () => {
    const adminAccount = await TestAccount.create(context, {hasInternalAccess: true});
    const otherAccount = await TestAccount.create(context);

    const adminSession = await TestSession.create(adminAccount);
    const otherSession = await TestSession.create(otherAccount);

    await expect(
        createAlphaSpaceAsAdmin(otherSession.action(), {
            name: "Hello",
            ownerAccountId: otherSession.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        createAlphaSpaceAsAdmin(otherSession.action(), {
            name: "Hello",
            ownerAccountId: adminSession.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    const result1 = await createAlphaSpaceAsAdmin(adminSession.action(), {
        name: "Hello 1",
        ownerAccountId: otherSession.account.id,
    });

    const result2 = await createAlphaSpaceAsAdmin(adminSession.action(), {
        name: "Hello 2",
        ownerAccountId: adminSession.account.id,
    });

    await expect(
        createAlphaSpaceAsAdmin(adminSession.action(), {
            name: "Hello 3",
            ownerAccountId: generateId(),
        }),
    ).rejects.toThrow(NotFoundError);

    await expect(
        createChannel(adminSession.action(), {
            spaceId: result1.spaceId,
            name: "Channel 1",
        }),
    ).rejects.toThrow(PermissionDeniedError);

    const channel1 = await createChannel(adminSession.action(), {
        spaceId: result2.spaceId,
        name: "Channel 2",
    });

    const channel2 = await createChannel(otherSession.action(), {
        spaceId: result1.spaceId,
        name: "Channel 3",
    });

    await expect(
        createChannel(otherSession.action(), {
            spaceId: result2.spaceId,
            name: "Channel 4",
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await getChannel(adminSession.action(), channel1.id);
    await expect(getChannel(otherSession.action(), channel1.id)).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(getChannel(adminSession.action(), channel2.id)).rejects.toThrow(
        PermissionDeniedError,
    );
    await getChannel(otherSession.action(), channel2.id);
});

test("can add accounts to spaces as admin", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);

    const session1 = await space1.createSession();
    const session2 = await space2.createSession();
    const session3 = await TestSession.create(await TestAccount.create(context));
    const session4 = await TestSession.create(await TestAccount.create(context));

    const adminSession = await TestSession.create(
        await TestAccount.create(context, {hasInternalAccess: true}),
    );

    expect((await getOurAccountSpaceIds(session1.action())).spaceIds).toEqual(new Set([space1.id]));
    expect((await getOurAccountSpaceIds(session2.action())).spaceIds).toEqual(new Set([space2.id]));
    expect((await getOurAccountSpaceIds(session3.action())).spaceIds).toEqual(new Set([]));
    expect((await getOurAccountSpaceIds(session4.action())).spaceIds).toEqual(new Set([]));
    expect((await getOurAccountSpaceIds(adminSession.action())).spaceIds).toEqual(new Set([]));

    await expect(
        dangerouslyAddSpaceAccountAsAdmin(session3.action(), {
            spaceId: space1.id,
            accountId: session3.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        dangerouslyAddSpaceAccountAsAdmin(session3.action(), {
            spaceId: space1.id,
            accountId: session4.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        dangerouslyAddSpaceAccountAsAdmin(session3.action(), {
            spaceId: space1.id,
            accountId: session1.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        dangerouslyAddSpaceAccountAsAdmin(session3.action(), {
            spaceId: space1.id,
            accountId: session2.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        dangerouslyAddSpaceAccountAsAdmin(session2.action(), {
            spaceId: space2.id,
            accountId: session2.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        dangerouslyAddSpaceAccountAsAdmin(session2.action(), {
            spaceId: space2.id,
            accountId: session1.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect((await getOurAccountSpaceIds(session1.action())).spaceIds).toEqual(new Set([space1.id]));
    expect((await getOurAccountSpaceIds(session2.action())).spaceIds).toEqual(new Set([space2.id]));
    expect((await getOurAccountSpaceIds(session3.action())).spaceIds).toEqual(new Set([]));
    expect((await getOurAccountSpaceIds(session4.action())).spaceIds).toEqual(new Set([]));
    expect((await getOurAccountSpaceIds(adminSession.action())).spaceIds).toEqual(new Set([]));

    const channel1 = await createChannel(session1.action(), {
        spaceId: space1.id,
        name: "Channel 1",
    });

    await expect(getChannel(session3.action(), channel1.id)).rejects.toThrow(PermissionDeniedError);

    expect((await getOurAccountSpaceIds(session1.action())).spaceIds).toEqual(new Set([space1.id]));
    expect((await getOurAccountSpaceIds(session2.action())).spaceIds).toEqual(new Set([space2.id]));
    expect((await getOurAccountSpaceIds(session3.action())).spaceIds).toEqual(new Set([]));
    expect((await getOurAccountSpaceIds(session4.action())).spaceIds).toEqual(new Set([]));
    expect((await getOurAccountSpaceIds(adminSession.action())).spaceIds).toEqual(new Set([]));

    await expect(
        dangerouslyAddSpaceAccountAsAdmin(adminSession.action(), {
            spaceId: space1.id,
            accountId: generateId(),
        }),
    ).rejects.toThrow(NotFoundError);

    await expect(
        dangerouslyAddSpaceAccountAsAdmin(adminSession.action(), {
            spaceId: generateId(),
            accountId: session3.account.id,
        }),
    ).rejects.toThrow(NotFoundError);

    await dangerouslyAddSpaceAccountAsAdmin(adminSession.action(), {
        spaceId: space1.id,
        accountId: session3.account.id,
    });

    await getChannel(session3.action(), channel1.id);

    expect((await getOurAccountSpaceIds(session1.action())).spaceIds).toEqual(new Set([space1.id]));
    expect((await getOurAccountSpaceIds(session2.action())).spaceIds).toEqual(new Set([space2.id]));
    expect((await getOurAccountSpaceIds(session3.action())).spaceIds).toEqual(new Set([space1.id]));
    expect((await getOurAccountSpaceIds(session4.action())).spaceIds).toEqual(new Set([]));
    expect((await getOurAccountSpaceIds(adminSession.action())).spaceIds).toEqual(new Set([]));

    await expect(getChannel(adminSession.action(), channel1.id)).rejects.toThrow(
        PermissionDeniedError,
    );

    await dangerouslyAddSpaceAccountAsAdmin(adminSession.action(), {
        spaceId: space1.id,
        accountId: adminSession.account.id,
    });

    await getChannel(adminSession.action(), channel1.id);

    expect((await getOurAccountSpaceIds(session1.action())).spaceIds).toEqual(new Set([space1.id]));
    expect((await getOurAccountSpaceIds(session2.action())).spaceIds).toEqual(new Set([space2.id]));
    expect((await getOurAccountSpaceIds(session3.action())).spaceIds).toEqual(new Set([space1.id]));
    expect((await getOurAccountSpaceIds(session4.action())).spaceIds).toEqual(new Set([]));
    expect((await getOurAccountSpaceIds(adminSession.action())).spaceIds).toEqual(
        new Set([space1.id]),
    );

    await expect(
        dangerouslyAddSpaceAccountAsAdmin(adminSession.action(), {
            spaceId: space1.id,
            accountId: session3.account.id,
        }),
    ).rejects.toThrow(FailedPreconditionError);

    await expect(
        dangerouslyAddSpaceAccountAsAdmin(adminSession.action(), {
            spaceId: space2.id,
            accountId: session2.account.id,
        }),
    ).rejects.toThrow(FailedPreconditionError);

    expect((await getOurAccountSpaceIds(session1.action())).spaceIds).toEqual(new Set([space1.id]));
    expect((await getOurAccountSpaceIds(session2.action())).spaceIds).toEqual(new Set([space2.id]));
    expect((await getOurAccountSpaceIds(session3.action())).spaceIds).toEqual(new Set([space1.id]));
    expect((await getOurAccountSpaceIds(session4.action())).spaceIds).toEqual(new Set([]));
    expect((await getOurAccountSpaceIds(adminSession.action())).spaceIds).toEqual(
        new Set([space1.id]),
    );

    await expect(getChannel(session2.action(), channel1.id)).rejects.toThrow(PermissionDeniedError);

    await dangerouslyAddSpaceAccountAsAdmin(adminSession.action(), {
        spaceId: space1.id,
        accountId: session2.account.id,
    });

    await getChannel(session2.action(), channel1.id);

    expect((await getOurAccountSpaceIds(session1.action())).spaceIds).toEqual(new Set([space1.id]));
    expect((await getOurAccountSpaceIds(session2.action())).spaceIds).toEqual(
        new Set([space2.id, space1.id]),
    );
    expect((await getOurAccountSpaceIds(session3.action())).spaceIds).toEqual(new Set([space1.id]));
    expect((await getOurAccountSpaceIds(session4.action())).spaceIds).toEqual(new Set([]));
    expect((await getOurAccountSpaceIds(adminSession.action())).spaceIds).toEqual(
        new Set([space1.id]),
    );
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
