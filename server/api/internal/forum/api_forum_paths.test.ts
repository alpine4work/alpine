import {apiForumPaths} from "~/server/api/internal/forum/api_forum_paths.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {forumInjection} from "~/server/forum/data/forum_injection.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestPost} from "~/server/forum/test_helpers/test_post.js";
import {TestMessagingRoomBase} from "~/server/messaging/test_helpers/test_messaging_room_base.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {
    PostContentProsemirrorSchema,
    assertPostContent,
} from "~/shared/forum/post_content_schema.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {ChannelId, PostId} from "~/shared/id/types/id_types.js";

const context = createTestContext({
    forumInjection,
});

const server = createTestApiServer(context, apiForumPaths);

test("can read channel information", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const channel = await TestChannel.create(session, {
        name: "Test Channel",
        description: "This is a test channel for the API",
        access: "Public",
    });

    expect(
        await server.GET(`/channels/${channel.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            spaceId: space.id,
            channel: expect.objectContaining({
                id: channel.id,
                name: "Test Channel",
                description: expect.objectContaining({
                    elements: expect.arrayContaining([
                        expect.objectContaining({
                            type: "Paragraph",
                            elements: expect.arrayContaining([
                                expect.objectContaining({
                                    type: "Text",
                                    text: "This is a test channel for the API",
                                }),
                            ]),
                        }),
                    ]),
                }),
            }),
        }),
    });
});

test("can\u2019t read channel information without access", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const channel = await TestChannel.create(session2, {access: "Private"});

    expect(
        await server.GET(`/channels/${channel.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 403,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: expect.objectContaining({
                message: expect.stringMatching("You aren\u2019t allowed"),
            }),
        },
    });
});

test("can\u2019t read channel information for non-existent channel", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    expect(
        await server.GET(`/channels/${generateId<ChannelId>()}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 404,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: expect.objectContaining({
                message: expect.stringMatching("doesn\u2019t exist"),
            }),
        },
    });
});

describe("/channels/{id}/mention", () => {
    test("can read channel mention", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const channel = await TestChannel.create(session, {
            name: "Test Channel Name",
            access: "Public",
        });

        expect(
            await server.GET(`/channels/${channel.id}/mention`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                mention: {
                    target: {
                        type: "Channel",
                        id: channel.id,
                    },
                    title: "Test Channel Name",
                },
            },
        });
    });

    test("can’t read channel mention without access", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const session2 = await space.createSession();

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey(session1);

        const channel = await TestChannel.create(session2, {access: "Private"});

        expect(
            await server.GET(`/channels/${channel.id}/mention`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 403,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message: expect.stringMatching("You aren’t allowed to access this channel."),
                }),
            },
        });
    });

    test("can’t read channel mention for non-existent channel", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        expect(
            await server.GET(`/channels/${generateId<ChannelId>()}/mention`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 404,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message: expect.stringMatching("This channel doesn’t exist"),
                }),
            },
        });
    });
});

test("can read post information", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Post Author", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const channel = await TestChannel.create(session, {
        name: "Test Channel",
        access: "Public",
    });
    const post = await channel.createPost(session, "This is a test post content.");

    expect(
        await server.GET(`/posts/${post.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            spaceId: space.id,
            post: expect.objectContaining({
                id: post.id,
                author: expect.objectContaining({
                    id: session.account.id,
                    name: "Post Author",
                }),
                channel: expect.objectContaining({
                    id: channel.id,
                    name: "Test Channel",
                }),
                content: expect.objectContaining({
                    elements: expect.arrayContaining([
                        expect.objectContaining({
                            type: "Paragraph",
                            elements: expect.arrayContaining([
                                expect.objectContaining({
                                    type: "Text",
                                    text: "This is a test post content.",
                                }),
                            ]),
                        }),
                    ]),
                }),
            }),
        }),
    });
});

test("can\u2019t read post information without access", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const channel = await TestChannel.create(session2, {access: "Private"});
    const post = await channel.createPost(session2);

    expect(
        await server.GET(`/posts/${post.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 403,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: expect.objectContaining({
                message: expect.stringMatching("You aren\u2019t allowed"),
            }),
        },
    });
});

test("can\u2019t read post information for non-existent post", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    expect(
        await server.GET(`/posts/${generateId<PostId>()}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 404,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            error: expect.objectContaining({
                message: expect.stringMatching("doesn\u2019t exist"),
            }),
        },
    });
});

describe("/posts/{id}/mention", () => {
    test("can read post mention", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Bob", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const channel = await TestChannel.create(session, {
            name: "Test Channel",
            access: "Public",
        });
        const post = await channel.createPost(session, "This is post content for mention.");

        expect(
            await server.GET(`/posts/${post.id}/mention`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                mention: {
                    target: {
                        type: "Post",
                        id: post.id,
                    },
                    title: "Bob in Test Channel: This is post content for mention",
                },
            },
        });
    });

    test("can’t read post mention without access", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const session2 = await space.createSession();

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey(session1);

        const channel = await TestChannel.create(session2, {access: "Private"});
        const post = await channel.createPost(session2, "Private post content");

        const response = await server.GET(`/posts/${post.id}/mention`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect(response.status).toEqual(403);
        expect(response.body.error.message).toMatch(/You aren.t allowed/);
    });

    test("can’t read post mention for non-existent post", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const response = await server.GET(`/posts/${generateId<PostId>()}/mention`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect(response.status).toEqual(404);
        expect(response.body.error.message).toMatch(/This post doesn.t exist/);
    });

    test("can read post mention with post scope", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Bob", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const channel = await TestChannel.create(session, {
            name: "Scoped Channel",
            access: "Private",
        });
        const post = await channel.createPost(session, "Scoped post content");
        const apiKey = await bot.createApiKey({type: "Post", postId: post.id});

        expect(
            await server.GET(`/posts/${post.id}/mention`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                mention: {
                    target: {
                        type: "Post",
                        id: post.id,
                    },
                    title: "Bob in Scoped Channel: Scoped post content",
                },
            },
        });
    });
});

test("can read post information with post scope", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Post Author", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const channel = await TestChannel.create(session, {
        name: "Test Channel",
        access: "Private",
    });
    const post = await channel.createPost(session, "This is a test post content.");
    const apiKey = await bot.createApiKey({type: "Post", postId: post.id});

    expect(
        await server.GET(`/posts/${post.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: expect.objectContaining({
            spaceId: space.id,
            post: expect.objectContaining({
                id: post.id,
                author: expect.objectContaining({
                    id: session.account.id,
                    name: "Post Author",
                }),
                channel: expect.objectContaining({
                    id: channel.id,
                    name: "Test Channel",
                }),
                content: expect.objectContaining({
                    elements: expect.arrayContaining([
                        expect.objectContaining({
                            type: "Paragraph",
                            elements: expect.arrayContaining([
                                expect.objectContaining({
                                    type: "Text",
                                    text: "This is a test post content.",
                                }),
                            ]),
                        }),
                    ]),
                }),
            }),
        }),
    });
});

describe("post creation", () => {
    test("can create a post", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Post Author", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session, {name: "Test Bot"});
        const apiKey = await bot.createApiKey(session);

        const channel = await TestChannel.create(session, {
            name: "Test Channel",
            access: "Public",
        });

        const response = await server.POST("/posts", {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                channelId: channel.id,
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "This is my new post!"}],
                        },
                    ],
                },
            },
        });

        expect(response).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                post: {
                    id: expect.any(String),
                    author: {
                        botId: bot.bot.id,
                        id: bot.action().actor.getBotAccountId(),
                        name: expect.stringMatching(bot.initialName),
                        shortName: "Test",
                        space: {
                            addedTime: expect.any(String),
                            role: "Member",
                        },
                    },
                    createdTime: expect.any(String),
                    createdTimeZone: defaultTimeZone,
                    channel: {
                        id: channel.id,
                        name: "Test Channel",
                    },
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {
                                        type: "Text",
                                        text: "This is my new post!",
                                    },
                                ],
                            },
                        ],
                    },
                    contentPreview: "in Test Channel: This is my new post!",
                },
            },
        });
    });

    test("can create a post with rich content", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const channel = await TestChannel.create(session, {
            name: "Rich Content Channel",
            access: "Public",
        });

        const response = await server.POST("/posts", {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                channelId: channel.id,
                content: {
                    elements: [
                        {
                            type: "Heading",
                            level: 1,
                            elements: [{type: "Text", text: "Important Announcement"}],
                        },
                        {
                            type: "Paragraph",
                            elements: [
                                {type: "Text", text: "This is "},
                                {
                                    type: "Text",
                                    text: "bold",
                                    marks: [{type: "Bold"}],
                                },
                                {type: "Text", text: " and "},
                                {
                                    type: "Text",
                                    text: "italic",
                                    marks: [{type: "Italic"}],
                                },
                                {type: "Text", text: " text."},
                            ],
                        },
                    ],
                },
            },
        });

        expect(response).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                post: {
                    id: expect.any(String),
                    author: {
                        botId: bot.bot.id,
                        id: bot.action().actor.getBotAccountId(),
                        name: expect.stringMatching(bot.initialName),
                        shortName: "Test",
                        space: {
                            addedTime: expect.any(String),
                            role: "Member",
                        },
                    },
                    createdTime: expect.any(String),
                    createdTimeZone: defaultTimeZone,
                    channel: {
                        id: channel.id,
                        name: "Rich Content Channel",
                    },
                    content: {
                        elements: [
                            {
                                type: "Heading",
                                level: 1,
                                elements: [{type: "Text", text: "Important Announcement"}],
                            },
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: "This is "},
                                    {type: "Text", text: "bold", marks: [{type: "Bold"}]},
                                    {type: "Text", text: " and "},
                                    {type: "Text", text: "italic", marks: [{type: "Italic"}]},
                                    {type: "Text", text: " text."},
                                ],
                            },
                        ],
                    },
                    contentPreview: "in Rich Content Channel: Important Announcement",
                },
            },
        });
    });

    test("can\u2019t create post without access to channel", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const session2 = await space.createSession();

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey(session1);

        const channel = await TestChannel.create(session2, {access: "Private"});

        expect(
            await server.POST("/posts", {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    channelId: channel.id,
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Unauthorized post"}],
                            },
                        ],
                    },
                },
            }),
        ).toEqual({
            status: 403,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message:
                        "You aren\u2019t allowed to post in this channel. Ask someone who can share the channel to give you post access.",
                }),
            },
        });
    });

    test("can\u2019t create post for non-existent channel", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        expect(
            await server.POST("/posts", {
                headers: {authorization: `bearer ${apiKey}`},
                body: {
                    channelId: generateId<ChannelId>(),
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Post to nowhere"}],
                            },
                        ],
                    },
                },
            }),
        ).toEqual({
            status: 404,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message:
                        "This channel doesn\u2019t exist. Try searching \u201Cmy channels\u201D to see channels you\u2019ve posted in.",
                }),
            },
        });
    });

    test("can\u2019t create post without authorization (no API key)", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const channel = await TestChannel.create(session, {
            name: "Test Channel",
            access: "Public",
        });

        expect(
            await server.POST("/posts", {
                headers: {},
                body: {
                    channelId: channel.id,
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Unauthorized post"}],
                            },
                        ],
                    },
                },
            }),
        ).toEqual({
            status: 401,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message: "Missing `Authorization` header.",
                }),
            },
        });
    });

    test("can create post with empty content", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const channel = await TestChannel.create(session, {
            name: "Test Channel",
            access: "Public",
        });

        const response = await server.POST("/posts", {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                channelId: channel.id,
                content: {
                    elements: [{type: "Paragraph", elements: []}],
                },
            },
        });

        expect(response).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                post: {
                    id: expect.any(String),
                    author: {
                        botId: bot.bot.id,
                        id: bot.action().actor.getBotAccountId(),
                        name: expect.stringMatching(bot.initialName),
                        shortName: "Test",
                        space: {
                            addedTime: expect.any(String),
                            role: "Member",
                        },
                    },
                    channel: {
                        id: channel.id,
                        name: "Test Channel",
                    },
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [],
                            },
                        ],
                    },
                    contentPreview: "in Test Channel:",
                    createdTime: expect.any(String),
                    createdTimeZone: defaultTimeZone,
                },
            },
        });
    });
});

describe("post comment parents", () => {
    test("includes PostRange parent with short content snippet (not truncated)", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Alice Smith", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const channel = await TestChannel.create(session, {
            name: "Discussion Channel",
            access: "Public",
        });
        const post = await channel.createPost(session, "Short post content");

        const comment = await TestMessagingRoomBase.createMessage(
            post,
            session,
            "This is a reply to the post",
            {
                parent: {type: "PostRange", contentVersion: 0, startPos: 0, endPos: 10},
            },
        );

        const response = await server.GET(`/posts/${post.id}/messages/${comment.index}`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect(response.status).toEqual(200);
        expect(response.body.message.payload.type).toEqual("Content");
        expect(response.body.message.payload.parent).toEqual({
            type: "Post",
            contentSnippet: {
                elements: [
                    {
                        type: "Text",
                        text: "Short pos",
                    },
                ],
                isTruncated: false,
            },
            author: expect.objectContaining({
                id: session.account.id,
                name: "Alice Smith",
            }),
        });
    });

    test("includes PostRange parent with long content snippet (truncated)", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Bob Jones", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const channel = await TestChannel.create(session, {
            name: "Long Posts Channel",
            access: "Public",
        });

        // Create a long post that should be truncated
        const longText = "This is a very long post that should be truncated. ".repeat(20);
        const post = await channel.createPost(session, longText);

        const comment = await TestMessagingRoomBase.createMessage(
            post,
            session,
            "Reply to long post",
            {
                parent: {type: "PostRange", contentVersion: 0, startPos: 10, endPos: 20},
            },
        );

        const response = await server.GET(`/posts/${post.id}/messages/${comment.index}`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect(response.status).toEqual(200);
        expect(response.body.message.payload.parent).toEqual(
            expect.objectContaining({
                type: "Post",
                contentSnippet: {
                    elements: [
                        {
                            type: "Text",
                            text: " very long",
                        },
                    ],
                    isTruncated: false,
                },
                author: expect.objectContaining({
                    id: session.account.id,
                    name: "Bob Jones",
                }),
            }),
        );
    });

    test("includes PostRange parent with marks in content snippet", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Charlie Brown", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const channel = await TestChannel.create(session, {
            name: "Rich Content Channel",
            access: "Public",
        });

        // Create post with code and strike text
        const postContent = PostContentProsemirrorSchema.node("doc", {}, [
            PostContentProsemirrorSchema.node("paragraph", {}, [
                PostContentProsemirrorSchema.text("This is "),
                PostContentProsemirrorSchema.text("code", [
                    PostContentProsemirrorSchema.mark("code"),
                ]),
                PostContentProsemirrorSchema.text(" and "),
                PostContentProsemirrorSchema.text("strike", [
                    PostContentProsemirrorSchema.mark("strike"),
                ]),
                PostContentProsemirrorSchema.text(" text"),
            ]),
        ]);

        const post = await TestPost._create(session, channel, assertPostContent(postContent));

        const comment = await TestMessagingRoomBase.createMessage(
            post,
            session,
            "Reply with marks",
            {
                parent: {type: "PostRange", contentVersion: 0, startPos: 0, endPos: 10},
            },
        );

        const response = await server.GET(`/posts/${post.id}/messages/${comment.index}`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect(response.status).toEqual(200);
        expect(response.body.message.payload.type).toEqual("Content");
        expect(response.body.message.payload.parent).toEqual({
            type: "Post",
            contentSnippet: {
                elements: [
                    {
                        type: "Text",
                        text: "This is ",
                    },
                    {
                        type: "Text",
                        text: "c",
                        marks: [{type: "Code"}],
                    },
                ],
                isTruncated: false,
            },
            author: expect.objectContaining({
                id: session.account.id,
                name: "Charlie Brown",
            }),
        });
    });

    test("includes PostRange parent with multiple marks on same text", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Dana White", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const channel = await TestChannel.create(session, {
            name: "Formatting Channel",
            access: "Public",
        });

        // Create post with multiple marks on same text
        const postContent = PostContentProsemirrorSchema.node("doc", {}, [
            PostContentProsemirrorSchema.node("paragraph", {}, [
                PostContentProsemirrorSchema.text("Normal text and "),
                PostContentProsemirrorSchema.text("bold italic", [
                    PostContentProsemirrorSchema.mark("bold"),
                    PostContentProsemirrorSchema.mark("italic"),
                ]),
            ]),
        ]);

        const post = await TestPost._create(session, channel, assertPostContent(postContent));

        const comment = await TestMessagingRoomBase.createMessage(post, session, "Reply", {
            parent: {type: "PostRange", contentVersion: 0, startPos: 0, endPos: 10},
        });

        const response = await server.GET(`/posts/${post.id}/messages/${comment.index}`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect(response.status).toEqual(200);
        expect(response.body.message.payload.type).toEqual("Content");
        expect(response.body.message.payload.parent).toEqual({
            type: "Post",
            contentSnippet: {
                elements: [
                    {
                        type: "Text",
                        text: "Normal te",
                    },
                ],
                isTruncated: false,
            },
            author: expect.objectContaining({id: session.account.id}),
        });
    });
});

test("can read post with file attachment", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const channel = await TestChannel.create(session);

    const file = await TestFile.create(session);
    const post = await channel.createPost(session, "Post with file", {
        files: [file],
    });

    const response = await server.GET(`/posts/${post.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
    });

    expect(response).toMatchObject({
        status: 200,
        body: {
            post: expect.objectContaining({
                content: expect.objectContaining({
                    elements: expect.arrayContaining([
                        expect.objectContaining({
                            type: "File",
                            id: file.id,
                            contentType: "image/png",
                            contentLength: 5232,
                        }),
                    ]),
                }),
            }),
        },
    });
});
