import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getChannelPostContents} from "~/server/forum/data/get_channel_posts.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";

const context = createTestContext();

test("can get channel post contents with cursor pagination", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const channel = await TestChannel.create(session1, {name: "Test Channel"});
    const post1 = await channel.createPost(session1, "First post content.", {
        overrideCreatedTime: new Date("2025-01-01T00:00:00.001Z"),
    });
    const post2 = await channel.createPost(session2, "Second post content.", {
        overrideCreatedTime: new Date("2025-01-01T00:00:00.002Z"),
    });
    const post3 = await channel.createPost(session3, "Third post content.", {
        overrideCreatedTime: new Date("2025-01-01T00:00:00.003Z"),
    });

    const firstResult = await getChannelPostContents(session1.action(), {
        channelId: channel.id,
        limit: 2,
        beforeCreatedTime: null,
    });
    const secondResult = await getChannelPostContents(session1.action(), {
        channelId: channel.id,
        limit: 2,
        beforeCreatedTime: post2.createdTime,
    });

    expect([firstResult, secondResult]).toEqual([
        {
            spaceId: space.id,
            channelName: "Test Channel",
            posts: [
                {
                    postId: post3.id,
                    authorId: session3.account.id,
                    createdTime: post3.createdTime,
                    createdTimeZone: defaultTimeZone,
                },
                {
                    postId: post2.id,
                    authorId: session2.account.id,
                    createdTime: post2.createdTime,
                    createdTimeZone: defaultTimeZone,
                },
            ],
            hasNextPage: true,
        },
        {
            spaceId: space.id,
            channelName: "Test Channel",
            posts: [
                {
                    postId: post1.id,
                    authorId: session1.account.id,
                    createdTime: post1.createdTime,
                    createdTimeZone: defaultTimeZone,
                },
            ],
            hasNextPage: false,
        },
    ]);
});

test("requires view access to get channel post contents", async () => {
    const space = await TestSpace.create(context);
    const [ownerSession, viewerSession, blockedSession] = await space.createSessions(3);

    const channel = await TestChannel.create(ownerSession, {
        name: "Private Channel",
        access: "Private",
    });
    const post = await channel.createPost(ownerSession);
    await channel.access.grant(ownerSession, viewerSession, "View");

    const allowedResult = await getChannelPostContents(viewerSession.action(), {
        channelId: channel.id,
        limit: 10,
        beforeCreatedTime: null,
    });
    const blockedResult = getChannelPostContents(blockedSession.action(), {
        channelId: channel.id,
        limit: 10,
        beforeCreatedTime: null,
    });

    expect(allowedResult).toEqual({
        spaceId: space.id,
        channelName: "Private Channel",
        posts: [
            {
                postId: post.id,
                authorId: ownerSession.account.id,
                createdTime: post.createdTime,
                createdTimeZone: defaultTimeZone,
            },
        ],
        hasNextPage: false,
    });
    await expect(blockedResult).rejects.toThrow("`View` access level");
});
