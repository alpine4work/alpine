import {TestApnsContextModule} from "~/server/context/apns_context_module_base.js";
import {TestWebPushContextModule} from "~/server/context/web_push_context_module.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {archiveInboxChannelPostsEntryPost} from "~/server/notifications/data/archive_inbox_channel_posts_entry_post.js";
import {archiveInboxEntry} from "~/server/notifications/data/archive_inbox_entry.js";
import {notificationsInjection} from "~/server/notifications/data/notifications_injection.js";
import {observeInbox} from "~/server/notifications/data/observe_inbox.js";
import {processNotificationEvent} from "~/server/notifications/data/process/process_notification_event.js";
import {expectInboxChannelPostsEntryModel} from "~/server/notifications/data/test_helpers/expect_inbox_channel_posts_entry_model.js";
import {expectInboxPostCommentsEntryModel} from "~/server/notifications/data/test_helpers/expect_inbox_post_comments_entry_model.js";
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
    notificationsInjection,
});

test("can\u2019t unarchive post in a fully archived channel posts entry with one post", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await channel.subscribe(session2);

    const post = await channel.createPost(session1, "test1");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxEntry(
        session2
            .action()
            .clone({apns: new TestApnsContextModule(), webPush: new TestWebPushContextModule()}),
        {
            spaceId: space.id,
            key: {
                type: "ChannelPosts",
                channelId: channel.id,
                bucketGeneration: 0,
            },
        },
    );

    await unarchiveInboxChannelPostsEntryPost(session2.action(), {
        spaceId: space.id,
        channelId: channel.id,
        bucketGeneration: 0,
        postId: post.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxChannelPostsEntryModel({
            isArchived: true,
            session: session2,
            channel,
            bucketGeneration: 0,
            latestPost: {post, contentTextSnippet: "test1"},
        }),
    ]);
});

test("can\u2019t unarchive post in a deleted channel posts entry with one post", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await channel.subscribe(session2);

    const post = await channel.createPost(session1, "test1");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxChannelPostsEntryPost(
        session2
            .action()
            .clone({apns: new TestApnsContextModule(), webPush: new TestWebPushContextModule()}),
        {
            spaceId: space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            postId: post.id,
        },
    );

    await unarchiveInboxChannelPostsEntryPost(session2.action(), {
        spaceId: space.id,
        channelId: channel.id,
        bucketGeneration: 0,
        postId: post.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxPostCommentsEntryModel({
            isArchived: true,
            session: session2,
            post,
            postContentTextSnippet: "test1",
        }),
    ]);
});

test("can unarchive post in a channel posts entry with three posts", async () => {
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
        postId: post2.id,
    });

    await archiveInboxChannelPostsEntryPost(session2.action(), {
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
            latestPost: {post: post1, contentTextSnippet: "test1"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxPostCommentsEntryModel({
            isArchived: true,
            session: session2,
            post: post3,
            postContentTextSnippet: "test3",
        }),
        expectInboxPostCommentsEntryModel({
            isArchived: true,
            session: session2,
            post: post2,
            postContentTextSnippet: "test2",
        }),
    ]);

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
            posts: [post1, post2],
            latestPost: {post: post2, contentTextSnippet: "test2"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxPostCommentsEntryModel({
            isArchived: true,
            session: session2,
            post: post3,
            postContentTextSnippet: "test3",
        }),
        expectInboxPostCommentsEntryModel({
            isArchived: true,
            session: session2,
            post: post2,
            postContentTextSnippet: "test2",
        }),
    ]);
});

test("can archive post again after unarchiving", async () => {
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
        postId: post2.id,
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
        postId: post2.id,
    });

    await archiveInboxChannelPostsEntryPost(session2.action(), {
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
            latestPost: {post: post1, contentTextSnippet: "test1"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxPostCommentsEntryModel({
            isArchived: true,
            session: session2,
            post: post3,
            postContentTextSnippet: "test3",
        }),
        expectInboxPostCommentsEntryModel({
            isArchived: true,
            session: session2,
            post: post2,
            postContentTextSnippet: "test2",
        }),
    ]);
});

test("can\u2019t unarchive post in a fully archived channel posts entry where individual post hasn\u2019t been archived", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await channel.subscribe(session2);

    const post1 = await channel.createPost(session1, "test1");
    const post2 = await channel.createPost(session1, "test2");
    const post3 = await channel.createPost(session1, "test3");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxEntry(
        session2
            .action()
            .clone({apns: new TestApnsContextModule(), webPush: new TestWebPushContextModule()}),
        {
            spaceId: space.id,
            key: {
                type: "ChannelPosts",
                channelId: channel.id,
                bucketGeneration: 0,
            },
        },
    );

    await unarchiveInboxChannelPostsEntryPost(session2.action(), {
        spaceId: space.id,
        channelId: channel.id,
        bucketGeneration: 0,
        postId: post2.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxChannelPostsEntryModel({
            isArchived: true,
            session: session2,
            channel,
            bucketGeneration: 0,
            posts: [post1, post2, post3],
            latestPost: {post: post3, contentTextSnippet: "test3"},
        }),
    ]);
});

test("can\u2019t unarchive post in a fully archived channel posts entry where individual post has been archived", async () => {
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
        postId: post2.id,
    });

    await archiveInboxEntry(
        session2
            .action()
            .clone({apns: new TestApnsContextModule(), webPush: new TestWebPushContextModule()}),
        {
            spaceId: space.id,
            key: {
                type: "ChannelPosts",
                channelId: channel.id,
                bucketGeneration: 0,
            },
        },
    );

    expect(await testGetInboxEntries(session2)).toEqual([]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxChannelPostsEntryModel({
            isArchived: true,
            session: session2,
            channel,
            bucketGeneration: 0,
            posts: [post1, post3],
            latestPost: {post: post3, contentTextSnippet: "test3"},
        }),
        expectInboxPostCommentsEntryModel({
            isArchived: true,
            session: session2,
            post: post2,
            postContentTextSnippet: "test2",
        }),
    ]);

    await unarchiveInboxChannelPostsEntryPost(session2.action(), {
        spaceId: space.id,
        channelId: channel.id,
        bucketGeneration: 0,
        postId: post2.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxChannelPostsEntryModel({
            isArchived: true,
            session: session2,
            channel,
            bucketGeneration: 0,
            posts: [post1, post3],
            latestPost: {post: post3, contentTextSnippet: "test3"},
        }),
        expectInboxPostCommentsEntryModel({
            isArchived: true,
            session: session2,
            post: post2,
            postContentTextSnippet: "test2",
        }),
    ]);
});

test("can unarchive two posts in a channel posts entry", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await channel.subscribe(session2);

    const post1 = await channel.createPost(session1, "test1");
    const post2 = await channel.createPost(session1, "test2");
    const post3 = await channel.createPost(session1, "test3");

    await ProcessContextModule.waitForTestTasks();
    const post4 = await channel.createPost(session1, "test4");

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
        postId: post2.id,
    });

    await archiveInboxChannelPostsEntryPost(session2.action(), {
        spaceId: space.id,
        channelId: channel.id,
        bucketGeneration: 0,
        postId: post4.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxChannelPostsEntryModel({
            session: session2,
            channel,
            bucketGeneration: 0,
            posts: [post3],
            latestPost: {post: post3, contentTextSnippet: "test3"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxPostCommentsEntryModel({
            isArchived: true,
            session: session2,
            post: post4,
            postContentTextSnippet: "test4",
        }),
        expectInboxPostCommentsEntryModel({
            isArchived: true,
            session: session2,
            post: post2,
            postContentTextSnippet: "test2",
        }),
        expectInboxPostCommentsEntryModel({
            isArchived: true,
            session: session2,
            post: post1,
            postContentTextSnippet: "test1",
        }),
    ]);

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
        postId: post4.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxChannelPostsEntryModel({
            session: session2,
            channel,
            bucketGeneration: 0,
            posts: [post2, post3, post4],
            latestPost: {post: post4, contentTextSnippet: "test4"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxPostCommentsEntryModel({
            isArchived: true,
            session: session2,
            post: post4,
            postContentTextSnippet: "test4",
        }),
        expectInboxPostCommentsEntryModel({
            isArchived: true,
            session: session2,
            post: post2,
            postContentTextSnippet: "test2",
        }),
        expectInboxPostCommentsEntryModel({
            isArchived: true,
            session: session2,
            post: post1,
            postContentTextSnippet: "test1",
        }),
    ]);
});

test("unarchiving single post is idempotent", async () => {
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
        postId: post2.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxChannelPostsEntryModel({
            session: session2,
            channel,
            bucketGeneration: 0,
            posts: [post1, post3],
            latestPost: {post: post3, contentTextSnippet: "test3"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxPostCommentsEntryModel({
            isArchived: true,
            session: session2,
            post: post2,
            postContentTextSnippet: "test2",
        }),
    ]);

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

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxPostCommentsEntryModel({
            isArchived: true,
            session: session2,
            post: post2,
            postContentTextSnippet: "test2",
        }),
    ]);
});

test("can\u2019t unarchive individual post without access to space", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await channel.subscribe(session2);

    await channel.createPost(session1, "test1");
    const post2 = await channel.createPost(session1, "test2");
    await channel.createPost(session1, "test3");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxChannelPostsEntryPost(session2.action(), {
        spaceId: space.id,
        channelId: channel.id,
        bucketGeneration: 0,
        postId: post2.id,
    });

    await space.removeAccount(session2.account);

    await expect(
        unarchiveInboxChannelPostsEntryPost(session2.action(), {
            spaceId: space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            postId: post2.id,
        }),
    ).rejects.toThrow("Account doesn\u2019t have access to space");
});

test("noops when unarchiving individual post in entry that doesn\u2019t exist", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await unarchiveInboxChannelPostsEntryPost(session.action(), {
        spaceId: space.id,
        channelId: generateId(),
        bucketGeneration: 0,
        postId: generateId(),
    });

    expect(await testGetInboxEntries(session)).toEqual([]);

    expect(await testGetInboxEntries(session, {filter: "Archive"})).toEqual([]);
});

test("can\u2019t unarchive individual post which doesn\u2019t exist in inbox entry", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await channel.subscribe(session2);

    const post1 = await channel.createPost(session1, "test1");
    const post2 = await channel.createPost(session1, "test2");
    const post3 = await channel.createPost(session1, "test3");

    await ProcessContextModule.waitForTestTasks();

    await observeInbox(session2.action(), {spaceId: space.id});

    const post4 = await channel.createPost(session1, "test4");

    await ProcessContextModule.waitForTestTasks();

    await expect(
        unarchiveInboxChannelPostsEntryPost(session2.action(), {
            spaceId: space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            postId: post4.id,
        }),
    ).rejects.toThrow("Post not found in channel posts inbox entry");

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxChannelPostsEntryModel({
            session: session2,
            channel,
            bucketGeneration: 2,
            latestPost: {post: post4, contentTextSnippet: "test4"},
        }),
        expectInboxChannelPostsEntryModel({
            session: session2,
            channel,
            bucketGeneration: 0,
            posts: [post1, post2, post3],
            latestPost: {post: post3, contentTextSnippet: "test3"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);
});

test("archiving a post, unarchiving, then reacting to the post will archive the post in the channel posts entry", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await channel.subscribe(session2);

    const post1 = await channel.createPost(session1, "test1");
    await ProcessContextModule.waitForTestTasks();

    const post2 = await channel.createPost(session1, "test2");
    await ProcessContextModule.waitForTestTasks();

    await archiveInboxChannelPostsEntryPost(session2.action(), {
        spaceId: space.id,
        channelId: channel.id,
        bucketGeneration: 0,
        postId: post1.id,
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
            posts: [post1, post2],
            latestPost: {post: post2, contentTextSnippet: "test2"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxPostCommentsEntryModel({
            isArchived: true,
            session: session2,
            post: post1,
            postContentTextSnippet: "test1",
        }),
    ]);

    await post1.setReaction(session2);

    await ProcessContextModule.waitForTestTasks();

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxChannelPostsEntryModel({
            session: session2,
            channel,
            bucketGeneration: 0,
            latestPost: {post: post2, contentTextSnippet: "test2"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxPostCommentsEntryModel({
            isArchived: true,
            session: session2,
            post: post1,
            postContentTextSnippet: "test1",
        }),
    ]);
});

test("archiving a post, unarchiving, then commenting on the post will archive the post in the channel posts entry", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await channel.subscribe(session2);

    const post1 = await channel.createPost(session1, "test1");
    await ProcessContextModule.waitForTestTasks();

    const post2 = await channel.createPost(session1, "test2");
    await ProcessContextModule.waitForTestTasks();

    await archiveInboxChannelPostsEntryPost(session2.action(), {
        spaceId: space.id,
        channelId: channel.id,
        bucketGeneration: 0,
        postId: post1.id,
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
            posts: [post1, post2],
            latestPost: {post: post2, contentTextSnippet: "test2"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxPostCommentsEntryModel({
            isArchived: true,
            session: session2,
            post: post1,
            postContentTextSnippet: "test1",
        }),
    ]);

    await post1.createComment(session2, "test3");

    await ProcessContextModule.waitForTestTasks();

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxChannelPostsEntryModel({
            session: session2,
            channel,
            bucketGeneration: 0,
            latestPost: {post: post2, contentTextSnippet: "test2"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
        expectInboxPostCommentsEntryModel({
            isArchived: true,
            session: session2,
            post: post1,
            postContentTextSnippet: "test1",
        }),
    ]);
});
