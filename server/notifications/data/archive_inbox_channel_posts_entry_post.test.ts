import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {archiveInboxChannelPostsEntryPost} from "~/server/notifications/data/archive_inbox_channel_posts_entry_post.js";
import {
    updateInboxEntryAfterExecuteTransactionTestCheckpoint,
    updateInboxEntryBeforeExecuteTransactionTestCheckpoint,
} from "~/server/notifications/data/internal/update_inbox_entry.js";
import {observeInbox} from "~/server/notifications/data/observe_inbox.js";
import {processNotificationEvent} from "~/server/notifications/data/process/process_notification_event.js";
import {expectInboxChannelPostsEntryModel} from "~/server/notifications/data/test_helpers/expect_inbox_channel_posts_entry_model.js";
import {expectInboxPostCommentsEntryModel} from "~/server/notifications/data/test_helpers/expect_inbox_post_comments_entry_model.js";
import {testGetInboxEntries} from "~/server/notifications/data/test_helpers/test_get_inbox_entries.js";
import {unarchiveInboxChannelPostsEntryPost} from "~/server/notifications/data/unarchive_inbox_channel_posts_entry_post.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {MessageContentProsemirrorSchema as schema} from "~/shared/content/message_content_schema.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {cast} from "~/shared/helpers/control/cast.js";
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

test("can archive a single post in a channel posts entry with one post", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await channel.subscribe(session2);

    const post = await channel.createPost(session1, "test1");

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxChannelPostsEntryPost(session2.action(), {
        spaceId: space.id,
        channelId: channel.id,
        bucketGeneration: 0,
        postId: post.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([]);

    expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([
        expectInboxPostCommentsEntryModel({
            isArchived: true,
            session: session2,
            post,
            channel,
            postContentTextSnippet: "test1",
        }),
    ]);
});

test("can archive single post in a channel posts entry with three posts", async () => {
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

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxChannelPostsEntryModel({
            session: session2,
            channel,
            bucketGeneration: 0,
            posts: [post2, post3],
            latestPost: {post: post3, contentTextSnippet: "test3"},
        }),
    ]);
});

test("can archive two posts in a channel posts entry with three posts", async () => {
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

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxChannelPostsEntryModel({
            session: session2,
            channel,
            bucketGeneration: 0,
            latestPost: {post: post2, contentTextSnippet: "test2"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([
        expectInboxPostCommentsEntryModel({
            isArchived: true,
            session: session2,
            post: post3,
            postContentTextSnippet: "test3",
        }),
        expectInboxPostCommentsEntryModel({
            isArchived: true,
            session: session2,
            post: post1,
            postContentTextSnippet: "test1",
        }),
    ]);
});

test("can archive three posts in a channel posts entry with three posts", async () => {
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

    await archiveInboxChannelPostsEntryPost(session2.action(), {
        spaceId: space.id,
        channelId: channel.id,
        bucketGeneration: 0,
        postId: post2.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([]);

    expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([
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
        expectInboxPostCommentsEntryModel({
            isArchived: true,
            session: session2,
            post: post1,
            postContentTextSnippet: "test1",
        }),
    ]);
});

test("archiving single post is idempotent when all posts are unarchived", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await channel.subscribe(session2);

    const post1 = await channel.createPost(session1, "test1");
    const post2 = await channel.createPost(session1, "test2");
    const post3 = await channel.createPost(session1, "test3");

    await ProcessContextModule.waitForTestTasks();

    await runAllPromises([
        archiveInboxChannelPostsEntryPost(session2.action(), {
            spaceId: space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            postId: post2.id,
        }),
        archiveInboxChannelPostsEntryPost(session2.action(), {
            spaceId: space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            postId: post2.id,
        }),
        archiveInboxChannelPostsEntryPost(session2.action(), {
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
            posts: [post1, post3],
            latestPost: {post: post3, contentTextSnippet: "test3"},
        }),
    ]);
});

test("archiving single post is idempotent when all but one posts are archived", async () => {
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

    await runAllPromises([
        archiveInboxChannelPostsEntryPost(session2.action(), {
            spaceId: space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            postId: post2.id,
        }),
        archiveInboxChannelPostsEntryPost(session2.action(), {
            spaceId: space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            postId: post2.id,
        }),
        archiveInboxChannelPostsEntryPost(session2.action(), {
            spaceId: space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            postId: post2.id,
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([
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
        expectInboxPostCommentsEntryModel({
            isArchived: true,
            session: session2,
            post: post1,
            postContentTextSnippet: "test1",
        }),
    ]);
});

test("can\u2019t archive individual post without access to space", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1);
    await channel.subscribe(session2);

    await channel.createPost(session1, "test1");
    const post2 = await channel.createPost(session1, "test2");
    await channel.createPost(session1, "test3");

    await ProcessContextModule.waitForTestTasks();

    await space.removeAccount(session2.account);

    await expect(
        archiveInboxChannelPostsEntryPost(session2.action(), {
            spaceId: space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            postId: post2.id,
        }),
    ).rejects.toThrow("Account doesn\u2019t have access to space");
});

test("noops when archiving individual post in entry that doesn\u2019t exist", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await archiveInboxChannelPostsEntryPost(session.action(), {
        spaceId: space.id,
        channelId: generateId(),
        bucketGeneration: 0,
        postId: generateId(),
    });

    expect(await testGetInboxEntries(session)).toEqual([]);

    expect(await testGetInboxEntries(session, {filter: "Done"})).toEqual([]);
});

test("can\u2019t archive individual post which doesn\u2019t exist in inbox entry", async () => {
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
        archiveInboxChannelPostsEntryPost(session2.action(), {
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

    expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);
});

// TODO(12/11/2025 #flaky-tests): https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/sg5fz408r6xb5gycbshdxbybt4
// eslint-disable-next-line jest/no-disabled-tests
test.skip("race condition: archiving post commits after post comment creates inbox entry", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const channel = await TestChannel.create(session1);
    await channel.subscribe(session2);

    const post1 = await channel.createPost(session1, "test1");
    const post2 = await channel.createPost(session1, "test2");
    const post3 = await channel.createPost(session1, "test3");

    await ProcessContextModule.waitForTestTasks();

    const pause1Promise = updateInboxEntryBeforeExecuteTransactionTestCheckpoint.pauseForTest(
        session2.account.id,
    );

    const pause2Promise = updateInboxEntryAfterExecuteTransactionTestCheckpoint.pauseForTest(
        session3.account.id,
    );

    const archivePromise = archiveInboxChannelPostsEntryPost(session2.action(), {
        spaceId: space.id,
        channelId: channel.id,
        bucketGeneration: 0,
        postId: post2.id,
    });

    const {unpause: unpause1} = await pause1Promise;

    const comment = await post2.createComment(
        session3,
        schema.node("doc", {}, [
            schema.node("paragraph", {}, [
                schema.text("Hello "),
                schema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "Account",
                        accountId: session2.account.id,
                        isShort: false,
                    }),
                }),
                schema.text("!"),
            ]),
        ]),
    );

    const {unpause: unpause2} = await pause2Promise;
    unpause2();

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxPostCommentsEntryModel({
            loudNotificationCount: 1,
            session: session2,
            post: post2,
            latestComment: {
                comment,
                contentTextSnippet: `Hello ${session2.account.initialName}!`,
                isStickyMention: true,
            },
        }),
        expectInboxChannelPostsEntryModel({
            session: session2,
            channel,
            bucketGeneration: 0,
            posts: [post1, post3],
            latestPost: {post: post3, contentTextSnippet: "test3"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);

    unpause1();
    await archivePromise;
    await ProcessContextModule.waitForTestTasks();

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxPostCommentsEntryModel({
            loudNotificationCount: 1,
            session: session2,
            post: post2,
            latestComment: {
                comment,
                contentTextSnippet: `Hello ${session2.account.initialName}!`,
                isStickyMention: true,
            },
        }),
        expectInboxChannelPostsEntryModel({
            session: session2,
            channel,
            bucketGeneration: 0,
            posts: [post1, post3],
            latestPost: {post: post3, contentTextSnippet: "test3"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);
});

// TODO(12/11/2025 #flaky-tests): https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/sg5fz408r6xb5gycbshdxbybt4
// eslint-disable-next-line jest/no-disabled-tests
test.skip("race condition: archiving post commits after post comment creates inbox entry and we unarchive the post in the channel posts entry", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const channel = await TestChannel.create(session1);
    await channel.subscribe(session2);

    const post1 = await channel.createPost(session1, "test1");
    const post2 = await channel.createPost(session1, "test2");
    const post3 = await channel.createPost(session1, "test3");

    await ProcessContextModule.waitForTestTasks();

    const pause1Promise = updateInboxEntryBeforeExecuteTransactionTestCheckpoint.pauseForTest(
        session2.account.id,
    );

    const pause2Promise = updateInboxEntryAfterExecuteTransactionTestCheckpoint.pauseForTest(
        session3.account.id,
    );

    const archivePromise = archiveInboxChannelPostsEntryPost(session2.action(), {
        spaceId: space.id,
        channelId: channel.id,
        bucketGeneration: 0,
        postId: post2.id,
    });

    const {unpause: unpause1, stopPausing: stopPausing1} = await pause1Promise;
    stopPausing1();

    const comment = await post2.createComment(
        session3,
        schema.node("doc", {}, [
            schema.node("paragraph", {}, [
                schema.text("Hello "),
                schema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "Account",
                        accountId: session2.account.id,
                        isShort: false,
                    }),
                }),
                schema.text("!"),
            ]),
        ]),
    );

    const {unpause: unpause2} = await pause2Promise;
    unpause2();

    await unarchiveInboxChannelPostsEntryPost(session2.action(), {
        spaceId: space.id,
        channelId: channel.id,
        bucketGeneration: 0,
        postId: post2.id,
    });

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxPostCommentsEntryModel({
            loudNotificationCount: 1,
            session: session2,
            post: post2,
            latestComment: {
                comment,
                contentTextSnippet: `Hello ${session2.account.initialName}!`,
                isStickyMention: true,
            },
        }),
        expectInboxChannelPostsEntryModel({
            session: session2,
            channel,
            bucketGeneration: 0,
            posts: [post1, post2, post3],
            latestPost: {post: post3, contentTextSnippet: "test3"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);

    unpause1();
    await archivePromise;
    await ProcessContextModule.waitForTestTasks();

    expect(await testGetInboxEntries(session2)).toEqual([
        expectInboxPostCommentsEntryModel({
            loudNotificationCount: 1,
            session: session2,
            post: post2,
            latestComment: {
                comment,
                contentTextSnippet: `Hello ${session2.account.initialName}!`,
                isStickyMention: true,
            },
        }),
        expectInboxChannelPostsEntryModel({
            session: session2,
            channel,
            bucketGeneration: 0,
            posts: [post1, post3],
            latestPost: {post: post3, contentTextSnippet: "test3"},
        }),
    ]);

    expect(await testGetInboxEntries(session2, {filter: "Done"})).toEqual([]);
});
