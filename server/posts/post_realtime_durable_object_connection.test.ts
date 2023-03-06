import {createChannel, updatePostCommentContent} from "~/server/dynamo/forum_table";
import {createPost, createPostComment} from "~/server/dynamo/forum_table";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context";
import {createTestSession} from "~/server/dynamo/test_helpers/shared/create_test_session";
import {createTestSpace} from "~/server/dynamo/test_helpers/shared/create_test_space";
import {
    PostRealtimeDurableObjectConnection,
    postRealtimeBackfillCommentsBeforeFlushTestCheckpoint,
    postRealtimeCreateCommentBeforeSendTestCheckpoint,
} from "~/server/posts/post_realtime_durable_object_connection";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema";
import {createSimplePostContent} from "~/shared/content/post_content_schema";
import {emptyContentReferences} from "~/shared/models/content_references";
import {MessageContentWithReferences} from "~/shared/models/message_model";
import {PostRealtimeMessageFromServer} from "~/shared/posts/post_realtime_schema";

const context = createTestContext();
const space = createTestSpace(context);
const session1 = createTestSession(context, space);
const session2 = createTestSession(context, space);
const session3 = createTestSession(context, space);

const postContent = createSimplePostContent("test");

const content1 = createSimpleMessageContent("test1");
const content2 = createSimpleMessageContent("test2");
const content3 = createSimpleMessageContent("test3");

const content1WithReferences: MessageContentWithReferences = {
    doc: content1,
    references: emptyContentReferences,
};
const content2WithReferences: MessageContentWithReferences = {
    doc: content2,
    references: emptyContentReferences,
};
const content3WithReferences: MessageContentWithReferences = {
    doc: content3,
    references: emptyContentReferences,
};

test("will backfill comments when requested", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: postContent,
    });

    await createPostComment(context.request(session1), {
        postId: post.id,
        parentPostCommentIndex: null,
        content: content1,
    });

    await createPostComment(context.request(session2), {
        postId: post.id,
        parentPostCommentIndex: null,
        content: content2,
    });

    await createPostComment(context.request(session3), {
        postId: post.id,
        parentPostCommentIndex: null,
        content: content3,
    });

    let connection1Messages: Array<PostRealtimeMessageFromServer> = [];

    const connection1 = new PostRealtimeDurableObjectConnection({
        spaceId: space.id,
        postId: post.id,
        sendMessage: (context, message) => connection1Messages.push(message),
        iterateOtherConnections: () => [],
    });

    expect(connection1Messages.length).toEqual(0);

    await connection1.handleMessage(context.request(session1), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 0,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 100,
    });

    expect(connection1Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 3,
            lastPostCommentChangeTime: null,
            newPostComments: [
                {
                    postId: post.id,
                    index: 0,
                    author: session1.account,
                    createdTime: expect.any(Date),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: content1WithReferences,
                        contentUpdatedTime: null,
                    },
                },
                {
                    postId: post.id,
                    index: 1,
                    author: session2.account,
                    createdTime: expect.any(Date),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: content2WithReferences,
                        contentUpdatedTime: null,
                    },
                },
                {
                    postId: post.id,
                    index: 2,
                    author: session3.account,
                    createdTime: expect.any(Date),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: content3WithReferences,
                        contentUpdatedTime: null,
                    },
                },
            ],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {type: "Available", changes: []},
        },
    ]);
    connection1Messages = [];

    await connection1.handleMessage(context.request(session1), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 1,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 100,
    });

    expect(connection1Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 3,
            lastPostCommentChangeTime: null,
            newPostComments: [
                {
                    postId: post.id,
                    index: 1,
                    author: session2.account,
                    createdTime: expect.any(Date),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: content2WithReferences,
                        contentUpdatedTime: null,
                    },
                },
                {
                    postId: post.id,
                    index: 2,
                    author: session3.account,
                    createdTime: expect.any(Date),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: content3WithReferences,
                        contentUpdatedTime: null,
                    },
                },
            ],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {type: "Available", changes: []},
        },
    ]);
    connection1Messages = [];

    await connection1.handleMessage(context.request(session2), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 0,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 2,
    });

    expect(connection1Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 3,
            lastPostCommentChangeTime: null,
            newPostComments: [
                {
                    postId: post.id,
                    index: 0,
                    author: session1.account,
                    createdTime: expect.any(Date),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: content1WithReferences,
                        contentUpdatedTime: null,
                    },
                },
                {
                    postId: post.id,
                    index: 1,
                    author: session2.account,
                    createdTime: expect.any(Date),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: content2WithReferences,
                        contentUpdatedTime: null,
                    },
                },
            ],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {type: "Available", changes: []},
        },
    ]);
    connection1Messages = [];

    expect(connection1Messages.length).toEqual(0);
});

test("will send comments from other connections", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: postContent,
    });

    await createPostComment(context.request(session1), {
        postId: post.id,
        parentPostCommentIndex: null,
        content: content1,
    });

    let connection1Messages: Array<PostRealtimeMessageFromServer> = [];
    let connection2Messages: Array<PostRealtimeMessageFromServer> = [];
    let connection3Messages: Array<PostRealtimeMessageFromServer> = [];

    const connection1: PostRealtimeDurableObjectConnection =
        new PostRealtimeDurableObjectConnection({
            spaceId: space.id,
            postId: post.id,
            sendMessage: (context, message) => connection1Messages.push(message),
            iterateOtherConnections: () => [connection2, connection3],
        });

    const connection2: PostRealtimeDurableObjectConnection =
        new PostRealtimeDurableObjectConnection({
            spaceId: space.id,
            postId: post.id,
            sendMessage: (context, message) => connection2Messages.push(message),
            iterateOtherConnections: () => [connection1, connection3],
        });

    const connection3: PostRealtimeDurableObjectConnection =
        new PostRealtimeDurableObjectConnection({
            spaceId: space.id,
            postId: post.id,
            sendMessage: (context, message) => connection3Messages.push(message),
            iterateOtherConnections: () => [connection1, connection2],
        });

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
    expect(connection3Messages).toEqual([]);

    await connection1.handleMessage(context.request(session1), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 1,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 100,
    });

    await connection2.handleMessage(context.request(session2), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 1,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 100,
    });

    expect(connection1Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 1,
            lastPostCommentChangeTime: null,
            newPostComments: [],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {type: "Available", changes: []},
        },
    ]);
    expect(connection2Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 1,
            lastPostCommentChangeTime: null,
            newPostComments: [],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {type: "Available", changes: []},
        },
    ]);
    expect(connection3Messages).toEqual([]);
    connection1Messages = [];
    connection2Messages = [];
    connection3Messages = [];

    await connection2.handleMessage(context.request(session2), {
        type: "CreatePostComment",
        parentPostCommentIndex: null,
        content: content2,
    });

    expect(connection1Messages).toEqual([
        {
            type: "NewPostComment",
            postComment: {
                postId: post.id,
                index: 1,
                author: session2.account,
                createdTime: expect.any(Date),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: content2WithReferences,
                    contentUpdatedTime: null,
                },
            },
        },
    ]);
    expect(connection2Messages).toEqual([
        {
            type: "NewPostComment",
            postComment: {
                postId: post.id,
                index: 1,
                author: session2.account,
                createdTime: expect.any(Date),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: content2WithReferences,
                    contentUpdatedTime: null,
                },
            },
        },
    ]);
    expect(connection3Messages).toEqual([]);
    connection1Messages = [];
    connection2Messages = [];
    connection3Messages = [];

    await connection2.handleMessage(context.request(session2), {
        type: "CreatePostComment",
        parentPostCommentIndex: null,
        content: content3,
    });

    expect(connection1Messages).toEqual([
        {
            type: "NewPostComment",
            postComment: {
                postId: post.id,
                index: 2,
                author: session2.account,
                createdTime: expect.any(Date),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: content3WithReferences,
                    contentUpdatedTime: null,
                },
            },
        },
    ]);
    expect(connection2Messages).toEqual([
        {
            type: "NewPostComment",
            postComment: {
                postId: post.id,
                index: 2,
                author: session2.account,
                createdTime: expect.any(Date),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: content3WithReferences,
                    contentUpdatedTime: null,
                },
            },
        },
    ]);
    expect(connection3Messages).toEqual([]);
    connection1Messages = [];
    connection2Messages = [];
    connection3Messages = [];

    await connection3.handleMessage(context.request(session3), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 1,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 100,
    });

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
    expect(connection3Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 3,
            lastPostCommentChangeTime: null,
            newPostComments: [
                {
                    postId: post.id,
                    index: 1,
                    author: session2.account,
                    createdTime: expect.any(Date),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: content2WithReferences,
                        contentUpdatedTime: null,
                    },
                },
                {
                    postId: post.id,
                    index: 2,
                    author: session2.account,
                    createdTime: expect.any(Date),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: content3WithReferences,
                        contentUpdatedTime: null,
                    },
                },
            ],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {type: "Available", changes: []},
        },
    ]);
    connection1Messages = [];
    connection2Messages = [];
    connection3Messages = [];

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
    expect(connection3Messages).toEqual([]);
});

test("will send comments from other connections when those comments are added during backfill", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: postContent,
    });

    await createPostComment(context.request(session1), {
        postId: post.id,
        parentPostCommentIndex: null,
        content: content1,
    });

    let connection1Messages: Array<PostRealtimeMessageFromServer> = [];
    let connection2Messages: Array<PostRealtimeMessageFromServer> = [];
    let connection3Messages: Array<PostRealtimeMessageFromServer> = [];

    const connection1: PostRealtimeDurableObjectConnection =
        new PostRealtimeDurableObjectConnection({
            spaceId: space.id,
            postId: post.id,
            sendMessage: (context, message) => connection1Messages.push(message),
            iterateOtherConnections: () => [connection2, connection3],
        });

    const connection2: PostRealtimeDurableObjectConnection =
        new PostRealtimeDurableObjectConnection({
            spaceId: space.id,
            postId: post.id,
            sendMessage: (context, message) => connection2Messages.push(message),
            iterateOtherConnections: () => [connection1, connection3],
        });

    const connection3: PostRealtimeDurableObjectConnection =
        new PostRealtimeDurableObjectConnection({
            spaceId: space.id,
            postId: post.id,
            sendMessage: (context, message) => connection3Messages.push(message),
            iterateOtherConnections: () => [connection1, connection2],
        });

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
    expect(connection3Messages).toEqual([]);

    await connection1.handleMessage(context.request(session1), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 1,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 100,
    });

    await connection2.handleMessage(context.request(session2), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 1,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 100,
    });

    const pausePromise = postRealtimeBackfillCommentsBeforeFlushTestCheckpoint.pauseForTest(
        session3.id,
    );

    const connection3BackfillPromise = connection3.handleMessage(context.request(session3), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 1,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 100,
    });

    const {unpause} = await pausePromise;

    expect(connection1Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 1,
            lastPostCommentChangeTime: null,
            newPostComments: [],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {type: "Available", changes: []},
        },
    ]);
    expect(connection2Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 1,
            lastPostCommentChangeTime: null,
            newPostComments: [],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {type: "Available", changes: []},
        },
    ]);
    expect(connection3Messages).toEqual([]);
    connection1Messages = [];
    connection2Messages = [];
    connection3Messages = [];

    await connection2.handleMessage(context.request(session2), {
        type: "CreatePostComment",
        parentPostCommentIndex: null,
        content: content2,
    });

    expect(connection1Messages).toEqual([
        {
            type: "NewPostComment",
            postComment: {
                postId: post.id,
                index: 1,
                author: session2.account,
                createdTime: expect.any(Date),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: content2WithReferences,
                    contentUpdatedTime: null,
                },
            },
        },
    ]);
    expect(connection2Messages).toEqual([
        {
            type: "NewPostComment",
            postComment: {
                postId: post.id,
                index: 1,
                author: session2.account,
                createdTime: expect.any(Date),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: content2WithReferences,
                    contentUpdatedTime: null,
                },
            },
        },
    ]);
    expect(connection3Messages).toEqual([]);
    connection1Messages = [];
    connection2Messages = [];
    connection3Messages = [];

    await connection2.handleMessage(context.request(session2), {
        type: "CreatePostComment",
        parentPostCommentIndex: null,
        content: content3,
    });

    expect(connection1Messages).toEqual([
        {
            type: "NewPostComment",
            postComment: {
                postId: post.id,
                index: 2,
                author: session2.account,
                createdTime: expect.any(Date),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: content3WithReferences,
                    contentUpdatedTime: null,
                },
            },
        },
    ]);
    expect(connection2Messages).toEqual([
        {
            type: "NewPostComment",
            postComment: {
                postId: post.id,
                index: 2,
                author: session2.account,
                createdTime: expect.any(Date),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: content3WithReferences,
                    contentUpdatedTime: null,
                },
            },
        },
    ]);
    expect(connection3Messages).toEqual([]);
    connection1Messages = [];
    connection2Messages = [];
    connection3Messages = [];

    unpause();
    await connection3BackfillPromise;

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
    expect(connection3Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 1,
            lastPostCommentChangeTime: null,
            newPostComments: [],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {type: "Available", changes: []},
        },
        {
            type: "NewPostComment",
            postComment: {
                postId: post.id,
                index: 1,
                author: session2.account,
                createdTime: expect.any(Date),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: content2WithReferences,
                    contentUpdatedTime: null,
                },
            },
        },
        {
            type: "NewPostComment",
            postComment: {
                postId: post.id,
                index: 2,
                author: session2.account,
                createdTime: expect.any(Date),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: content3WithReferences,
                    contentUpdatedTime: null,
                },
            },
        },
    ]);
    connection1Messages = [];
    connection2Messages = [];
    connection3Messages = [];

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
    expect(connection3Messages).toEqual([]);
});

test("will send comments our connection when those comments are added during backfill", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: postContent,
    });

    await createPostComment(context.request(session1), {
        postId: post.id,
        parentPostCommentIndex: null,
        content: content1,
    });

    let connection1Messages: Array<PostRealtimeMessageFromServer> = [];
    let connection2Messages: Array<PostRealtimeMessageFromServer> = [];
    let connection3Messages: Array<PostRealtimeMessageFromServer> = [];

    const connection1: PostRealtimeDurableObjectConnection =
        new PostRealtimeDurableObjectConnection({
            spaceId: space.id,
            postId: post.id,
            sendMessage: (context, message) => connection1Messages.push(message),
            iterateOtherConnections: () => [connection2, connection3],
        });

    const connection2: PostRealtimeDurableObjectConnection =
        new PostRealtimeDurableObjectConnection({
            spaceId: space.id,
            postId: post.id,
            sendMessage: (context, message) => connection2Messages.push(message),
            iterateOtherConnections: () => [connection1, connection3],
        });

    const connection3: PostRealtimeDurableObjectConnection =
        new PostRealtimeDurableObjectConnection({
            spaceId: space.id,
            postId: post.id,
            sendMessage: (context, message) => connection3Messages.push(message),
            iterateOtherConnections: () => [connection1, connection2],
        });

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
    expect(connection3Messages).toEqual([]);

    await connection1.handleMessage(context.request(session1), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 1,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 100,
    });

    await connection2.handleMessage(context.request(session2), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 1,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 100,
    });

    const pausePromise = postRealtimeBackfillCommentsBeforeFlushTestCheckpoint.pauseForTest(
        session3.id,
    );

    const connection3BackfillPromise = connection3.handleMessage(context.request(session3), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 1,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 100,
    });

    const {unpause} = await pausePromise;

    expect(connection1Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 1,
            lastPostCommentChangeTime: null,
            newPostComments: [],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {type: "Available", changes: []},
        },
    ]);
    expect(connection2Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 1,
            lastPostCommentChangeTime: null,
            newPostComments: [],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {type: "Available", changes: []},
        },
    ]);
    expect(connection3Messages).toEqual([]);
    connection1Messages = [];
    connection2Messages = [];
    connection3Messages = [];

    await connection3.handleMessage(context.request(session3), {
        type: "CreatePostComment",
        parentPostCommentIndex: null,
        content: content2,
    });

    expect(connection1Messages).toEqual([
        {
            type: "NewPostComment",
            postComment: {
                postId: post.id,
                index: 1,
                author: session3.account,
                createdTime: expect.any(Date),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: content2WithReferences,
                    contentUpdatedTime: null,
                },
            },
        },
    ]);
    expect(connection2Messages).toEqual([
        {
            type: "NewPostComment",
            postComment: {
                postId: post.id,
                index: 1,
                author: session3.account,
                createdTime: expect.any(Date),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: content2WithReferences,
                    contentUpdatedTime: null,
                },
            },
        },
    ]);
    expect(connection3Messages).toEqual([]);
    connection1Messages = [];
    connection2Messages = [];
    connection3Messages = [];

    unpause();
    await connection3BackfillPromise;

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
    expect(connection3Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 1,
            lastPostCommentChangeTime: null,
            newPostComments: [],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {type: "Available", changes: []},
        },
        {
            type: "NewPostComment",
            postComment: {
                postId: post.id,
                index: 1,
                author: session3.account,
                createdTime: expect.any(Date),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: content2WithReferences,
                    contentUpdatedTime: null,
                },
            },
        },
    ]);
    connection1Messages = [];
    connection2Messages = [];
    connection3Messages = [];

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
    expect(connection3Messages).toEqual([]);
});

test("will send comments from other connections in order", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: postContent,
    });

    let connection1Messages: Array<PostRealtimeMessageFromServer> = [];
    let connection2Messages: Array<PostRealtimeMessageFromServer> = [];
    let connection3Messages: Array<PostRealtimeMessageFromServer> = [];

    const connection1: PostRealtimeDurableObjectConnection =
        new PostRealtimeDurableObjectConnection({
            spaceId: space.id,
            postId: post.id,
            sendMessage: (context, message) => connection1Messages.push(message),
            iterateOtherConnections: () => [connection2, connection3],
        });

    const connection2: PostRealtimeDurableObjectConnection =
        new PostRealtimeDurableObjectConnection({
            spaceId: space.id,
            postId: post.id,
            sendMessage: (context, message) => connection2Messages.push(message),
            iterateOtherConnections: () => [connection1, connection3],
        });

    const connection3: PostRealtimeDurableObjectConnection =
        new PostRealtimeDurableObjectConnection({
            spaceId: space.id,
            postId: post.id,
            sendMessage: (context, message) => connection3Messages.push(message),
            iterateOtherConnections: () => [connection1, connection2],
        });

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
    expect(connection3Messages).toEqual([]);

    await connection1.handleMessage(context.request(session1), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 0,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 100,
    });

    await connection2.handleMessage(context.request(session2), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 0,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 100,
    });

    await connection3.handleMessage(context.request(session2), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 0,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 100,
    });

    expect(connection1Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 0,
            lastPostCommentChangeTime: null,
            newPostComments: [],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {type: "Available", changes: []},
        },
    ]);
    expect(connection2Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 0,
            lastPostCommentChangeTime: null,
            newPostComments: [],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {type: "Available", changes: []},
        },
    ]);
    expect(connection3Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 0,
            lastPostCommentChangeTime: null,
            newPostComments: [],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {type: "Available", changes: []},
        },
    ]);
    connection1Messages = [];
    connection2Messages = [];
    connection3Messages = [];

    const pausePromise = postRealtimeCreateCommentBeforeSendTestCheckpoint.pauseForTest(
        session1.id,
    );

    const connection1CreateMessagePromise = connection1.handleMessage(context.request(session1), {
        type: "CreatePostComment",
        parentPostCommentIndex: null,
        content: content1,
    });

    const {unpause} = await pausePromise;

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
    expect(connection3Messages).toEqual([]);
    connection1Messages = [];
    connection2Messages = [];
    connection3Messages = [];

    await connection2.handleMessage(context.request(session2), {
        type: "CreatePostComment",
        parentPostCommentIndex: null,
        content: content2,
    });

    await connection3.handleMessage(context.request(session3), {
        type: "CreatePostComment",
        parentPostCommentIndex: null,
        content: content3,
    });

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
    expect(connection3Messages).toEqual([]);
    connection1Messages = [];
    connection2Messages = [];
    connection3Messages = [];

    unpause();
    await connection1CreateMessagePromise;

    expect(connection1Messages).toEqual([
        {
            type: "NewPostComment",
            postComment: {
                postId: post.id,
                index: 0,
                author: session1.account,
                createdTime: expect.any(Date),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: content1WithReferences,
                    contentUpdatedTime: null,
                },
            },
        },
        {
            type: "NewPostComment",
            postComment: {
                postId: post.id,
                index: 1,
                author: session2.account,
                createdTime: expect.any(Date),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: content2WithReferences,
                    contentUpdatedTime: null,
                },
            },
        },
        {
            type: "NewPostComment",
            postComment: {
                postId: post.id,
                index: 2,
                author: session3.account,
                createdTime: expect.any(Date),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: content3WithReferences,
                    contentUpdatedTime: null,
                },
            },
        },
    ]);
    expect(connection2Messages).toEqual(connection1Messages);
    expect(connection3Messages).toEqual(connection1Messages);
    connection1Messages = [];
    connection2Messages = [];
    connection3Messages = [];

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
    expect(connection3Messages).toEqual([]);
});

test("will send comments from other connections in order even if it is wacky", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: postContent,
    });

    let connection1Messages: Array<PostRealtimeMessageFromServer> = [];
    let connection2Messages: Array<PostRealtimeMessageFromServer> = [];
    let connection3Messages: Array<PostRealtimeMessageFromServer> = [];

    const connection1: PostRealtimeDurableObjectConnection =
        new PostRealtimeDurableObjectConnection({
            spaceId: space.id,
            postId: post.id,
            sendMessage: (context, message) => connection1Messages.push(message),
            iterateOtherConnections: () => [connection2, connection3],
        });

    const connection2: PostRealtimeDurableObjectConnection =
        new PostRealtimeDurableObjectConnection({
            spaceId: space.id,
            postId: post.id,
            sendMessage: (context, message) => connection2Messages.push(message),
            iterateOtherConnections: () => [connection1, connection3],
        });

    const connection3: PostRealtimeDurableObjectConnection =
        new PostRealtimeDurableObjectConnection({
            spaceId: space.id,
            postId: post.id,
            sendMessage: (context, message) => connection3Messages.push(message),
            iterateOtherConnections: () => [connection1, connection2],
        });

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
    expect(connection3Messages).toEqual([]);

    await connection1.handleMessage(context.request(session1), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 0,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 100,
    });

    await connection2.handleMessage(context.request(session2), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 0,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 100,
    });

    await connection3.handleMessage(context.request(session2), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 0,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 100,
    });

    expect(connection1Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 0,
            lastPostCommentChangeTime: null,
            newPostComments: [],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {type: "Available", changes: []},
        },
    ]);
    expect(connection2Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 0,
            lastPostCommentChangeTime: null,
            newPostComments: [],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {type: "Available", changes: []},
        },
    ]);
    expect(connection3Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 0,
            lastPostCommentChangeTime: null,
            newPostComments: [],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {type: "Available", changes: []},
        },
    ]);
    connection1Messages = [];
    connection2Messages = [];
    connection3Messages = [];

    const pause1Promise = postRealtimeCreateCommentBeforeSendTestCheckpoint.pauseForTest(
        session1.id,
    );

    const connection1CreateMessagePromise = connection1.handleMessage(context.request(session1), {
        type: "CreatePostComment",
        parentPostCommentIndex: null,
        content: content1,
    });

    const {unpause: unpause1} = await pause1Promise;

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
    expect(connection3Messages).toEqual([]);
    connection1Messages = [];
    connection2Messages = [];
    connection3Messages = [];

    const pause2Promise = postRealtimeCreateCommentBeforeSendTestCheckpoint.pauseForTest(
        session2.id,
    );

    const connection2CreateMessagePromise = connection2.handleMessage(context.request(session2), {
        type: "CreatePostComment",
        parentPostCommentIndex: null,
        content: content2,
    });

    const {unpause: unpause2} = await pause2Promise;

    await connection3.handleMessage(context.request(session3), {
        type: "CreatePostComment",
        parentPostCommentIndex: null,
        content: content3,
    });

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
    expect(connection3Messages).toEqual([]);
    connection1Messages = [];
    connection2Messages = [];
    connection3Messages = [];

    unpause2();
    await connection2CreateMessagePromise;

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
    expect(connection3Messages).toEqual([]);
    connection1Messages = [];
    connection2Messages = [];
    connection3Messages = [];

    unpause1();
    await connection1CreateMessagePromise;

    expect(connection1Messages).toEqual([
        {
            type: "NewPostComment",
            postComment: {
                postId: post.id,
                index: 0,
                author: session1.account,
                createdTime: expect.any(Date),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: content1WithReferences,
                    contentUpdatedTime: null,
                },
            },
        },
        {
            type: "NewPostComment",
            postComment: {
                postId: post.id,
                index: 1,
                author: session2.account,
                createdTime: expect.any(Date),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: content2WithReferences,
                    contentUpdatedTime: null,
                },
            },
        },
        {
            type: "NewPostComment",
            postComment: {
                postId: post.id,
                index: 2,
                author: session3.account,
                createdTime: expect.any(Date),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: content3WithReferences,
                    contentUpdatedTime: null,
                },
            },
        },
    ]);
    expect(connection2Messages).toEqual(connection1Messages);
    expect(connection3Messages).toEqual(connection1Messages);
    connection1Messages = [];
    connection2Messages = [];
    connection3Messages = [];

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
    expect(connection3Messages).toEqual([]);
});

test("will ignore new messages if they are part of the backfill", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: postContent,
    });

    let connection1Messages: Array<PostRealtimeMessageFromServer> = [];
    let connection2Messages: Array<PostRealtimeMessageFromServer> = [];

    const connection1: PostRealtimeDurableObjectConnection =
        new PostRealtimeDurableObjectConnection({
            spaceId: space.id,
            postId: post.id,
            sendMessage: (context, message) => connection1Messages.push(message),
            iterateOtherConnections: () => [connection2],
        });

    const connection2: PostRealtimeDurableObjectConnection =
        new PostRealtimeDurableObjectConnection({
            spaceId: space.id,
            postId: post.id,
            sendMessage: (context, message) => connection2Messages.push(message),
            iterateOtherConnections: () => [connection1],
        });

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);

    await connection1.handleMessage(context.request(session1), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 0,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 100,
    });

    expect(connection1Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 0,
            lastPostCommentChangeTime: null,
            newPostComments: [],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {type: "Available", changes: []},
        },
    ]);
    expect(connection2Messages).toEqual([]);
    connection1Messages = [];
    connection2Messages = [];

    const pausePromise = postRealtimeCreateCommentBeforeSendTestCheckpoint.pauseForTest(
        session1.id,
    );

    const connection1CreateMessagePromise = connection1.handleMessage(context.request(session1), {
        type: "CreatePostComment",
        parentPostCommentIndex: null,
        content: content1,
    });

    const {unpause} = await pausePromise;

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
    connection1Messages = [];
    connection2Messages = [];

    await connection2.handleMessage(context.request(session2), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 0,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 100,
    });

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 1,
            lastPostCommentChangeTime: null,
            newPostComments: [
                {
                    postId: post.id,
                    index: 0,
                    author: session1.account,
                    createdTime: expect.any(Date),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: content1WithReferences,
                        contentUpdatedTime: null,
                    },
                },
            ],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {type: "Available", changes: []},
        },
    ]);
    connection1Messages = [];
    connection2Messages = [];

    unpause();
    await connection1CreateMessagePromise;

    expect(connection1Messages).toEqual([
        {
            type: "NewPostComment",
            postComment: {
                postId: post.id,
                index: 0,
                author: session1.account,
                createdTime: expect.any(Date),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: content1WithReferences,
                    contentUpdatedTime: null,
                },
            },
        },
    ]);
    expect(connection2Messages).toEqual([]);
    connection1Messages = [];
    connection2Messages = [];

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
});

test("will ignore new messages if they are queued but part of the backfill", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: postContent,
    });

    let connection1Messages: Array<PostRealtimeMessageFromServer> = [];
    let connection2Messages: Array<PostRealtimeMessageFromServer> = [];

    const connection1: PostRealtimeDurableObjectConnection =
        new PostRealtimeDurableObjectConnection({
            spaceId: space.id,
            postId: post.id,
            sendMessage: (context, message) => connection1Messages.push(message),
            iterateOtherConnections: () => [connection2],
        });

    const connection2: PostRealtimeDurableObjectConnection =
        new PostRealtimeDurableObjectConnection({
            spaceId: space.id,
            postId: post.id,
            sendMessage: (context, message) => connection2Messages.push(message),
            iterateOtherConnections: () => [connection1],
        });

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);

    await connection1.handleMessage(context.request(session1), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 0,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 100,
    });

    expect(connection1Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 0,
            lastPostCommentChangeTime: null,
            newPostComments: [],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {type: "Available", changes: []},
        },
    ]);
    expect(connection2Messages).toEqual([]);
    connection1Messages = [];
    connection2Messages = [];

    const pausePromise1 = postRealtimeCreateCommentBeforeSendTestCheckpoint.pauseForTest(
        session1.id,
    );

    const connection1CreateMessagePromise = connection1.handleMessage(context.request(session1), {
        type: "CreatePostComment",
        parentPostCommentIndex: null,
        content: content1,
    });

    const {unpause: unpause1} = await pausePromise1;

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
    connection1Messages = [];
    connection2Messages = [];

    const pausePromise2 = postRealtimeBackfillCommentsBeforeFlushTestCheckpoint.pauseForTest(
        session2.id,
    );

    const connection2BackfillPromise = connection2.handleMessage(context.request(session2), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 0,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 100,
    });

    const {unpause: unpause2} = await pausePromise2;

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
    connection1Messages = [];
    connection2Messages = [];

    unpause1();
    await connection1CreateMessagePromise;

    expect(connection1Messages).toEqual([
        {
            type: "NewPostComment",
            postComment: {
                postId: post.id,
                index: 0,
                author: session1.account,
                createdTime: expect.any(Date),
                payload: {
                    type: "Content",
                    parentMessageIndex: null,
                    content: content1WithReferences,
                    contentUpdatedTime: null,
                },
            },
        },
    ]);
    expect(connection2Messages).toEqual([]);
    connection1Messages = [];
    connection2Messages = [];

    unpause2();
    await connection2BackfillPromise;

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 1,
            lastPostCommentChangeTime: null,
            newPostComments: [
                {
                    postId: post.id,
                    index: 0,
                    author: session1.account,
                    createdTime: expect.any(Date),
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: content1WithReferences,
                        contentUpdatedTime: null,
                    },
                },
            ],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {type: "Available", changes: []},
        },
    ]);
    connection1Messages = [];
    connection2Messages = [];

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
});

test("will backfill changes when requested", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: postContent,
    });

    const postComment1 = await createPostComment(context.request(session1), {
        postId: post.id,
        parentPostCommentIndex: null,
        content: content1,
    });

    await createPostComment(context.request(session2), {
        postId: post.id,
        parentPostCommentIndex: null,
        content: content1,
    });

    const postComment3 = await createPostComment(context.request(session3), {
        postId: post.id,
        parentPostCommentIndex: null,
        content: content1,
    });

    const updatedPostComment3 = await updatePostCommentContent(context.request(session3), {
        postId: post.id,
        postCommentIndex: postComment3.index,
        content: content2,
    });

    const updatedPostComment1 = await updatePostCommentContent(context.request(session1), {
        postId: post.id,
        postCommentIndex: postComment1.index,
        content: content2,
    });

    let connection1Messages: Array<PostRealtimeMessageFromServer> = [];

    const connection1 = new PostRealtimeDurableObjectConnection({
        spaceId: space.id,
        postId: post.id,
        sendMessage: (context, message) => connection1Messages.push(message),
        iterateOtherConnections: () => [],
    });

    expect(connection1Messages.length).toEqual(0);

    await connection1.handleMessage(context.request(session1), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 3,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 100,
    });

    expect(connection1Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 3,
            lastPostCommentChangeTime: updatedPostComment1.contentUpdatedTime,
            newPostComments: [],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {
                type: "Available",
                changes: [
                    {
                        type: "UpdateContent",
                        index: postComment3.index,
                        content: content2WithReferences,
                        contentUpdatedTime: updatedPostComment3.contentUpdatedTime,
                    },
                    {
                        type: "UpdateContent",
                        index: postComment1.index,
                        content: content2WithReferences,
                        contentUpdatedTime: updatedPostComment1.contentUpdatedTime,
                    },
                ],
            },
        },
    ]);
    connection1Messages = [];

    await connection1.handleMessage(context.request(session1), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 3,
        clientLastPostCommentChangeTime: updatedPostComment3.contentUpdatedTime,
        newPostCommentLimit: 100,
    });

    expect(connection1Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 3,
            lastPostCommentChangeTime: updatedPostComment1.contentUpdatedTime,
            newPostComments: [],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {
                type: "Available",
                changes: [
                    {
                        type: "UpdateContent",
                        index: postComment1.index,
                        content: content2WithReferences,
                        contentUpdatedTime: updatedPostComment1.contentUpdatedTime,
                    },
                ],
            },
        },
    ]);
    connection1Messages = [];

    await connection1.handleMessage(context.request(session2), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 3,
        clientLastPostCommentChangeTime: updatedPostComment1.contentUpdatedTime,
        newPostCommentLimit: 100,
    });

    expect(connection1Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 3,
            lastPostCommentChangeTime: updatedPostComment1.contentUpdatedTime,
            newPostComments: [],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {type: "Available", changes: []},
        },
    ]);
    connection1Messages = [];

    expect(connection1Messages.length).toEqual(0);
});

test("will send changes from other connections", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: postContent,
    });

    await createPostComment(context.request(session1), {
        postId: post.id,
        parentPostCommentIndex: null,
        content: content1,
    });

    const postComment2 = await createPostComment(context.request(session2), {
        postId: post.id,
        parentPostCommentIndex: null,
        content: content1,
    });

    await createPostComment(context.request(session3), {
        postId: post.id,
        parentPostCommentIndex: null,
        content: content1,
    });

    let connection1Messages: Array<PostRealtimeMessageFromServer> = [];
    let connection2Messages: Array<PostRealtimeMessageFromServer> = [];
    let connection3Messages: Array<PostRealtimeMessageFromServer> = [];

    const connection1: PostRealtimeDurableObjectConnection =
        new PostRealtimeDurableObjectConnection({
            spaceId: space.id,
            postId: post.id,
            sendMessage: (context, message) => connection1Messages.push(message),
            iterateOtherConnections: () => [connection2, connection3],
        });

    const connection2: PostRealtimeDurableObjectConnection =
        new PostRealtimeDurableObjectConnection({
            spaceId: space.id,
            postId: post.id,
            sendMessage: (context, message) => connection2Messages.push(message),
            iterateOtherConnections: () => [connection1, connection3],
        });

    const connection3: PostRealtimeDurableObjectConnection =
        new PostRealtimeDurableObjectConnection({
            spaceId: space.id,
            postId: post.id,
            sendMessage: (context, message) => connection3Messages.push(message),
            iterateOtherConnections: () => [connection1, connection2],
        });

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
    expect(connection3Messages).toEqual([]);

    await connection1.handleMessage(context.request(session1), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 3,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 100,
    });

    await connection2.handleMessage(context.request(session2), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 3,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 100,
    });

    expect(connection1Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 3,
            lastPostCommentChangeTime: null,
            newPostComments: [],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {type: "Available", changes: []},
        },
    ]);
    expect(connection2Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 3,
            lastPostCommentChangeTime: null,
            newPostComments: [],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {type: "Available", changes: []},
        },
    ]);
    expect(connection3Messages).toEqual([]);
    connection1Messages = [];
    connection2Messages = [];
    connection3Messages = [];

    await connection2.handleMessage(context.request(session2), {
        type: "UpdatePostCommentContent",
        postCommentIndex: postComment2.index,
        content: content2,
    });

    expect(connection1Messages).toEqual([
        {
            type: "ChangePostComment",
            change: {
                type: "UpdateContent",
                index: postComment2.index,
                content: content2WithReferences,
                contentUpdatedTime: expect.any(Date),
            },
        },
    ]);
    expect(connection2Messages).toEqual([
        {
            type: "ChangePostComment",
            change: {
                type: "UpdateContent",
                index: postComment2.index,
                content: content2WithReferences,
                contentUpdatedTime: expect.any(Date),
            },
        },
    ]);
    expect(connection3Messages).toEqual([]);
    connection1Messages = [];
    connection2Messages = [];
    connection3Messages = [];

    await connection2.handleMessage(context.request(session2), {
        type: "DeletePostComment",
        postCommentIndex: postComment2.index,
    });

    expect(connection1Messages).toEqual([
        {
            type: "ChangePostComment",
            change: {
                type: "Delete",
                index: postComment2.index,
                deletedTime: expect.any(Date),
            },
        },
    ]);
    expect(connection2Messages).toEqual([
        {
            type: "ChangePostComment",
            change: {
                type: "Delete",
                index: postComment2.index,
                deletedTime: expect.any(Date),
            },
        },
    ]);
    expect(connection3Messages).toEqual([]);
    connection1Messages = [];
    connection2Messages = [];
    connection3Messages = [];

    await connection3.handleMessage(context.request(session3), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 3,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 100,
    });

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
    expect(connection3Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 3,
            lastPostCommentChangeTime: expect.any(Date),
            newPostComments: [],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {
                type: "Available",
                changes: [
                    {
                        type: "UpdateContent",
                        index: postComment2.index,
                        content: content2WithReferences,
                        contentUpdatedTime: expect.any(Date),
                    },
                    {
                        type: "Delete",
                        index: postComment2.index,
                        deletedTime: expect.any(Date),
                    },
                ],
            },
        },
    ]);
    connection1Messages = [];
    connection2Messages = [];
    connection3Messages = [];

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
    expect(connection3Messages).toEqual([]);
});

test("will send changes from other connections when those changes are added during backfill", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: postContent,
    });

    await createPostComment(context.request(session1), {
        postId: post.id,
        parentPostCommentIndex: null,
        content: content1,
    });

    const postComment2 = await createPostComment(context.request(session2), {
        postId: post.id,
        parentPostCommentIndex: null,
        content: content1,
    });

    await createPostComment(context.request(session3), {
        postId: post.id,
        parentPostCommentIndex: null,
        content: content1,
    });

    let connection1Messages: Array<PostRealtimeMessageFromServer> = [];
    let connection2Messages: Array<PostRealtimeMessageFromServer> = [];
    let connection3Messages: Array<PostRealtimeMessageFromServer> = [];

    const connection1: PostRealtimeDurableObjectConnection =
        new PostRealtimeDurableObjectConnection({
            spaceId: space.id,
            postId: post.id,
            sendMessage: (context, message) => connection1Messages.push(message),
            iterateOtherConnections: () => [connection2, connection3],
        });

    const connection2: PostRealtimeDurableObjectConnection =
        new PostRealtimeDurableObjectConnection({
            spaceId: space.id,
            postId: post.id,
            sendMessage: (context, message) => connection2Messages.push(message),
            iterateOtherConnections: () => [connection1, connection3],
        });

    const connection3: PostRealtimeDurableObjectConnection =
        new PostRealtimeDurableObjectConnection({
            spaceId: space.id,
            postId: post.id,
            sendMessage: (context, message) => connection3Messages.push(message),
            iterateOtherConnections: () => [connection1, connection2],
        });

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
    expect(connection3Messages).toEqual([]);

    await connection1.handleMessage(context.request(session1), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 3,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 100,
    });

    await connection2.handleMessage(context.request(session2), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 3,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 100,
    });

    const pausePromise = postRealtimeBackfillCommentsBeforeFlushTestCheckpoint.pauseForTest(
        session3.id,
    );

    const connection3BackfillPromise = connection3.handleMessage(context.request(session3), {
        type: "BackfillPostCommentsRequest",
        clientPostCommentCount: 3,
        clientLastPostCommentChangeTime: null,
        newPostCommentLimit: 100,
    });

    const {unpause} = await pausePromise;

    expect(connection1Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 3,
            lastPostCommentChangeTime: null,
            newPostComments: [],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {type: "Available", changes: []},
        },
    ]);
    expect(connection2Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 3,
            lastPostCommentChangeTime: null,
            newPostComments: [],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {type: "Available", changes: []},
        },
    ]);
    expect(connection3Messages).toEqual([]);
    connection1Messages = [];
    connection2Messages = [];
    connection3Messages = [];

    await connection2.handleMessage(context.request(session2), {
        type: "UpdatePostCommentContent",
        postCommentIndex: postComment2.index,
        content: content2,
    });

    expect(connection1Messages).toEqual([
        {
            type: "ChangePostComment",
            change: {
                type: "UpdateContent",
                index: postComment2.index,
                content: content2WithReferences,
                contentUpdatedTime: expect.any(Date),
            },
        },
    ]);
    expect(connection2Messages).toEqual([
        {
            type: "ChangePostComment",
            change: {
                type: "UpdateContent",
                index: postComment2.index,
                content: content2WithReferences,
                contentUpdatedTime: expect.any(Date),
            },
        },
    ]);
    expect(connection3Messages).toEqual([]);
    connection1Messages = [];
    connection2Messages = [];
    connection3Messages = [];

    await connection2.handleMessage(context.request(session2), {
        type: "DeletePostComment",
        postCommentIndex: postComment2.index,
    });

    expect(connection1Messages).toEqual([
        {
            type: "ChangePostComment",
            change: {
                type: "Delete",
                index: postComment2.index,
                deletedTime: expect.any(Date),
            },
        },
    ]);
    expect(connection2Messages).toEqual([
        {
            type: "ChangePostComment",
            change: {
                type: "Delete",
                index: postComment2.index,
                deletedTime: expect.any(Date),
            },
        },
    ]);
    expect(connection3Messages).toEqual([]);
    connection1Messages = [];
    connection2Messages = [];
    connection3Messages = [];

    unpause();
    await connection3BackfillPromise;

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
    expect(connection3Messages).toEqual([
        {
            type: "BackfillPostCommentsResponse",
            postCommentCount: 3,
            lastPostCommentChangeTime: null,
            newPostComments: [],
            newOtherReferencedPostComments: [],
            postCommentChangesResult: {type: "Available", changes: []},
        },
        {
            type: "ChangePostComment",
            change: {
                type: "UpdateContent",
                index: postComment2.index,
                content: content2WithReferences,
                contentUpdatedTime: expect.any(Date),
            },
        },
        {
            type: "ChangePostComment",
            change: {
                type: "Delete",
                index: postComment2.index,
                deletedTime: expect.any(Date),
            },
        },
    ]);
    connection1Messages = [];
    connection2Messages = [];
    connection3Messages = [];

    expect(connection1Messages).toEqual([]);
    expect(connection2Messages).toEqual([]);
    expect(connection3Messages).toEqual([]);
});
