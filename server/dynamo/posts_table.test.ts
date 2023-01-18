import {createChannel} from "~/server/dynamo/channels_table";
import {
    createPost,
    createPostReplyComment,
    createPostRootComment,
    deletePostReplyComment,
    deletePostRootComment,
    getPost,
    getPostReplyComments,
    getPostRootComments,
    getPostWithRootComments,
} from "~/server/dynamo/posts_table";
import {createTestContext} from "~/server/dynamo/test/create_test_context";
import {createTestSession} from "~/server/dynamo/test/create_test_session";
import {createTestSpace} from "~/server/dynamo/test/create_test_space";
import {FailedPreconditionError, NotFoundError, PermissionDeniedError} from "~/shared/error/error";
import {generateId} from "~/shared/id/id";
import {
    assertPostCommentContent,
    PostCommentContentProsemirrorSchema as commentSchema,
} from "~/shared/posts/post_comment_content_schema";
import {
    assertPostContent,
    PostContentProsemirrorSchema as schema,
} from "~/shared/posts/post_content_schema";

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

const testCommentContent1 = assertPostCommentContent(
    commentSchema.node("doc", {}, [
        commentSchema.node("paragraph", {}, [commentSchema.text("test1")]),
    ]),
);
const testCommentContent2 = assertPostCommentContent(
    commentSchema.node("doc", {}, [
        commentSchema.node("paragraph", {}, [commentSchema.text("test2")]),
    ]),
);
const testCommentContent3 = assertPostCommentContent(
    commentSchema.node("doc", {}, [
        commentSchema.node("paragraph", {}, [commentSchema.text("test3")]),
    ]),
);
const testCommentContent4 = assertPostCommentContent(
    commentSchema.node("doc", {}, [
        commentSchema.node("paragraph", {}, [commentSchema.text("test4")]),
    ]),
);

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

test("can create root comments", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 0,
        totalCommentAuthorCount: 0,
        previewCommentAuthors: [],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([]);

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 1,
        totalCommentAuthorCount: 1,
        previewCommentAuthors: [session1.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent2,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 2,
        totalCommentAuthorCount: 2,
        previewCommentAuthors: [session1.account, session2.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent2,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent3,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent4,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 4,
        totalCommentAuthorCount: 2,
        previewCommentAuthors: [session1.account, session2.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent2,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 3,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent3,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 4,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent4,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);
});

test("can not create a root comment on a post in a different space", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await expect(
        createPostRootComment(context.request(otherSession), {
            postId: post.id,
            content: testCommentContent1,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can not create a root comment on a post that does not exist", async () => {
    await expect(
        createPostRootComment(context.request(otherSession), {
            postId: generateId(),
            content: testCommentContent1,
        }),
    ).rejects.toThrow(NotFoundError);
});

test("can create reply comments", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 0,
        totalCommentAuthorCount: 0,
        previewCommentAuthors: [],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([]);
    expect(
        await getPostReplyComments(context.request(session1), {
            postId: post.id,
            rootCommentNumber: 1,
            limit: 100,
        }),
    ).toEqual([]);

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 1,
        totalCommentAuthorCount: 1,
        previewCommentAuthors: [session1.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);
    expect(
        await getPostReplyComments(context.request(session1), {
            postId: post.id,
            rootCommentNumber: 1,
            limit: 100,
        }),
    ).toEqual([]);

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 2,
        totalCommentAuthorCount: 1,
        previewCommentAuthors: [session1.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 1,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent1,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session1.account],
        },
    ]);
    expect(
        await getPostReplyComments(context.request(session1), {
            postId: post.id,
            rootCommentNumber: 1,
            limit: 100,
        }),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
        },
    ]);

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent2,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 3,
        totalCommentAuthorCount: 2,
        previewCommentAuthors: [session1.account, session2.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 2,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 2,
                    createdTime: expect.any(Date),
                    author: session2.account,
                    content: testCommentContent2,
                },
            ],
            totalReplyCommentAuthorCount: 2,
            previewReplyCommentAuthors: [session1.account, session2.account],
        },
    ]);
    expect(
        await getPostReplyComments(context.request(session1), {
            postId: post.id,
            rootCommentNumber: 1,
            limit: 100,
        }),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent2,
        },
    ]);

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent2,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 4,
        totalCommentAuthorCount: 2,
        previewCommentAuthors: [session1.account, session2.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 2,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 2,
                    createdTime: expect.any(Date),
                    author: session2.account,
                    content: testCommentContent2,
                },
            ],
            totalReplyCommentAuthorCount: 2,
            previewReplyCommentAuthors: [session1.account, session2.account],
        },
        {
            postId: post.id,
            rootCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent2,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);
    expect(
        await getPostReplyComments(context.request(session1), {
            postId: post.id,
            rootCommentNumber: 1,
            limit: 100,
        }),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent2,
        },
    ]);

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 2,
        content: testCommentContent1,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 5,
        totalCommentAuthorCount: 2,
        previewCommentAuthors: [session1.account, session2.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 2,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 2,
                    createdTime: expect.any(Date),
                    author: session2.account,
                    content: testCommentContent2,
                },
            ],
            totalReplyCommentAuthorCount: 2,
            previewReplyCommentAuthors: [session1.account, session2.account],
        },
        {
            postId: post.id,
            rootCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent2,
            totalReplyCommentCount: 1,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 2,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session2.account,
                    content: testCommentContent1,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session2.account],
        },
    ]);
    expect(
        await getPostReplyComments(context.request(session1), {
            postId: post.id,
            rootCommentNumber: 1,
            limit: 100,
        }),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent2,
        },
    ]);

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent3,
    });

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent4,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 7,
        totalCommentAuthorCount: 2,
        previewCommentAuthors: [session1.account, session2.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 4,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 2,
                    createdTime: expect.any(Date),
                    author: session2.account,
                    content: testCommentContent2,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 3,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent3,
                },
            ],
            totalReplyCommentAuthorCount: 2,
            previewReplyCommentAuthors: [session1.account, session2.account],
        },
        {
            postId: post.id,
            rootCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent2,
            totalReplyCommentCount: 1,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 2,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session2.account,
                    content: testCommentContent1,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session2.account],
        },
    ]);
    expect(
        await getPostReplyComments(context.request(session1), {
            postId: post.id,
            rootCommentNumber: 1,
            limit: 100,
        }),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent2,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 3,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent3,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 4,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent4,
        },
    ]);
});

test("can not create a reply comment in a different space", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await expect(
        createPostReplyComment(context.request(otherSession), {
            postId: post.id,
            rootCommentNumber: 1,
            content: testCommentContent1,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can not create a reply comment for a root comment that doesn't exist", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await expect(
        createPostReplyComment(context.request(session1), {
            postId: post.id,
            rootCommentNumber: 1,
            content: testCommentContent1,
        }),
    ).rejects.toThrow(NotFoundError);
});

test("can delete a root post comment", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 0,
        totalCommentAuthorCount: 0,
        previewCommentAuthors: [],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([]);

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 1,
        totalCommentAuthorCount: 1,
        previewCommentAuthors: [session1.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);

    await deletePostRootComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 0,
        totalCommentAuthorCount: 0,
        previewCommentAuthors: [],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([]);
});

test("can not delete a root post comment that doesn't exist", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await expect(
        deletePostRootComment(context.request(session1), {
            postId: post.id,
            rootCommentNumber: 1,
        }),
    ).rejects.toThrow(NotFoundError);
});

test("can not delete a root post comment on a post that doesn't exist", async () => {
    await expect(
        deletePostRootComment(context.request(session1), {
            postId: generateId(),
            rootCommentNumber: 1,
        }),
    ).rejects.toThrow(NotFoundError);
});

test("can not delete a root post comment in a different space", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await expect(
        deletePostRootComment(context.request(otherSession), {
            postId: post.id,
            rootCommentNumber: 1,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account does not have access to space"));
});

test("can not delete a root post comment from a different account", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await expect(
        deletePostRootComment(context.request(session2), {
            postId: post.id,
            rootCommentNumber: 1,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Can not delete another account's comment"));
});

test("can not double delete a root post comment", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await deletePostRootComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
    });

    await expect(
        deletePostRootComment(context.request(session1), {
            postId: post.id,
            rootCommentNumber: 1,
        }),
    ).rejects.toThrow(NotFoundError);
});

test("deleting a root comment with reply comments leaves a gravestone", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent2,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 2,
        totalCommentAuthorCount: 1,
        previewCommentAuthors: [session1.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 1,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent2,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session1.account],
        },
    ]);

    await deletePostRootComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 1,
        totalCommentAuthorCount: 1,
        previewCommentAuthors: [session1.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: null,
            totalReplyCommentCount: 1,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent2,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session1.account],
        },
    ]);

    await deletePostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        replyCommentNumber: 1,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 0,
        totalCommentAuthorCount: 0,
        previewCommentAuthors: [],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([]);
});

test("can not double delete a gravestone root comment", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent2,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 2,
        totalCommentAuthorCount: 2,
        previewCommentAuthors: [session2.account, session1.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent1,
            totalReplyCommentCount: 1,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent2,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session1.account],
        },
    ]);

    await deletePostRootComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 1,
        totalCommentAuthorCount: 1,
        previewCommentAuthors: [session1.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session2.account,
            content: null,
            totalReplyCommentCount: 1,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent2,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session1.account],
        },
    ]);

    await expect(
        deletePostRootComment(context.request(session2), {
            postId: post.id,
            rootCommentNumber: 1,
        }),
    ).rejects.toThrow(FailedPreconditionError);

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 1,
        totalCommentAuthorCount: 1,
        previewCommentAuthors: [session1.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session2.account,
            content: null,
            totalReplyCommentCount: 1,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent2,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session1.account],
        },
    ]);
});

test("can delete a reply post comment", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent2,
    });

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent3,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 3,
        totalCommentAuthorCount: 2,
        previewCommentAuthors: [session1.account, session2.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 2,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session2.account,
                    content: testCommentContent2,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 2,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent3,
                },
            ],
            totalReplyCommentAuthorCount: 2,
            previewReplyCommentAuthors: [session2.account, session1.account],
        },
    ]);

    await deletePostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        replyCommentNumber: 1,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 2,
        totalCommentAuthorCount: 1,
        previewCommentAuthors: [session1.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 1,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 2,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent3,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session1.account],
        },
    ]);

    await deletePostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        replyCommentNumber: 2,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 1,
        totalCommentAuthorCount: 1,
        previewCommentAuthors: [session1.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);
});

test("can not delete a reply comment that does not exist", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await expect(
        deletePostReplyComment(context.request(session2), {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 1,
        }),
    ).rejects.toThrow(NotFoundError);
});

test("can not delete a reply comment on a root comment that does not exist", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await expect(
        deletePostReplyComment(context.request(session2), {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 1,
        }),
    ).rejects.toThrow(NotFoundError);
});

test("can not delete a reply comment on a post that does not exist", async () => {
    await expect(
        deletePostReplyComment(context.request(session2), {
            postId: generateId(),
            rootCommentNumber: 1,
            replyCommentNumber: 1,
        }),
    ).rejects.toThrow(NotFoundError);
});

test("can not delete a reply comment in a channel you don't have access to", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent2,
    });

    await expect(
        deletePostReplyComment(context.request(otherSession), {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 1,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account does not have access to space"));
});

test("can not delete a reply comment from a different author", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent2,
    });

    await expect(
        deletePostReplyComment(context.request(session1), {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 1,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Can not delete another account's comment"));
});

test("can not double delete a reply comment", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent2,
    });

    await deletePostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        replyCommentNumber: 1,
    });

    await expect(
        deletePostReplyComment(context.request(session2), {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 1,
        }),
    ).rejects.toThrow(NotFoundError);
});

test("will only show up to five authors of root comments in the author preview array", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session3), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session4), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session5), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session6), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session7), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session8), {
        postId: post.id,
        content: testCommentContent1,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 8,
        totalCommentAuthorCount: 8,
        previewCommentAuthors: [
            session1.account,
            session2.account,
            session3.account,
            session4.account,
            session5.account,
        ],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 3,
            createdTime: expect.any(Date),
            author: session3.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 4,
            createdTime: expect.any(Date),
            author: session4.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 5,
            createdTime: expect.any(Date),
            author: session5.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 6,
            createdTime: expect.any(Date),
            author: session6.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 7,
            createdTime: expect.any(Date),
            author: session7.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 8,
            createdTime: expect.any(Date),
            author: session8.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);
});

test("will only show up to five authors of root and reply comments in the author preview array", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session3), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session4), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session5), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session6), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session7), {
        postId: post.id,
        rootCommentNumber: 3,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session8), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 8,
        totalCommentAuthorCount: 8,
        previewCommentAuthors: [
            session1.account,
            session2.account,
            session3.account,
            session4.account,
            session5.account,
        ],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 3,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session2.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 2,
                    createdTime: expect.any(Date),
                    author: session4.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 3,
                    createdTime: expect.any(Date),
                    author: session8.account,
                    content: testCommentContent1,
                },
            ],
            totalReplyCommentAuthorCount: 3,
            previewReplyCommentAuthors: [session2.account, session4.account, session8.account],
        },
        {
            postId: post.id,
            rootCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session3.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 3,
            createdTime: expect.any(Date),
            author: session5.account,
            content: testCommentContent1,
            totalReplyCommentCount: 1,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 3,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session7.account,
                    content: testCommentContent1,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session7.account],
        },
        {
            postId: post.id,
            rootCommentNumber: 4,
            createdTime: expect.any(Date),
            author: session6.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);
});

test("will only show up to five authors of reply comments in the author preview array", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session3), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session4), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session5), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session6), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session7), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session8), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 9,
        totalCommentAuthorCount: 8,
        previewCommentAuthors: [
            session1.account,
            session2.account,
            session3.account,
            session4.account,
            session5.account,
        ],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 8,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 2,
                    createdTime: expect.any(Date),
                    author: session2.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 3,
                    createdTime: expect.any(Date),
                    author: session3.account,
                    content: testCommentContent1,
                },
            ],
            totalReplyCommentAuthorCount: 8,
            previewReplyCommentAuthors: [
                session1.account,
                session2.account,
                session3.account,
                session4.account,
                session5.account,
            ],
        },
    ]);
});

test("deleting a root comment will show a new author in the author preview array", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session3), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session4), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session5), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session6), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session7), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session8), {
        postId: post.id,
        content: testCommentContent1,
    });

    await deletePostRootComment(context.request(session3), {
        postId: post.id,
        rootCommentNumber: 3,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 7,
        totalCommentAuthorCount: 7,
        previewCommentAuthors: [
            session1.account,
            session2.account,
            session4.account,
            session5.account,
            session6.account,
        ],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 4,
            createdTime: expect.any(Date),
            author: session4.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 5,
            createdTime: expect.any(Date),
            author: session5.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 6,
            createdTime: expect.any(Date),
            author: session6.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 7,
            createdTime: expect.any(Date),
            author: session7.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 8,
            createdTime: expect.any(Date),
            author: session8.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);
});

test("deleting a root comment with replies will remove it from the preview authors array", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session3), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session4), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session5), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session6), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session7), {
        postId: post.id,
        rootCommentNumber: 3,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session8), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await deletePostRootComment(context.request(session5), {
        postId: post.id,
        rootCommentNumber: 3,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 7,
        totalCommentAuthorCount: 7,
        previewCommentAuthors: [
            session1.account,
            session2.account,
            session3.account,
            session4.account,
            session6.account,
        ],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 3,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session2.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 2,
                    createdTime: expect.any(Date),
                    author: session4.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 3,
                    createdTime: expect.any(Date),
                    author: session8.account,
                    content: testCommentContent1,
                },
            ],
            totalReplyCommentAuthorCount: 3,
            previewReplyCommentAuthors: [session2.account, session4.account, session8.account],
        },
        {
            postId: post.id,
            rootCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session3.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 3,
            createdTime: expect.any(Date),
            author: session5.account,
            content: null,
            totalReplyCommentCount: 1,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 3,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session7.account,
                    content: testCommentContent1,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session7.account],
        },
        {
            postId: post.id,
            rootCommentNumber: 4,
            createdTime: expect.any(Date),
            author: session6.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);
});

test("deleting a reply comment will remove it from the preview authors array", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session3), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session4), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session5), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session6), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session7), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session8), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await deletePostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        replyCommentNumber: 1,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 8,
        totalCommentAuthorCount: 8,
        previewCommentAuthors: [
            session1.account,
            session2.account,
            session3.account,
            session4.account,
            session5.account,
        ],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 7,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 2,
                    createdTime: expect.any(Date),
                    author: session2.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 3,
                    createdTime: expect.any(Date),
                    author: session3.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 4,
                    createdTime: expect.any(Date),
                    author: session4.account,
                    content: testCommentContent1,
                },
            ],
            totalReplyCommentAuthorCount: 7,
            previewReplyCommentAuthors: [
                session2.account,
                session3.account,
                session4.account,
                session5.account,
                session6.account,
            ],
        },
    ]);

    await deletePostReplyComment(context.request(session5), {
        postId: post.id,
        rootCommentNumber: 1,
        replyCommentNumber: 5,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 7,
        totalCommentAuthorCount: 7,
        previewCommentAuthors: [
            session1.account,
            session2.account,
            session3.account,
            session4.account,
            session6.account,
        ],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 6,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 2,
                    createdTime: expect.any(Date),
                    author: session2.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 3,
                    createdTime: expect.any(Date),
                    author: session3.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 4,
                    createdTime: expect.any(Date),
                    author: session4.account,
                    content: testCommentContent1,
                },
            ],
            totalReplyCommentAuthorCount: 6,
            previewReplyCommentAuthors: [
                session2.account,
                session3.account,
                session4.account,
                session6.account,
                session7.account,
            ],
        },
    ]);
});

test("must delete all root comments from author to remove from preview authors array", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent2,
    });

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent3,
    });

    await createPostRootComment(context.request(session3), {
        postId: post.id,
        content: testCommentContent1,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 5,
        totalCommentAuthorCount: 3,
        previewCommentAuthors: [session1.account, session2.account, session3.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 3,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent2,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 4,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent3,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 5,
            createdTime: expect.any(Date),
            author: session3.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);

    await deletePostRootComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 3,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 4,
        totalCommentAuthorCount: 3,
        previewCommentAuthors: [session1.account, session2.account, session3.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 4,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent3,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 5,
            createdTime: expect.any(Date),
            author: session3.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);

    await deletePostRootComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 2,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 3,
        totalCommentAuthorCount: 3,
        previewCommentAuthors: [session1.account, session2.account, session3.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 4,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent3,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 5,
            createdTime: expect.any(Date),
            author: session3.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent4,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 4,
        totalCommentAuthorCount: 3,
        previewCommentAuthors: [session1.account, session2.account, session3.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 4,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent3,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 5,
            createdTime: expect.any(Date),
            author: session3.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 6,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent4,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);

    await deletePostRootComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 4,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 3,
        totalCommentAuthorCount: 3,
        previewCommentAuthors: [session1.account, session2.account, session3.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 5,
            createdTime: expect.any(Date),
            author: session3.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 6,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent4,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);

    await deletePostRootComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 6,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 2,
        totalCommentAuthorCount: 2,
        previewCommentAuthors: [session1.account, session3.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 5,
            createdTime: expect.any(Date),
            author: session3.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent1,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 3,
        totalCommentAuthorCount: 3,
        previewCommentAuthors: [session1.account, session3.account, session2.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 5,
            createdTime: expect.any(Date),
            author: session3.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 7,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);
});

test("must delete all reply comments from author to remove from preview authors array", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent2,
    });

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent3,
    });

    await createPostReplyComment(context.request(session3), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 6,
        totalCommentAuthorCount: 3,
        previewCommentAuthors: [session1.account, session2.account, session3.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 5,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 2,
                    createdTime: expect.any(Date),
                    author: session2.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 3,
                    createdTime: expect.any(Date),
                    author: session2.account,
                    content: testCommentContent2,
                },
            ],
            totalReplyCommentAuthorCount: 3,
            previewReplyCommentAuthors: [session1.account, session2.account, session3.account],
        },
    ]);

    await deletePostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        replyCommentNumber: 3,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 5,
        totalCommentAuthorCount: 3,
        previewCommentAuthors: [session1.account, session2.account, session3.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 4,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 2,
                    createdTime: expect.any(Date),
                    author: session2.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 4,
                    createdTime: expect.any(Date),
                    author: session2.account,
                    content: testCommentContent3,
                },
            ],
            totalReplyCommentAuthorCount: 3,
            previewReplyCommentAuthors: [session1.account, session2.account, session3.account],
        },
    ]);

    await deletePostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        replyCommentNumber: 2,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 4,
        totalCommentAuthorCount: 3,
        previewCommentAuthors: [session1.account, session2.account, session3.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 3,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 4,
                    createdTime: expect.any(Date),
                    author: session2.account,
                    content: testCommentContent3,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 5,
                    createdTime: expect.any(Date),
                    author: session3.account,
                    content: testCommentContent1,
                },
            ],
            totalReplyCommentAuthorCount: 3,
            previewReplyCommentAuthors: [session1.account, session2.account, session3.account],
        },
    ]);

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent4,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 5,
        totalCommentAuthorCount: 3,
        previewCommentAuthors: [session1.account, session2.account, session3.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 4,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 4,
                    createdTime: expect.any(Date),
                    author: session2.account,
                    content: testCommentContent3,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 5,
                    createdTime: expect.any(Date),
                    author: session3.account,
                    content: testCommentContent1,
                },
            ],
            totalReplyCommentAuthorCount: 3,
            previewReplyCommentAuthors: [session1.account, session2.account, session3.account],
        },
    ]);

    await deletePostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        replyCommentNumber: 4,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 4,
        totalCommentAuthorCount: 3,
        previewCommentAuthors: [session1.account, session2.account, session3.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 3,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 5,
                    createdTime: expect.any(Date),
                    author: session3.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 6,
                    createdTime: expect.any(Date),
                    author: session2.account,
                    content: testCommentContent4,
                },
            ],
            totalReplyCommentAuthorCount: 3,
            previewReplyCommentAuthors: [session1.account, session2.account, session3.account],
        },
    ]);

    await deletePostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        replyCommentNumber: 6,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 3,
        totalCommentAuthorCount: 2,
        previewCommentAuthors: [session1.account, session3.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 2,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 5,
                    createdTime: expect.any(Date),
                    author: session3.account,
                    content: testCommentContent1,
                },
            ],
            totalReplyCommentAuthorCount: 2,
            previewReplyCommentAuthors: [session1.account, session3.account],
        },
    ]);

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 4,
        totalCommentAuthorCount: 3,
        previewCommentAuthors: [session1.account, session3.account, session2.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 3,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 5,
                    createdTime: expect.any(Date),
                    author: session3.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 7,
                    createdTime: expect.any(Date),
                    author: session2.account,
                    content: testCommentContent1,
                },
            ],
            totalReplyCommentAuthorCount: 3,
            previewReplyCommentAuthors: [session1.account, session3.account, session2.account],
        },
    ]);
});

test("must delete all root and reply comments from author to remove from preview authors array", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session3), {
        postId: post.id,
        rootCommentNumber: 2,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session3), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 3,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 3,
        content: testCommentContent2,
    });

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent1,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 8,
        totalCommentAuthorCount: 3,
        previewCommentAuthors: [session1.account, session2.account, session3.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 1,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session2.account,
                    content: testCommentContent1,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session2.account],
        },
        {
            postId: post.id,
            rootCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent1,
            totalReplyCommentCount: 1,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 2,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session3.account,
                    content: testCommentContent1,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session3.account],
        },
        {
            postId: post.id,
            rootCommentNumber: 3,
            createdTime: expect.any(Date),
            author: session3.account,
            content: testCommentContent1,
            totalReplyCommentCount: 2,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 3,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session2.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 3,
                    replyCommentNumber: 2,
                    createdTime: expect.any(Date),
                    author: session2.account,
                    content: testCommentContent2,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session2.account],
        },
        {
            postId: post.id,
            rootCommentNumber: 4,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);

    await deletePostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 3,
        replyCommentNumber: 1,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 7,
        totalCommentAuthorCount: 3,
        previewCommentAuthors: [session1.account, session2.account, session3.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 1,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session2.account,
                    content: testCommentContent1,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session2.account],
        },
        {
            postId: post.id,
            rootCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent1,
            totalReplyCommentCount: 1,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 2,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session3.account,
                    content: testCommentContent1,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session3.account],
        },
        {
            postId: post.id,
            rootCommentNumber: 3,
            createdTime: expect.any(Date),
            author: session3.account,
            content: testCommentContent1,
            totalReplyCommentCount: 1,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 3,
                    replyCommentNumber: 2,
                    createdTime: expect.any(Date),
                    author: session2.account,
                    content: testCommentContent2,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session2.account],
        },
        {
            postId: post.id,
            rootCommentNumber: 4,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);

    await deletePostRootComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 2,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 6,
        totalCommentAuthorCount: 3,
        previewCommentAuthors: [session1.account, session2.account, session3.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 1,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session2.account,
                    content: testCommentContent1,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session2.account],
        },
        {
            postId: post.id,
            rootCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session2.account,
            content: null,
            totalReplyCommentCount: 1,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 2,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session3.account,
                    content: testCommentContent1,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session3.account],
        },
        {
            postId: post.id,
            rootCommentNumber: 3,
            createdTime: expect.any(Date),
            author: session3.account,
            content: testCommentContent1,
            totalReplyCommentCount: 1,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 3,
                    replyCommentNumber: 2,
                    createdTime: expect.any(Date),
                    author: session2.account,
                    content: testCommentContent2,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session2.account],
        },
        {
            postId: post.id,
            rootCommentNumber: 4,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);

    await deletePostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        replyCommentNumber: 1,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 5,
        totalCommentAuthorCount: 3,
        previewCommentAuthors: [session1.account, session2.account, session3.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session2.account,
            content: null,
            totalReplyCommentCount: 1,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 2,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session3.account,
                    content: testCommentContent1,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session3.account],
        },
        {
            postId: post.id,
            rootCommentNumber: 3,
            createdTime: expect.any(Date),
            author: session3.account,
            content: testCommentContent1,
            totalReplyCommentCount: 1,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 3,
                    replyCommentNumber: 2,
                    createdTime: expect.any(Date),
                    author: session2.account,
                    content: testCommentContent2,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session2.account],
        },
        {
            postId: post.id,
            rootCommentNumber: 4,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);

    await deletePostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 3,
        replyCommentNumber: 2,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 4,
        totalCommentAuthorCount: 3,
        previewCommentAuthors: [session1.account, session2.account, session3.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session2.account,
            content: null,
            totalReplyCommentCount: 1,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 2,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session3.account,
                    content: testCommentContent1,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session3.account],
        },
        {
            postId: post.id,
            rootCommentNumber: 3,
            createdTime: expect.any(Date),
            author: session3.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 4,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);

    await deletePostRootComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 4,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 3,
        totalCommentAuthorCount: 2,
        previewCommentAuthors: [session1.account, session3.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session2.account,
            content: null,
            totalReplyCommentCount: 1,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 2,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session3.account,
                    content: testCommentContent1,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session3.account],
        },
        {
            postId: post.id,
            rootCommentNumber: 3,
            createdTime: expect.any(Date),
            author: session3.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent4,
    });

    expect(await getPost(context.request(session1), post.id)).toEqual({
        id: post.id,
        spaceId: post.spaceId,
        channelId: channel.id,
        createdTime: expect.any(Date),
        author: session1.account,
        content: testContent,
        totalCommentCount: 4,
        totalCommentAuthorCount: 3,
        previewCommentAuthors: [session1.account, session3.account, session2.account],
    });
    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session2.account,
            content: null,
            totalReplyCommentCount: 1,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 2,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session3.account,
                    content: testCommentContent1,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session3.account],
        },
        {
            postId: post.id,
            rootCommentNumber: 3,
            createdTime: expect.any(Date),
            author: session3.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 5,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent4,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);
});

test("can not get post root comments for a post that doesn't exist", async () => {
    await expect(
        getPostRootComments(context.request(session1), {postId: generateId(), limit: 100}),
    ).rejects.toThrow(NotFoundError);
});

test("can not get post root comments for a post in a different space", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await expect(
        getPostRootComments(context.request(otherSession), {postId: post.id, limit: 100}),
    ).rejects.toThrow(PermissionDeniedError);
});

test("will get the root comments as any user", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([]);
    expect(
        await getPostRootComments(context.request(session2), {postId: post.id, limit: 100}),
    ).toEqual([]);
    expect(
        await getPostRootComments(context.request(session3), {postId: post.id, limit: 100}),
    ).toEqual([]);

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent2,
    });

    await createPostRootComment(context.request(session3), {
        postId: post.id,
        content: testCommentContent3,
    });

    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent2,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 3,
            createdTime: expect.any(Date),
            author: session3.account,
            content: testCommentContent3,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);
    expect(
        await getPostRootComments(context.request(session2), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent2,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 3,
            createdTime: expect.any(Date),
            author: session3.account,
            content: testCommentContent3,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);
    expect(
        await getPostRootComments(context.request(session3), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent2,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 3,
            createdTime: expect.any(Date),
            author: session3.account,
            content: testCommentContent3,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);
});

test("will get the first few reply comments to a root comment", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([]);

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 1,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent1,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session1.account],
        },
    ]);

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent2,
    });

    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 2,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 2,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent2,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session1.account],
        },
    ]);

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent3,
    });

    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 3,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 2,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent2,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 3,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent3,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session1.account],
        },
    ]);

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent4,
    });

    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 4,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 2,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent2,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 3,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent3,
                },
            ],
            totalReplyCommentAuthorCount: 1,
            previewReplyCommentAuthors: [session1.account],
        },
    ]);

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 5,
            previewReplyComments: [
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 1,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent1,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 2,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent2,
                },
                {
                    postId: post.id,
                    rootCommentNumber: 1,
                    replyCommentNumber: 3,
                    createdTime: expect.any(Date),
                    author: session1.account,
                    content: testCommentContent3,
                },
            ],
            totalReplyCommentAuthorCount: 2,
            previewReplyCommentAuthors: [session1.account, session2.account],
        },
    ]);
});

test("can set a limit on how many root comments will be shown", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent2,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent3,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent4,
    });

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent2,
    });

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent3,
    });

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent4,
    });

    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 100}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent2,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 3,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent3,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 4,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent4,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 5,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 6,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent2,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 7,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent3,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 8,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent4,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);

    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 5}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent2,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 3,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent3,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 4,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent4,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 5,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);

    expect(
        await getPostRootComments(context.request(session1), {postId: post.id, limit: 2}),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent2,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);
});

test("can set a root comment number to read comments after", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent2,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent3,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent4,
    });

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent2,
    });

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent3,
    });

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent4,
    });

    expect(
        await getPostRootComments(context.request(session1), {
            postId: post.id,
            limit: 100,
            afterRootCommentNumber: 2,
        }),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 3,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent3,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 4,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent4,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 5,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 6,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent2,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 7,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent3,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 8,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent4,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);

    expect(
        await getPostRootComments(context.request(session1), {
            postId: post.id,
            limit: 100,
            afterRootCommentNumber: 5,
        }),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 6,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent2,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 7,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent3,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 8,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent4,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);
});

test("can set a root comment number and limit to read a page of comments", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent2,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent3,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent4,
    });

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent2,
    });

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent3,
    });

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent4,
    });

    expect(
        await getPostRootComments(context.request(session1), {
            postId: post.id,
            limit: 3,
            afterRootCommentNumber: 2,
        }),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 3,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent3,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 4,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent4,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 5,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent1,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);

    expect(
        await getPostRootComments(context.request(session1), {
            postId: post.id,
            limit: 3,
            afterRootCommentNumber: 6,
        }),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 7,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent3,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
        {
            postId: post.id,
            rootCommentNumber: 8,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent4,
            totalReplyCommentCount: 0,
            previewReplyComments: [],
            totalReplyCommentAuthorCount: 0,
            previewReplyCommentAuthors: [],
        },
    ]);
});

test("can not get post root comments (with post) for a post that doesn't exist", async () => {
    expect(
        await getPostWithRootComments(context.request(session1), {
            postId: generateId(),
            rootCommentLimit: 100,
        }),
    ).toEqual(null);
});

test("can not get post root comments (with post) for a post in a different space", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await expect(
        getPostWithRootComments(context.request(otherSession), {
            postId: post.id,
            rootCommentLimit: 100,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("will get the root comments (with post) as any user", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    expect(
        await getPostWithRootComments(context.request(session1), {
            postId: post.id,
            rootCommentLimit: 100,
        }),
    ).toEqual({
        post: {
            id: post.id,
            spaceId: post.spaceId,
            channelId: channel.id,
            content: testContent,
            createdTime: expect.any(Date),
            author: session1.account,
            totalCommentCount: 0,
            totalCommentAuthorCount: 0,
            previewCommentAuthors: [],
        },
        rootComments: [],
    });
    expect(
        await getPostWithRootComments(context.request(session2), {
            postId: post.id,
            rootCommentLimit: 100,
        }),
    ).toEqual({
        post: {
            id: post.id,
            spaceId: post.spaceId,
            channelId: channel.id,
            content: testContent,
            createdTime: expect.any(Date),
            author: session1.account,
            totalCommentCount: 0,
            totalCommentAuthorCount: 0,
            previewCommentAuthors: [],
        },
        rootComments: [],
    });
    expect(
        await getPostWithRootComments(context.request(session3), {
            postId: post.id,
            rootCommentLimit: 100,
        }),
    ).toEqual({
        post: {
            id: post.id,
            spaceId: post.spaceId,
            channelId: channel.id,
            content: testContent,
            createdTime: expect.any(Date),
            author: session1.account,
            totalCommentCount: 0,
            totalCommentAuthorCount: 0,
            previewCommentAuthors: [],
        },
        rootComments: [],
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent2,
    });

    await createPostRootComment(context.request(session3), {
        postId: post.id,
        content: testCommentContent3,
    });

    expect(
        await getPostWithRootComments(context.request(session1), {
            postId: post.id,
            rootCommentLimit: 100,
        }),
    ).toEqual({
        post: {
            id: post.id,
            spaceId: post.spaceId,
            channelId: channel.id,
            content: testContent,
            createdTime: expect.any(Date),
            author: session1.account,
            totalCommentCount: 3,
            totalCommentAuthorCount: 3,
            previewCommentAuthors: [session1.account, session2.account, session3.account],
        },
        rootComments: [
            {
                postId: post.id,
                rootCommentNumber: 1,
                createdTime: expect.any(Date),
                author: session1.account,
                content: testCommentContent1,
                totalReplyCommentCount: 0,
                previewReplyComments: [],
                totalReplyCommentAuthorCount: 0,
                previewReplyCommentAuthors: [],
            },
            {
                postId: post.id,
                rootCommentNumber: 2,
                createdTime: expect.any(Date),
                author: session2.account,
                content: testCommentContent2,
                totalReplyCommentCount: 0,
                previewReplyComments: [],
                totalReplyCommentAuthorCount: 0,
                previewReplyCommentAuthors: [],
            },
            {
                postId: post.id,
                rootCommentNumber: 3,
                createdTime: expect.any(Date),
                author: session3.account,
                content: testCommentContent3,
                totalReplyCommentCount: 0,
                previewReplyComments: [],
                totalReplyCommentAuthorCount: 0,
                previewReplyCommentAuthors: [],
            },
        ],
    });
    expect(
        await getPostWithRootComments(context.request(session2), {
            postId: post.id,
            rootCommentLimit: 100,
        }),
    ).toEqual({
        post: {
            id: post.id,
            spaceId: post.spaceId,
            channelId: channel.id,
            content: testContent,
            createdTime: expect.any(Date),
            author: session1.account,
            totalCommentCount: 3,
            totalCommentAuthorCount: 3,
            previewCommentAuthors: [session1.account, session2.account, session3.account],
        },
        rootComments: [
            {
                postId: post.id,
                rootCommentNumber: 1,
                createdTime: expect.any(Date),
                author: session1.account,
                content: testCommentContent1,
                totalReplyCommentCount: 0,
                previewReplyComments: [],
                totalReplyCommentAuthorCount: 0,
                previewReplyCommentAuthors: [],
            },
            {
                postId: post.id,
                rootCommentNumber: 2,
                createdTime: expect.any(Date),
                author: session2.account,
                content: testCommentContent2,
                totalReplyCommentCount: 0,
                previewReplyComments: [],
                totalReplyCommentAuthorCount: 0,
                previewReplyCommentAuthors: [],
            },
            {
                postId: post.id,
                rootCommentNumber: 3,
                createdTime: expect.any(Date),
                author: session3.account,
                content: testCommentContent3,
                totalReplyCommentCount: 0,
                previewReplyComments: [],
                totalReplyCommentAuthorCount: 0,
                previewReplyCommentAuthors: [],
            },
        ],
    });
    expect(
        await getPostWithRootComments(context.request(session3), {
            postId: post.id,
            rootCommentLimit: 100,
        }),
    ).toEqual({
        post: {
            id: post.id,
            spaceId: post.spaceId,
            channelId: channel.id,
            content: testContent,
            createdTime: expect.any(Date),
            author: session1.account,
            totalCommentCount: 3,
            totalCommentAuthorCount: 3,
            previewCommentAuthors: [session1.account, session2.account, session3.account],
        },
        rootComments: [
            {
                postId: post.id,
                rootCommentNumber: 1,
                createdTime: expect.any(Date),
                author: session1.account,
                content: testCommentContent1,
                totalReplyCommentCount: 0,
                previewReplyComments: [],
                totalReplyCommentAuthorCount: 0,
                previewReplyCommentAuthors: [],
            },
            {
                postId: post.id,
                rootCommentNumber: 2,
                createdTime: expect.any(Date),
                author: session2.account,
                content: testCommentContent2,
                totalReplyCommentCount: 0,
                previewReplyComments: [],
                totalReplyCommentAuthorCount: 0,
                previewReplyCommentAuthors: [],
            },
            {
                postId: post.id,
                rootCommentNumber: 3,
                createdTime: expect.any(Date),
                author: session3.account,
                content: testCommentContent3,
                totalReplyCommentCount: 0,
                previewReplyComments: [],
                totalReplyCommentAuthorCount: 0,
                previewReplyCommentAuthors: [],
            },
        ],
    });
});

test("will get the first few reply comments when getting root comments (with post)", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    expect(
        await getPostWithRootComments(context.request(session1), {
            postId: post.id,
            rootCommentLimit: 100,
        }),
    ).toEqual({
        post: {
            id: post.id,
            spaceId: post.spaceId,
            channelId: channel.id,
            content: testContent,
            createdTime: expect.any(Date),
            author: session1.account,
            totalCommentCount: 0,
            totalCommentAuthorCount: 0,
            previewCommentAuthors: [],
        },
        rootComments: [],
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    expect(
        await getPostWithRootComments(context.request(session1), {
            postId: post.id,
            rootCommentLimit: 100,
        }),
    ).toEqual({
        post: {
            id: post.id,
            spaceId: post.spaceId,
            channelId: channel.id,
            content: testContent,
            createdTime: expect.any(Date),
            author: session1.account,
            totalCommentCount: 1,
            totalCommentAuthorCount: 1,
            previewCommentAuthors: [session1.account],
        },
        rootComments: [
            {
                postId: post.id,
                rootCommentNumber: 1,
                createdTime: expect.any(Date),
                author: session1.account,
                content: testCommentContent1,
                totalReplyCommentCount: 0,
                previewReplyComments: [],
                totalReplyCommentAuthorCount: 0,
                previewReplyCommentAuthors: [],
            },
        ],
    });

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    expect(
        await getPostWithRootComments(context.request(session1), {
            postId: post.id,
            rootCommentLimit: 100,
        }),
    ).toEqual({
        post: {
            id: post.id,
            spaceId: post.spaceId,
            channelId: channel.id,
            content: testContent,
            createdTime: expect.any(Date),
            author: session1.account,
            totalCommentCount: 2,
            totalCommentAuthorCount: 1,
            previewCommentAuthors: [session1.account],
        },
        rootComments: [
            {
                postId: post.id,
                rootCommentNumber: 1,
                createdTime: expect.any(Date),
                author: session1.account,
                content: testCommentContent1,
                totalReplyCommentCount: 1,
                previewReplyComments: [
                    {
                        postId: post.id,
                        rootCommentNumber: 1,
                        replyCommentNumber: 1,
                        createdTime: expect.any(Date),
                        author: session1.account,
                        content: testCommentContent1,
                    },
                ],
                totalReplyCommentAuthorCount: 1,
                previewReplyCommentAuthors: [session1.account],
            },
        ],
    });

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent2,
    });

    expect(
        await getPostWithRootComments(context.request(session1), {
            postId: post.id,
            rootCommentLimit: 100,
        }),
    ).toEqual({
        post: {
            id: post.id,
            spaceId: post.spaceId,
            channelId: channel.id,
            content: testContent,
            createdTime: expect.any(Date),
            author: session1.account,
            totalCommentCount: 3,
            totalCommentAuthorCount: 1,
            previewCommentAuthors: [session1.account],
        },
        rootComments: [
            {
                postId: post.id,
                rootCommentNumber: 1,
                createdTime: expect.any(Date),
                author: session1.account,
                content: testCommentContent1,
                totalReplyCommentCount: 2,
                previewReplyComments: [
                    {
                        postId: post.id,
                        rootCommentNumber: 1,
                        replyCommentNumber: 1,
                        createdTime: expect.any(Date),
                        author: session1.account,
                        content: testCommentContent1,
                    },
                    {
                        postId: post.id,
                        rootCommentNumber: 1,
                        replyCommentNumber: 2,
                        createdTime: expect.any(Date),
                        author: session1.account,
                        content: testCommentContent2,
                    },
                ],
                totalReplyCommentAuthorCount: 1,
                previewReplyCommentAuthors: [session1.account],
            },
        ],
    });

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent3,
    });

    expect(
        await getPostWithRootComments(context.request(session1), {
            postId: post.id,
            rootCommentLimit: 100,
        }),
    ).toEqual({
        post: {
            id: post.id,
            spaceId: post.spaceId,
            channelId: channel.id,
            content: testContent,
            createdTime: expect.any(Date),
            author: session1.account,
            totalCommentCount: 4,
            totalCommentAuthorCount: 1,
            previewCommentAuthors: [session1.account],
        },
        rootComments: [
            {
                postId: post.id,
                rootCommentNumber: 1,
                createdTime: expect.any(Date),
                author: session1.account,
                content: testCommentContent1,
                totalReplyCommentCount: 3,
                previewReplyComments: [
                    {
                        postId: post.id,
                        rootCommentNumber: 1,
                        replyCommentNumber: 1,
                        createdTime: expect.any(Date),
                        author: session1.account,
                        content: testCommentContent1,
                    },
                    {
                        postId: post.id,
                        rootCommentNumber: 1,
                        replyCommentNumber: 2,
                        createdTime: expect.any(Date),
                        author: session1.account,
                        content: testCommentContent2,
                    },
                    {
                        postId: post.id,
                        rootCommentNumber: 1,
                        replyCommentNumber: 3,
                        createdTime: expect.any(Date),
                        author: session1.account,
                        content: testCommentContent3,
                    },
                ],
                totalReplyCommentAuthorCount: 1,
                previewReplyCommentAuthors: [session1.account],
            },
        ],
    });

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent4,
    });

    expect(
        await getPostWithRootComments(context.request(session1), {
            postId: post.id,
            rootCommentLimit: 100,
        }),
    ).toEqual({
        post: {
            id: post.id,
            spaceId: post.spaceId,
            channelId: channel.id,
            content: testContent,
            createdTime: expect.any(Date),
            author: session1.account,
            totalCommentCount: 5,
            totalCommentAuthorCount: 1,
            previewCommentAuthors: [session1.account],
        },
        rootComments: [
            {
                postId: post.id,
                rootCommentNumber: 1,
                createdTime: expect.any(Date),
                author: session1.account,
                content: testCommentContent1,
                totalReplyCommentCount: 4,
                previewReplyComments: [
                    {
                        postId: post.id,
                        rootCommentNumber: 1,
                        replyCommentNumber: 1,
                        createdTime: expect.any(Date),
                        author: session1.account,
                        content: testCommentContent1,
                    },
                    {
                        postId: post.id,
                        rootCommentNumber: 1,
                        replyCommentNumber: 2,
                        createdTime: expect.any(Date),
                        author: session1.account,
                        content: testCommentContent2,
                    },
                    {
                        postId: post.id,
                        rootCommentNumber: 1,
                        replyCommentNumber: 3,
                        createdTime: expect.any(Date),
                        author: session1.account,
                        content: testCommentContent3,
                    },
                ],
                totalReplyCommentAuthorCount: 1,
                previewReplyCommentAuthors: [session1.account],
            },
        ],
    });

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    expect(
        await getPostWithRootComments(context.request(session1), {
            postId: post.id,
            rootCommentLimit: 100,
        }),
    ).toEqual({
        post: {
            id: post.id,
            spaceId: post.spaceId,
            channelId: channel.id,
            content: testContent,
            createdTime: expect.any(Date),
            author: session1.account,
            totalCommentCount: 6,
            totalCommentAuthorCount: 2,
            previewCommentAuthors: [session1.account, session2.account],
        },
        rootComments: [
            {
                postId: post.id,
                rootCommentNumber: 1,
                createdTime: expect.any(Date),
                author: session1.account,
                content: testCommentContent1,
                totalReplyCommentCount: 5,
                previewReplyComments: [
                    {
                        postId: post.id,
                        rootCommentNumber: 1,
                        replyCommentNumber: 1,
                        createdTime: expect.any(Date),
                        author: session1.account,
                        content: testCommentContent1,
                    },
                    {
                        postId: post.id,
                        rootCommentNumber: 1,
                        replyCommentNumber: 2,
                        createdTime: expect.any(Date),
                        author: session1.account,
                        content: testCommentContent2,
                    },
                    {
                        postId: post.id,
                        rootCommentNumber: 1,
                        replyCommentNumber: 3,
                        createdTime: expect.any(Date),
                        author: session1.account,
                        content: testCommentContent3,
                    },
                ],
                totalReplyCommentAuthorCount: 2,
                previewReplyCommentAuthors: [session1.account, session2.account],
            },
        ],
    });
});

test("can set a limit on how many root comments (with post) will be shown", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent2,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent3,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent4,
    });

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent2,
    });

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent3,
    });

    await createPostRootComment(context.request(session2), {
        postId: post.id,
        content: testCommentContent4,
    });

    expect(
        await getPostWithRootComments(context.request(session1), {
            postId: post.id,
            rootCommentLimit: 100,
        }),
    ).toEqual({
        post: {
            id: post.id,
            spaceId: post.spaceId,
            channelId: channel.id,
            content: testContent,
            createdTime: expect.any(Date),
            author: session1.account,
            totalCommentCount: 8,
            totalCommentAuthorCount: 2,
            previewCommentAuthors: [session1.account, session2.account],
        },
        rootComments: [
            {
                postId: post.id,
                rootCommentNumber: 1,
                createdTime: expect.any(Date),
                author: session1.account,
                content: testCommentContent1,
                totalReplyCommentCount: 0,
                previewReplyComments: [],
                totalReplyCommentAuthorCount: 0,
                previewReplyCommentAuthors: [],
            },
            {
                postId: post.id,
                rootCommentNumber: 2,
                createdTime: expect.any(Date),
                author: session1.account,
                content: testCommentContent2,
                totalReplyCommentCount: 0,
                previewReplyComments: [],
                totalReplyCommentAuthorCount: 0,
                previewReplyCommentAuthors: [],
            },
            {
                postId: post.id,
                rootCommentNumber: 3,
                createdTime: expect.any(Date),
                author: session1.account,
                content: testCommentContent3,
                totalReplyCommentCount: 0,
                previewReplyComments: [],
                totalReplyCommentAuthorCount: 0,
                previewReplyCommentAuthors: [],
            },
            {
                postId: post.id,
                rootCommentNumber: 4,
                createdTime: expect.any(Date),
                author: session1.account,
                content: testCommentContent4,
                totalReplyCommentCount: 0,
                previewReplyComments: [],
                totalReplyCommentAuthorCount: 0,
                previewReplyCommentAuthors: [],
            },
            {
                postId: post.id,
                rootCommentNumber: 5,
                createdTime: expect.any(Date),
                author: session2.account,
                content: testCommentContent1,
                totalReplyCommentCount: 0,
                previewReplyComments: [],
                totalReplyCommentAuthorCount: 0,
                previewReplyCommentAuthors: [],
            },
            {
                postId: post.id,
                rootCommentNumber: 6,
                createdTime: expect.any(Date),
                author: session2.account,
                content: testCommentContent2,
                totalReplyCommentCount: 0,
                previewReplyComments: [],
                totalReplyCommentAuthorCount: 0,
                previewReplyCommentAuthors: [],
            },
            {
                postId: post.id,
                rootCommentNumber: 7,
                createdTime: expect.any(Date),
                author: session2.account,
                content: testCommentContent3,
                totalReplyCommentCount: 0,
                previewReplyComments: [],
                totalReplyCommentAuthorCount: 0,
                previewReplyCommentAuthors: [],
            },
            {
                postId: post.id,
                rootCommentNumber: 8,
                createdTime: expect.any(Date),
                author: session2.account,
                content: testCommentContent4,
                totalReplyCommentCount: 0,
                previewReplyComments: [],
                totalReplyCommentAuthorCount: 0,
                previewReplyCommentAuthors: [],
            },
        ],
    });

    expect(
        await getPostWithRootComments(context.request(session1), {
            postId: post.id,
            rootCommentLimit: 5,
        }),
    ).toEqual({
        post: {
            id: post.id,
            spaceId: post.spaceId,
            channelId: channel.id,
            content: testContent,
            createdTime: expect.any(Date),
            author: session1.account,
            totalCommentCount: 8,
            totalCommentAuthorCount: 2,
            previewCommentAuthors: [session1.account, session2.account],
        },
        rootComments: [
            {
                postId: post.id,
                rootCommentNumber: 1,
                createdTime: expect.any(Date),
                author: session1.account,
                content: testCommentContent1,
                totalReplyCommentCount: 0,
                previewReplyComments: [],
                totalReplyCommentAuthorCount: 0,
                previewReplyCommentAuthors: [],
            },
            {
                postId: post.id,
                rootCommentNumber: 2,
                createdTime: expect.any(Date),
                author: session1.account,
                content: testCommentContent2,
                totalReplyCommentCount: 0,
                previewReplyComments: [],
                totalReplyCommentAuthorCount: 0,
                previewReplyCommentAuthors: [],
            },
            {
                postId: post.id,
                rootCommentNumber: 3,
                createdTime: expect.any(Date),
                author: session1.account,
                content: testCommentContent3,
                totalReplyCommentCount: 0,
                previewReplyComments: [],
                totalReplyCommentAuthorCount: 0,
                previewReplyCommentAuthors: [],
            },
            {
                postId: post.id,
                rootCommentNumber: 4,
                createdTime: expect.any(Date),
                author: session1.account,
                content: testCommentContent4,
                totalReplyCommentCount: 0,
                previewReplyComments: [],
                totalReplyCommentAuthorCount: 0,
                previewReplyCommentAuthors: [],
            },
            {
                postId: post.id,
                rootCommentNumber: 5,
                createdTime: expect.any(Date),
                author: session2.account,
                content: testCommentContent1,
                totalReplyCommentCount: 0,
                previewReplyComments: [],
                totalReplyCommentAuthorCount: 0,
                previewReplyCommentAuthors: [],
            },
        ],
    });

    expect(
        await getPostWithRootComments(context.request(session1), {
            postId: post.id,
            rootCommentLimit: 2,
        }),
    ).toEqual({
        post: {
            id: post.id,
            spaceId: post.spaceId,
            channelId: channel.id,
            content: testContent,
            createdTime: expect.any(Date),
            author: session1.account,
            totalCommentCount: 8,
            totalCommentAuthorCount: 2,
            previewCommentAuthors: [session1.account, session2.account],
        },
        rootComments: [
            {
                postId: post.id,
                rootCommentNumber: 1,
                createdTime: expect.any(Date),
                author: session1.account,
                content: testCommentContent1,
                totalReplyCommentCount: 0,
                previewReplyComments: [],
                totalReplyCommentAuthorCount: 0,
                previewReplyCommentAuthors: [],
            },
            {
                postId: post.id,
                rootCommentNumber: 2,
                createdTime: expect.any(Date),
                author: session1.account,
                content: testCommentContent2,
                totalReplyCommentCount: 0,
                previewReplyComments: [],
                totalReplyCommentAuthorCount: 0,
                previewReplyCommentAuthors: [],
            },
        ],
    });
});

test("can not get post reply comments for a post that doesn't exist", async () => {
    await expect(
        getPostReplyComments(context.request(session1), {
            postId: generateId(),
            rootCommentNumber: 1,
            limit: 100,
        }),
    ).rejects.toThrow(NotFoundError);
});

test("can not get post reply comments for a root comment that doesn't exist", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await expect(
        getPostReplyComments(context.request(session1), {
            postId: generateId(),
            rootCommentNumber: 2,
            limit: 100,
        }),
    ).rejects.toThrow(NotFoundError);
});

test("can not get post reply comments for a post in a different space", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await expect(
        getPostReplyComments(context.request(otherSession), {
            postId: post.id,
            rootCommentNumber: 1,
            limit: 100,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("will get the reply comments as any user", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    expect(
        await getPostReplyComments(context.request(session1), {
            postId: post.id,
            rootCommentNumber: 1,
            limit: 100,
        }),
    ).toEqual([]);
    expect(
        await getPostReplyComments(context.request(session2), {
            postId: post.id,
            rootCommentNumber: 1,
            limit: 100,
        }),
    ).toEqual([]);
    expect(
        await getPostReplyComments(context.request(session3), {
            postId: post.id,
            rootCommentNumber: 1,
            limit: 100,
        }),
    ).toEqual([]);

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent2,
    });

    await createPostReplyComment(context.request(session3), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent3,
    });

    expect(
        await getPostReplyComments(context.request(session1), {
            postId: post.id,
            rootCommentNumber: 1,
            limit: 100,
        }),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent2,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 3,
            createdTime: expect.any(Date),
            author: session3.account,
            content: testCommentContent3,
        },
    ]);
    expect(
        await getPostReplyComments(context.request(session2), {
            postId: post.id,
            rootCommentNumber: 1,
            limit: 100,
        }),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent2,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 3,
            createdTime: expect.any(Date),
            author: session3.account,
            content: testCommentContent3,
        },
    ]);
    expect(
        await getPostReplyComments(context.request(session3), {
            postId: post.id,
            rootCommentNumber: 1,
            limit: 100,
        }),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent2,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 3,
            createdTime: expect.any(Date),
            author: session3.account,
            content: testCommentContent3,
        },
    ]);
});

test("can set a limit on how many reply comments will be shown", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent2,
    });

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent3,
    });

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent4,
    });

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent2,
    });

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent3,
    });

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent4,
    });

    expect(
        await getPostReplyComments(context.request(session1), {
            postId: post.id,
            rootCommentNumber: 1,
            limit: 100,
        }),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent2,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 3,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent3,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 4,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent4,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 5,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent1,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 6,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent2,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 7,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent3,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 8,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent4,
        },
    ]);

    expect(
        await getPostReplyComments(context.request(session1), {
            postId: post.id,
            rootCommentNumber: 1,
            limit: 5,
        }),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent2,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 3,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent3,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 4,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent4,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 5,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent1,
        },
    ]);

    expect(
        await getPostReplyComments(context.request(session1), {
            postId: post.id,
            rootCommentNumber: 1,
            limit: 2,
        }),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 1,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent1,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 2,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent2,
        },
    ]);
});

test("can set a reply comment number to read comments after", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent2,
    });

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent3,
    });

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent4,
    });

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent2,
    });

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent3,
    });

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent4,
    });

    expect(
        await getPostReplyComments(context.request(session1), {
            postId: post.id,
            limit: 100,
            rootCommentNumber: 1,
            afterReplyCommentNumber: 2,
        }),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 3,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent3,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 4,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent4,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 5,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent1,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 6,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent2,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 7,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent3,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 8,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent4,
        },
    ]);

    expect(
        await getPostReplyComments(context.request(session1), {
            postId: post.id,
            limit: 100,
            rootCommentNumber: 1,
            afterReplyCommentNumber: 5,
        }),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 6,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent2,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 7,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent3,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 8,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent4,
        },
    ]);
});

test("can set a reply comment number and limit to read a page of comments", async () => {
    const channel = await createChannel(context.request(session1), {
        spaceId: space.id,
        name: "Test",
    });

    const post = await createPost(context.request(session1), {
        channelId: channel.id,
        content: testContent,
    });

    await createPostRootComment(context.request(session1), {
        postId: post.id,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent2,
    });

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent3,
    });

    await createPostReplyComment(context.request(session1), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent4,
    });

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent1,
    });

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent2,
    });

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent3,
    });

    await createPostReplyComment(context.request(session2), {
        postId: post.id,
        rootCommentNumber: 1,
        content: testCommentContent4,
    });

    expect(
        await getPostReplyComments(context.request(session1), {
            postId: post.id,
            limit: 3,
            rootCommentNumber: 1,
            afterReplyCommentNumber: 2,
        }),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 3,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent3,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 4,
            createdTime: expect.any(Date),
            author: session1.account,
            content: testCommentContent4,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 5,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent1,
        },
    ]);

    expect(
        await getPostReplyComments(context.request(session1), {
            postId: post.id,
            limit: 3,
            rootCommentNumber: 1,
            afterReplyCommentNumber: 6,
        }),
    ).toEqual([
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 7,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent3,
        },
        {
            postId: post.id,
            rootCommentNumber: 1,
            replyCommentNumber: 8,
            createdTime: expect.any(Date),
            author: session2.account,
            content: testCommentContent4,
        },
    ]);
});
