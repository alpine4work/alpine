import {apiForumPaths} from "~/server/api/internal/forum/api_forum_paths.js";
import {ApiOperation200JsonResponseType} from "~/server/api/internal/shared/api_paths_type.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {forumInjection} from "~/server/forum/data/forum_injection.js";
import {getChannelNameAndDescriptionContent} from "~/server/forum/data/get_channel_name_and_description_content.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestPost} from "~/server/forum/test_helpers/test_post.js";
import {TestMessagingRoomBase} from "~/server/messaging/test_helpers/test_messaging_room_base.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ApiContentKeyDecoder} from "~/shared/api/content/closed_source/api_content_key_encoder.js";
import {
    PostContentProsemirrorSchema,
    assertPostContent,
} from "~/shared/forum/post_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {ChannelId, DocumentId, PostId} from "~/shared/id/types/id_types.js";

const context = createTestContext({
    documentsInjection,
    forumInjection,
    notificationsInjection: {
        archiveInboxPostCommentsEntryAfterSetPostCommentReaction: async () => {},
    },
    // Preview file elements resolve their titles through the search index. Returning
    // `null` makes every preview render with an "Unknown" title.
    searchInjection: {
        getSearchMentionEntityIfPossible: async () => null,
    },
});

const server = createTestApiServer(context, apiForumPaths);

/**
 * Wraps expected paragraph and heading content with key matchers.
 */
function expectApiContentWithTextBlockKeys(content: {
    elements: Array<
        | {type: "Paragraph"; elements: Array<unknown>}
        | {type: "Heading"; level: number; elements: Array<unknown>}
    >;
}) {
    return {
        elements: content.elements.map(element =>
            expect.objectContaining({
                ...element,
                key: expect.any(String),
            }),
        ),
    };
}

function createApiParagraphContent(text: string) {
    return {
        elements: [
            {
                type: "Paragraph" as const,
                elements: [{type: "Text" as const, text}],
            },
        ],
    };
}

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

test("can create channel information", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const response = await server.POST("/channels", {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            spaceId: space.id,
            channel: {
                creator: {account: {id: session.account.id}},
                name: "Created API Channel",
                description: createApiParagraphContent("Created through the API"),
            },
        },
    });

    expect(response).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            spaceId: space.id,
            channel: {
                id: expect.any(String),
                name: "Created API Channel",
                description: expectApiContentWithTextBlockKeys({
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "Created through the API"}],
                        },
                    ],
                }),
            },
        },
    });

    await expect(
        getChannelNameAndDescriptionContent(space.systemAction(), response.body.channel.id, {
            consistency: "StrongWithinCache",
        }),
    ).resolves.toMatchObject({
        creatorId: session.account.id,
    });
});

test("can update channel information", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const channel = await TestChannel.create(session, {
        name: "Original Channel",
        description: "Original description",
        access: "Public",
    });

    expect(
        await server.PATCH(`/channels/${channel.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [
                    {type: "SetName", name: "Updated Channel"},
                    {
                        type: "SetDescription",
                        description: createApiParagraphContent("Updated description"),
                    },
                ],
            },
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            spaceId: space.id,
            channel: {
                id: channel.id,
                name: "Updated Channel",
                description: expectApiContentWithTextBlockKeys({
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "Updated description"}],
                        },
                    ],
                }),
            },
        },
    });
});

test("can\u2019t update channel information without access", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({role: "Admin"});
    const session2 = await space.createSession();

    const bot = await TestBot.createAndInstantiate(session1);
    const apiKey = await bot.createApiKey(session1);

    const channel = await TestChannel.create(session2, {access: "Private"});

    expect(
        await server.PATCH(`/channels/${channel.id}`, {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                patches: [{type: "SetName", name: "Updated Channel"}],
            },
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

test("can read a channel preview without its description", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);
    const channel = await TestChannel.create(session, {
        name: "Preview Channel",
        description: "Description that should not be returned",
        access: "Public",
    });

    expect(
        await server.GET(`/channels/${channel.id}-preview`, {
            headers: {authorization: `bearer ${apiKey}`},
        }),
    ).toEqual({
        status: 200,
        headers: expect.objectContaining({"content-type": "application/json"}),
        body: {
            spaceId: space.id,
            channel: {
                id: channel.id,
                name: "Preview Channel",
            },
        },
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

describe("/channels/{id}-reference", () => {
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
            await server.GET(`/channels/${channel.id}-reference`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                reference: {
                    type: "Channel",
                    id: channel.id,
                    title: "Test Channel Name",
                },
            },
        });
    });

    test("can\u2019t read channel mention without access", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const session2 = await space.createSession();

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey(session1);

        const channel = await TestChannel.create(session2, {access: "Private"});

        expect(
            await server.GET(`/channels/${channel.id}-reference`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 403,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message: expect.stringMatching(
                        "You aren\u2019t allowed to access this channel.",
                    ),
                }),
            },
        });
    });

    test("can\u2019t read channel mention for non-existent channel", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        expect(
            await server.GET(`/channels/${generateId<ChannelId>()}-reference`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 404,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                error: expect.objectContaining({
                    message: expect.stringMatching("This channel doesn\u2019t exist"),
                }),
            },
        });
    });
});

describe("/channels/{id}/posts", () => {
    test("can read channel post previews with pagination", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Post Author", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const channel = await TestChannel.create(session, {
            name: "Test Channel",
            access: "Public",
        });
        const post1 = await channel.createPost(session, "First post content.");
        const post2 = await channel.createPost(session, "Second post content.");
        const post3 = await channel.createPost(session, "Third post content.");

        const firstResponse = await server.GET(`/channels/${channel.id}/posts?limit=2`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect(firstResponse).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    name: "Test Channel",
                },
                posts: [
                    {
                        id: post3.id,
                        author: expect.objectContaining({
                            id: session.account.id,
                            name: "Post Author",
                        }),
                        createdTime: expect.any(String),
                        createdTimeZone: defaultTimeZone,
                        commentCount: 0,
                        channel: {
                            id: channel.id,
                            name: "Test Channel",
                        },
                        contentSnippet: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Third post content."}],
                                },
                            ],
                        },
                        reference: {title: "in Test Channel: Third post content"},
                    },
                    {
                        id: post2.id,
                        author: expect.objectContaining({
                            id: session.account.id,
                            name: "Post Author",
                        }),
                        createdTime: expect.any(String),
                        createdTimeZone: defaultTimeZone,
                        commentCount: 0,
                        channel: {
                            id: channel.id,
                            name: "Test Channel",
                        },
                        contentSnippet: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Second post content."}],
                                },
                            ],
                        },
                        reference: {title: "in Test Channel: Second post content"},
                    },
                ],
                nextCursor: expect.any(String),
            },
        });

        expect(firstResponse.body.posts[0]).not.toHaveProperty("content");
        const firstPageLastPost = firstResponse.body.posts[1];
        assert(firstPageLastPost !== undefined);
        expect(firstResponse.body.nextCursor).toBe(firstPageLastPost.createdTime);

        const nextCursor = firstResponse.body.nextCursor;
        assert(nextCursor !== null);

        const secondResponse = await server.GET(
            `/channels/${channel.id}/posts?limit=2&cursor=${encodeURIComponent(nextCursor)}`,
            {headers: {authorization: `bearer ${apiKey}`}},
        );

        expect(secondResponse).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                channel: {
                    id: channel.id,
                    name: "Test Channel",
                },
                posts: [
                    {
                        id: post1.id,
                        author: expect.objectContaining({
                            id: session.account.id,
                            name: "Post Author",
                        }),
                        createdTime: expect.any(String),
                        createdTimeZone: defaultTimeZone,
                        commentCount: 0,
                        channel: {
                            id: channel.id,
                            name: "Test Channel",
                        },
                        contentSnippet: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "First post content."}],
                                },
                            ],
                        },
                        reference: {title: "in Test Channel: First post content"},
                    },
                ],
                nextCursor: null,
            },
        });
    });

    test("truncates channel post preview content deterministically", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const channel = await TestChannel.create(session, {access: "Public"});
        await channel.createPost(session, "x".repeat(1_300));

        expect(
            await server.GET(`/channels/${channel.id}/posts`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toMatchObject({
            status: 200,
            body: {
                posts: [
                    {
                        contentSnippet: createApiParagraphContent("x".repeat(1_223)),
                    },
                ],
            },
        });
    });

    test("can\u2019t read channel post previews without access", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const session2 = await space.createSession();

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey(session1);

        const channel = await TestChannel.create(session2, {access: "Private"});
        await channel.createPost(session2, "Private post content");

        expect(
            await server.GET(`/channels/${channel.id}/posts`, {
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
});

describe("/posts/{id}-preview", () => {
    test("can read a post preview", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Post Author", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const channel = await TestChannel.create(session, {
            name: "Test Channel",
            access: "Public",
        });
        const post = await channel.createPost(session, "This is a test post preview.");

        expect(
            await server.GET(`/posts/${post.id}-preview`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                post: {
                    id: post.id,
                    author: expect.objectContaining({
                        id: session.account.id,
                        name: "Post Author",
                    }),
                    createdTime: expect.any(String),
                    createdTimeZone: defaultTimeZone,
                    channel: {
                        id: channel.id,
                        name: "Test Channel",
                    },
                    contentSnippet: createApiParagraphContent("This is a test post preview."),
                    commentCount: 0,
                    reference: {
                        title: "in Test Channel: This is a test post preview",
                    },
                },
            },
        });
    });

    test("can\u2019t read a post preview without access", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const session2 = await space.createSession();

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey(session1);

        const channel = await TestChannel.create(session2, {access: "Private"});
        const post = await channel.createPost(session2);

        expect(
            await server.GET(`/posts/${post.id}-preview`, {
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

    test("can\u2019t read a post preview for a non-existent post", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        expect(
            await server.GET(`/posts/${generateId<PostId>()}-preview`, {
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

    test("can read a post preview with post scope", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const channel = await TestChannel.create(session, {access: "Private"});
        const post = await channel.createPost(session, "Post-scoped preview content.");
        const apiKey = await bot.createApiKey({type: "Post", postId: post.id});

        const response = await server.GET(`/posts/${post.id}-preview`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect({
            status: response.status,
            spaceId: response.body.spaceId,
            postId: response.body.post.id,
            contentSnippet: response.body.post.contentSnippet,
        }).toEqual({
            status: 200,
            spaceId: space.id,
            postId: post.id,
            contentSnippet: createApiParagraphContent("Post-scoped preview content."),
        });
    });

    test("truncates post preview content deterministically", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const channel = await TestChannel.create(session, {access: "Public"});
        const post = await channel.createPost(session, "x".repeat(1_300));

        const response = await server.GET(`/posts/${post.id}-preview`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect({
            status: response.status,
            contentSnippet: response.body.post.contentSnippet,
        }).toEqual({
            status: 200,
            contentSnippet: createApiParagraphContent("x".repeat(1_223)),
        });
    });

    test("post preview content remains keyless after content and metadata updates", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const channel = await TestChannel.create(session, {access: "Public"});
        const post = await channel.createPost(session, "Original post content.");

        await post.updateContent(session, "Updated post content.");
        await post.setReaction(session);

        const response = await server.GET(`/posts/${post.id}-preview`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect({
            status: response.status,
            contentSnippet: response.body.post.contentSnippet,
        }).toEqual({
            status: 200,
            contentSnippet: createApiParagraphContent("Updated post content."),
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
                reference: {
                    title: "in Test Channel: This is a test post content",
                },
            }),
        }),
    });
});

test("post content keys use content version instead of update lock version", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Post Author", role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const channel = await TestChannel.create(session, {
        name: "Test Channel",
        access: "Public",
    });
    const post = await channel.createPost(session, "Original post content.");

    await post.updateContent(session, "Updated post content.");
    await post.setReaction(session);

    const response = await server.GET(`/posts/${post.id}`, {
        headers: {authorization: `bearer ${apiKey}`},
    });

    expect(response).toMatchObject({
        status: 200,
        body: {
            post: {
                content: {
                    elements: [{key: expect.any(String)}],
                },
            },
        },
    });

    const body: ApiOperation200JsonResponseType<"/posts/{id}", "get"> = response.body;

    const firstElement = body.post.content.elements[0];
    assert(firstElement?.type === "Paragraph");
    assert(firstElement.key !== undefined);

    const decoder = new ApiContentKeyDecoder(`Post:${post.id}`);

    expect(decoder.decode(firstElement.key).version).toBe(1);
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

describe("/posts/{id}-reference", () => {
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
            await server.GET(`/posts/${post.id}-reference`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                reference: {
                    type: "Post",
                    id: post.id,
                    title: "Bob in Test Channel: This is post content for mention",
                },
            },
        });
    });

    test("can\u2019t read post mention without access", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession({role: "Admin"});
        const session2 = await space.createSession();

        const bot = await TestBot.createAndInstantiate(session1);
        const apiKey = await bot.createApiKey(session1);

        const channel = await TestChannel.create(session2, {access: "Private"});
        const post = await channel.createPost(session2, "Private post content");

        const response = await server.GET(`/posts/${post.id}-reference`, {
            headers: {authorization: `bearer ${apiKey}`},
        });

        expect(response.status).toEqual(403);
        expect(response.body.error.message).toMatch(/You aren.t allowed/);
    });

    test("can\u2019t read post mention for non-existent post", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session);
        const apiKey = await bot.createApiKey(session);

        const response = await server.GET(`/posts/${generateId<PostId>()}-reference`, {
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
            await server.GET(`/posts/${post.id}-reference`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toEqual({
            status: 200,
            headers: expect.objectContaining({"content-type": "application/json"}),
            body: {
                spaceId: space.id,
                reference: {
                    type: "Post",
                    id: post.id,
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
                spaceId: space.id,
                post: {
                    channel: {id: channel.id},
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "This is my new post!"}],
                            },
                        ],
                    },
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
                        id: bot.action().actor.getBotAccountId(),
                        bot: {id: bot.bot.id},
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
                        elements: expectApiContentWithTextBlockKeys({
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
                        }).elements,
                    },
                    reference: {title: "in Test Channel: This is my new post!"},
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
                spaceId: space.id,
                post: {
                    channel: {id: channel.id},
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
                        id: bot.action().actor.getBotAccountId(),
                        bot: {id: bot.bot.id},
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
                        elements: expectApiContentWithTextBlockKeys({
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
                                        {
                                            type: "Text",
                                            text: "italic",
                                            marks: [{type: "Italic"}],
                                        },
                                        {type: "Text", text: " text."},
                                    ],
                                },
                            ],
                        }).elements,
                    },
                    reference: {title: "in Rich Content Channel: Important Announcement"},
                },
            },
        });
    });

    test("can create a post with an explicit creator", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({name: "Post Creator", role: "Admin"});

        const bot = await TestBot.createAndInstantiate(session, {name: "Test Bot"});
        const apiKey = await bot.createApiKey(session);

        const channel = await TestChannel.create(session, {
            name: "Creator Channel",
            access: "Public",
        });

        const response = await server.POST("/posts", {
            headers: {authorization: `bearer ${apiKey}`},
            body: {
                spaceId: space.id,
                post: {
                    creator: {account: {id: session.account.id}},
                    channel: {id: channel.id},
                    content: createApiParagraphContent("This post has an explicit creator."),
                },
            },
        });

        assert(response.status === 200);

        expect(response.body.post.author).toMatchObject({
            id: session.account.id,
            name: "Post Creator",
            shortName: "Post",
            space: {
                role: "Admin",
            },
        });

        expect(
            await server.GET(`/posts/${response.body.post.id}`, {
                headers: {authorization: `bearer ${apiKey}`},
            }),
        ).toMatchObject({
            status: 200,
            body: {
                post: {
                    author: {
                        id: session.account.id,
                        name: "Post Creator",
                        shortName: "Post",
                    },
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
                    spaceId: space.id,
                    post: {
                        channel: {id: channel.id},
                        content: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Unauthorized post"}],
                                },
                            ],
                        },
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
                    spaceId: space.id,
                    post: {
                        channel: {id: generateId<ChannelId>()},
                        content: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Post to nowhere"}],
                                },
                            ],
                        },
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
                    spaceId: space.id,
                    post: {
                        channel: {id: channel.id},
                        content: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Unauthorized post"}],
                                },
                            ],
                        },
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
                spaceId: space.id,
                post: {
                    channel: {id: channel.id},
                    content: {
                        elements: [{type: "Paragraph", elements: []}],
                    },
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
                        id: bot.action().actor.getBotAccountId(),
                        bot: {id: bot.bot.id},
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
                        elements: expectApiContentWithTextBlockKeys({
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [],
                                },
                            ],
                        }).elements,
                    },
                    reference: {title: "in Test Channel:"},
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

test("can create post with file attachment", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const channel = await TestChannel.create(session, {access: "Public"});

    // Upload a file and attach it to a public document so the bot can access it.
    const file = await TestFile.create(session);
    const document = await TestDocument.create(session, {
        title: "Source",
        access: "Public",
    });
    await document.attachFile(session, file);

    const response = await server.POST("/posts", {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            spaceId: space.id,
            post: {
                channel: {id: channel.id},
                content: {
                    elements: [
                        {
                            type: "File",
                            file: {id: file.id},
                        },
                    ],
                },
            },
        },
    });

    expect(response).toMatchObject({
        status: 200,
        body: {
            post: expect.objectContaining({
                content: expect.objectContaining({
                    elements: expect.arrayContaining([
                        expect.objectContaining({
                            type: "File",
                            file: expect.objectContaining({id: file.id}),
                        }),
                    ]),
                }),
            }),
        },
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
                            file: {
                                id: file.id,
                                contentType: "image/png",
                                contentLength: 5232,
                            },
                        }),
                    ]),
                }),
            }),
        },
    });
});

test("can create post comment with file attachments", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const channel = await TestChannel.create(session);
    const post = await channel.createPost(session, "Post for comments");

    // Upload and attach the file to a public document so the bot can access it through
    // the attachment authorizer.
    const file = await TestFile.create(session);
    const document = await TestDocument.create(session, {
        title: "Doc with file",
        access: "Public",
    });
    await document.attachFile(session, file);

    const response = await server.POST(`/posts/${post.id}/messages`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            content: {
                elements: [
                    {type: "Paragraph", elements: [{type: "Text", text: "Comment with file"}]},
                ],
            },
            files: [{element: {type: "File", file: {id: file.id}}}],
        },
    });

    expect(response).toMatchObject({
        status: 200,
        body: {
            message: expect.objectContaining({
                payload: expect.objectContaining({
                    type: "Content",
                    files: [
                        expect.objectContaining({
                            rowIndex: 0,
                            width: 1,
                            element: {
                                type: "File",
                                file: {
                                    id: file.id,
                                    contentType: expect.any(String),
                                    contentLength: expect.any(Number),
                                },
                            },
                        }),
                    ],
                }),
            }),
        },
    });
});

test("post comment with no files returns empty files array", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const channel = await TestChannel.create(session);
    const post = await channel.createPost(session, "Post for comments");

    const response = await server.POST(`/posts/${post.id}/messages`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            content: {
                elements: [{type: "Paragraph", elements: [{type: "Text", text: "No files here"}]}],
            },
        },
    });

    expect(response).toMatchObject({
        status: 200,
        body: {
            message: expect.objectContaining({
                payload: expect.objectContaining({
                    type: "Content",
                    files: [],
                }),
            }),
        },
    });
});

test("post comment with preview entity returns Preview in files", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const channel = await TestChannel.create(session);
    const post = await channel.createPost(session, "Post for comments");

    const documentId = generateId<DocumentId>();

    const response = await server.POST(`/posts/${post.id}/messages`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            content: {
                elements: [
                    {type: "Paragraph", elements: [{type: "Text", text: "Comment with preview"}]},
                ],
            },
            files: [{element: {type: "Preview", reference: {type: "Document", id: documentId}}}],
        },
    });

    expect(response).toMatchObject({
        status: 200,
        body: {
            message: expect.objectContaining({
                payload: expect.objectContaining({
                    type: "Content",
                    files: [
                        expect.objectContaining({
                            rowIndex: 0,
                            width: 1,
                            element: {
                                type: "Preview",
                                reference: {
                                    type: "Document",
                                    id: documentId,
                                    title: "Unknown document",
                                },
                            },
                        }),
                    ],
                }),
            }),
        },
    });
});

test("post comment with files and previews returns both", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const channel = await TestChannel.create(session);
    const post = await channel.createPost(session, "Post for comments");
    const file = await TestFile.create(session);
    const fileDoc = await TestDocument.create(session, {
        title: "Doc with file",
        access: "Public",
    });
    await fileDoc.attachFile(session, file);

    const documentId = generateId<DocumentId>();

    const response = await server.POST(`/posts/${post.id}/messages`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            content: {
                elements: [
                    {type: "Paragraph", elements: [{type: "Text", text: "Comment with both"}]},
                ],
            },
            files: [
                {element: {type: "File", file: {id: file.id}}},
                {
                    element: {type: "Preview", reference: {type: "Document", id: documentId}},
                },
            ],
        },
    });

    expect(response).toMatchObject({
        status: 200,
        body: {
            message: expect.objectContaining({
                payload: expect.objectContaining({
                    type: "Content",
                    files: [
                        expect.objectContaining({
                            rowIndex: 0,
                            width: 0.38,
                            element: {
                                type: "File",
                                file: {
                                    id: file.id,
                                    contentType: expect.any(String),
                                    contentLength: expect.any(Number),
                                },
                            },
                        }),
                        expect.objectContaining({
                            rowIndex: 0,
                            width: 0.62,
                            element: {
                                type: "Preview",
                                reference: {
                                    type: "Document",
                                    id: documentId,
                                    title: "Unknown document",
                                },
                            },
                        }),
                    ],
                }),
            }),
        },
    });
});

test("post comment with invalid file object returns 400", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});

    const bot = await TestBot.createAndInstantiate(session);
    const apiKey = await bot.createApiKey(session);

    const channel = await TestChannel.create(session);
    const post = await channel.createPost(session, "Post for comments");

    const response = await server.POST(`/posts/${post.id}/messages`, {
        headers: {authorization: `bearer ${apiKey}`},
        body: {
            content: {
                elements: [{type: "Paragraph", elements: [{type: "Text", text: "Bad file"}]}],
            },
            files: [{element: {type: "File", file: {id: "not-a-valid-id"}}}],
        },
    });

    expect(response).toMatchObject({status: 400});
});
