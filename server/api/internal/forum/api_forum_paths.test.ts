import {apiForumPaths} from "~/server/api/internal/forum/api_forum_paths.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {
    testMessagingApiImplementation,
    testMessagingApiImplementationSearchInjection,
} from "~/server/api/internal/test_helpers/test_messaging_api_implementation.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {forumInjection} from "~/server/forum/data/forum_injection.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {generateId} from "~/shared/id/id.js";
import {ChannelId, PostId} from "~/shared/id/types/id_types.js";

const context = createTestContext({
    forumInjection,
    searchInjection: testMessagingApiImplementationSearchInjection,
});

const server = createTestApiServer(context, apiForumPaths);

testMessagingApiImplementation(context, server, {
    generateMissingRoomPath: () => `/posts/${generateId<PostId>()}`,
    createPrivateRoom: async session => {
        const channel = await TestChannel.create(session, {access: "Private"});
        const post = await channel.createPost(session);
        return {roomPath: `/posts/${post.id}`, room: post, initialMessageCount: 0};
    },
});

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

test("can’t read channel information without access", async () => {
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
                message: expect.stringMatching("You aren’t allowed"),
            }),
        },
    });
});

test("can’t read channel information for non-existent channel", async () => {
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
                message: expect.stringMatching("doesn’t exist"),
            }),
        },
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

test("can’t read post information without access", async () => {
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
                message: expect.stringMatching("You aren’t allowed"),
            }),
        },
    });
});

test("can’t read post information for non-existent post", async () => {
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
                message: expect.stringMatching("doesn’t exist"),
            }),
        },
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
