import {TestApnsContextModule} from "~/server/apns/apns_context_module.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {archiveInboxChannelPostsEntryPost} from "~/server/notifications/data/archive_inbox_channel_posts_entry_post.js";
import {archiveInboxEntry} from "~/server/notifications/data/archive_inbox_entry.js";
import {observeInbox} from "~/server/notifications/data/observe_inbox.js";
import {processNotificationEvent} from "~/server/notifications/data/process/process_notification_event.js";
import {expectInboxChannelPostsEntryModel} from "~/server/notifications/data/test_helpers/expect_inbox_channel_posts_entry_model.js";
import {testGetInboxEntries} from "~/server/notifications/data/test_helpers/test_get_inbox_entries.js";
import {unarchiveInboxChannelPostsEntryPost} from "~/server/notifications/data/unarchive_inbox_channel_posts_entry_post.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {generateId} from "~/shared/id/id.js";

const context = createTestContext({
    processJob: async (context, job, jobStartTime, span) => {
        if (job.type === "NotificationEvent") {
            await processNotificationEvent(context, job.event, span);
        } else {
            // Noop for other jobs...
        }
    },
});

test("can unarchive post in a channel posts entry with one post", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await channel.subscribe(session2);

    const post = await channel.createPost(session1, "test1");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxEntry(session2.action().clone({apns: new TestApnsContextModule()}), {
        spaceId: space.id,
        key: {
            type: "ChannelPosts",
            channelId: channel.id,
            bucketGeneration: 0,
        },
    });

    await unarchiveInboxChannelPostsEntryPost(session2.action(), {
        spaceId: space.id,
        channelId: channel.id,
        bucketGeneration: 0,
        postId: post.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxChannelPostsEntryModel({
            session: session2,
            channel,
            bucketGeneration: 0,
            latestPost: {post, contentTextSnippet: "test1"},
        }),
    ]);
});

test("can unarchive post in a channel posts entry with three archived posts", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await channel.subscribe(session2);

    const post1 = await channel.createPost(session1, "test1");
    const post2 = await channel.createPost(session1, "test2");
    const post3 = await channel.createPost(session1, "test3");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxEntry(session2.action().clone({apns: new TestApnsContextModule()}), {
        spaceId: space.id,
        key: {
            type: "ChannelPosts",
            channelId: channel.id,
            bucketGeneration: 0,
        },
    });

    await unarchiveInboxChannelPostsEntryPost(session2.action(), {
        spaceId: space.id,
        channelId: channel.id,
        bucketGeneration: 0,
        postId: post2.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxChannelPostsEntryModel({
            session: session2,
            channel,
            bucketGeneration: 0,
            posts: [[post1, {isArchived: true}], post2, [post3, {isArchived: true}]],
            latestPost: {post: post3, contentTextSnippet: "test3"},
        }),
    ]);
});

test("can unarchive post in a channel posts entry with one unarchived post and two archived posts", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await channel.subscribe(session2);

    const post1 = await channel.createPost(session1, "test1");
    const post2 = await channel.createPost(session1, "test2");
    const post3 = await channel.createPost(session1, "test3");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxEntry(session2.action().clone({apns: new TestApnsContextModule()}), {
        spaceId: space.id,
        key: {
            type: "ChannelPosts",
            channelId: channel.id,
            bucketGeneration: 0,
        },
    });

    await unarchiveInboxChannelPostsEntryPost(session2.action(), {
        spaceId: space.id,
        channelId: channel.id,
        bucketGeneration: 0,
        postId: post2.id,
    });

    await unarchiveInboxChannelPostsEntryPost(session2.action(), {
        spaceId: space.id,
        channelId: channel.id,
        bucketGeneration: 0,
        postId: post3.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxChannelPostsEntryModel({
            session: session2,
            channel,
            bucketGeneration: 0,
            posts: [[post1, {isArchived: true}], post2, post3],
            latestPost: {post: post3, contentTextSnippet: "test3"},
        }),
    ]);
});

test("can unarchive post in a channel posts entry with one unarchived post and two archived posts (state from archiving single posts)", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await channel.subscribe(session2);

    const post1 = await channel.createPost(session1, "test1");
    const post2 = await channel.createPost(session1, "test2");
    const post3 = await channel.createPost(session1, "test3");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxChannelPostsEntryPost(session2.action(), {
        spaceId: space.id,
        channelId: channel.id,
        bucketGeneration: 0,
        postId: post1.id,
    });

    await archiveInboxChannelPostsEntryPost(session2.action(), {
        spaceId: space.id,
        channelId: channel.id,
        bucketGeneration: 0,
        postId: post3.id,
    });

    await unarchiveInboxChannelPostsEntryPost(session2.action(), {
        spaceId: space.id,
        channelId: channel.id,
        bucketGeneration: 0,
        postId: post3.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxChannelPostsEntryModel({
            session: session2,
            channel,
            bucketGeneration: 0,
            posts: [[post1, {isArchived: true}], post2, post3],
            latestPost: {post: post3, contentTextSnippet: "test3"},
        }),
    ]);
});

test("can unarchive post in a channel posts entry with two unarchived posts and one archived post", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await channel.subscribe(session2);

    const post1 = await channel.createPost(session1, "test1");
    const post2 = await channel.createPost(session1, "test2");
    const post3 = await channel.createPost(session1, "test3");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxEntry(session2.action().clone({apns: new TestApnsContextModule()}), {
        spaceId: space.id,
        key: {
            type: "ChannelPosts",
            channelId: channel.id,
            bucketGeneration: 0,
        },
    });

    await unarchiveInboxChannelPostsEntryPost(session2.action(), {
        spaceId: space.id,
        channelId: channel.id,
        bucketGeneration: 0,
        postId: post2.id,
    });

    await unarchiveInboxChannelPostsEntryPost(session2.action(), {
        spaceId: space.id,
        channelId: channel.id,
        bucketGeneration: 0,
        postId: post3.id,
    });

    await unarchiveInboxChannelPostsEntryPost(session2.action(), {
        spaceId: space.id,
        channelId: channel.id,
        bucketGeneration: 0,
        postId: post1.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxChannelPostsEntryModel({
            session: session2,
            channel,
            bucketGeneration: 0,
            posts: [post1, post2, post3],
            latestPost: {post: post3, contentTextSnippet: "test3"},
        }),
    ]);
});

test("unarchiving single post is idempotent when all posts are archived", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await channel.subscribe(session2);

    const post1 = await channel.createPost(session1, "test1");
    const post2 = await channel.createPost(session1, "test2");
    const post3 = await channel.createPost(session1, "test3");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxEntry(session2.action().clone({apns: new TestApnsContextModule()}), {
        spaceId: space.id,
        key: {
            type: "ChannelPosts",
            channelId: channel.id,
            bucketGeneration: 0,
        },
    });

    await runAllPromises([
        unarchiveInboxChannelPostsEntryPost(session2.action(), {
            spaceId: space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            postId: post2.id,
        }),
        unarchiveInboxChannelPostsEntryPost(session2.action(), {
            spaceId: space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            postId: post2.id,
        }),
        unarchiveInboxChannelPostsEntryPost(session2.action(), {
            spaceId: space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            postId: post2.id,
        }),
    ]);

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxChannelPostsEntryModel({
            session: session2,
            channel,
            bucketGeneration: 0,
            posts: [[post1, {isArchived: true}], post2, [post3, {isArchived: true}]],
            latestPost: {post: post3, contentTextSnippet: "test3"},
        }),
    ]);
});

test("unarchiving single post is idempotent when all but one post are unarchived", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await channel.subscribe(session2);

    const post1 = await channel.createPost(session1, "test1");
    const post2 = await channel.createPost(session1, "test2");
    const post3 = await channel.createPost(session1, "test3");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxEntry(session2.action().clone({apns: new TestApnsContextModule()}), {
        spaceId: space.id,
        key: {
            type: "ChannelPosts",
            channelId: channel.id,
            bucketGeneration: 0,
        },
    });

    await unarchiveInboxChannelPostsEntryPost(session2.action(), {
        spaceId: space.id,
        channelId: channel.id,
        bucketGeneration: 0,
        postId: post1.id,
    });

    await unarchiveInboxChannelPostsEntryPost(session2.action(), {
        spaceId: space.id,
        channelId: channel.id,
        bucketGeneration: 0,
        postId: post3.id,
    });

    await runAllPromises([
        unarchiveInboxChannelPostsEntryPost(session2.action(), {
            spaceId: space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            postId: post2.id,
        }),
        unarchiveInboxChannelPostsEntryPost(session2.action(), {
            spaceId: space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            postId: post2.id,
        }),
        unarchiveInboxChannelPostsEntryPost(session2.action(), {
            spaceId: space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            postId: post2.id,
        }),
    ]);

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxChannelPostsEntryModel({
            session: session2,
            channel,
            bucketGeneration: 0,
            posts: [post1, post2, post3],
            latestPost: {post: post3, contentTextSnippet: "test3"},
        }),
    ]);
});

test("can’t unarchive individual post without access to space", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await channel.subscribe(session2);

    await channel.createPost(session1, "test1");
    const post2 = await channel.createPost(session1, "test2");
    await channel.createPost(session1, "test3");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxEntry(session2.action().clone({apns: new TestApnsContextModule()}), {
        spaceId: space.id,
        key: {
            type: "ChannelPosts",
            channelId: channel.id,
            bucketGeneration: 0,
        },
    });

    await space.removeAccount(session2.account);

    await expect(
        unarchiveInboxChannelPostsEntryPost(session2.action(), {
            spaceId: space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            postId: post2.id,
        }),
    ).rejects.toThrow("Account doesn’t have access to space");
});

test("can’t unarchive individual post in entry that doesn’t exist", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(
        unarchiveInboxChannelPostsEntryPost(session.action(), {
            spaceId: space.id,
            channelId: generateId(),
            bucketGeneration: 0,
            postId: generateId(),
        }),
    ).rejects.toThrow("Inbox entry not found");
});

test("can’t unarchive individual post which doesn’t exist in inbox entry", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await channel.subscribe(session2);

    await channel.createPost(session1, "test1");
    await channel.createPost(session1, "test2");
    await channel.createPost(session1, "test3");

    await ProcessContextModule.waitForTestTasks();

    await observeInbox(session2.action(), {spaceId: space.id});

    const post4 = await channel.createPost(session1, "test4");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxEntry(session2.action().clone({apns: new TestApnsContextModule()}), {
        spaceId: space.id,
        key: {
            type: "ChannelPosts",
            channelId: channel.id,
            bucketGeneration: 0,
        },
    });

    await expect(
        unarchiveInboxChannelPostsEntryPost(session2.action(), {
            spaceId: space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            postId: post4.id,
        }),
    ).rejects.toThrow("Post not found in channel posts inbox entry");
});
