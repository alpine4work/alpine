import {addMinutes, subMinutes} from "date-fns";
import {TestApnsContextModule} from "~/server/apns/apns_context_module.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createChannel, createPost, createPostComment} from "~/server/forum/data/forum_table.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {
    archiveInboxEntry,
    backfillInboxEntries,
    getInbox,
    getInboxChannelPostsEntryPosts,
    getInboxEntries,
    getInboxEntriesIndexForTest,
    getInboxEntry,
    notificationEventAfterProcessingTestCheckpoint,
    notificationEventBeforeProcessingTestCheckpoint,
    notificationEventProcessingTestCounter,
    observeInbox,
    processNotificationEvent,
    unarchiveInboxEntry,
} from "~/server/notifications/data/notifications_table.js";
import {
    createNotificationsScenario,
    massageInboxEntriesQuery,
} from "~/server/notifications/data/test_helpers/notifications_table_test_helpers.js";
import {
    dangerouslyAddSpaceAccountAsAdmin,
    getSpaceAccountsCacheForTest,
    removeSpaceAccountAsAdmin,
} from "~/server/spaces/spaces_table.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {printContentSingleLineTextSnippet} from "~/shared/content/print_content_single_line_text_snippet.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {
    PostContentProsemirrorSchema,
    assertPostContent,
    emptyPostContent,
    emptyPostContentWithReferences,
} from "~/shared/forum/post_content_schema.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
    createSimpleMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {
    InboxChannelPostsEntryModel,
    InboxModel,
    InboxPostCommentsEntryModel,
} from "~/shared/notifications/inbox_model.js";

let processingType: "Once" | "TwiceSerially" | "ThriceConcurrently" = "Once";

afterEach(() => {
    processingType = "Once";
});

const context = createTestContext({
    processJob: async (context, job, jobStartTime, span) => {
        if (job.type === "NotificationEvent") {
            switch (processingType) {
                case "Once": {
                    await processNotificationEvent(context, job.event, span);
                    break;
                }
                case "TwiceSerially": {
                    await processNotificationEvent(context, job.event, span);
                    await processNotificationEvent(context, job.event, span);
                    break;
                }
                case "ThriceConcurrently": {
                    await runAllPromises([
                        processNotificationEvent(context, job.event, span),
                        processNotificationEvent(context, job.event, span),
                        processNotificationEvent(context, job.event, span),
                    ]);
                    break;
                }
                default:
                    throw exhaustive(processingType);
            }
        } else {
            // Noop for other jobs...
        }
    },
});

async function testGetInboxChannelPostsEntryPosts(
    ...args: Parameters<typeof getInboxChannelPostsEntryPosts>
) {
    const {hasMorePosts, posts} = await getInboxChannelPostsEntryPosts(...args);
    return {hasMorePosts, posts: posts.map(post => post.model)};
}

test("won't create two inbox entries if inbox is observed between serial event processing", async () => {
    processingType = "TwiceSerially";

    const scenario = await createNotificationsScenario(context);

    const _channel = await createChannel(context.action(scenario.session2), {
        spaceId: scenario.space.id,
        name: "Test",
    });

    const channel = new ChannelPreviewModel({
        id: _channel.id,
        spaceId: scenario.space.id,
        createdTime: _channel.createdTime,
        name: "Test",
    });

    await createPost(context.action(scenario.session1), {
        channelId: channel.id,
        content: emptyPostContent,
    });
    await ProcessContextModule.waitForTestTasks();

    const pausePromise1 = notificationEventAfterProcessingTestCheckpoint.pauseForTest(
        scenario.session1.account.id,
    );

    const post2 = await createPost(context.action(scenario.session1), {
        channelId: channel.id,
        content: emptyPostContent,
    });

    const {unpause: unpause1} = await pausePromise1;

    const pausePromise2 = notificationEventBeforeProcessingTestCheckpoint.pauseForTest(
        scenario.session1.account.id,
    );

    unpause1();
    const {unpause: unpause2} = await pausePromise2;

    await observeInbox(context.action(scenario.session3), {spaceId: scenario.space.id});

    unpause2();
    await ProcessContextModule.waitForTestTasks();

    expect(
        await getInboxEntries(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            filter: "New",
            limit: 100,
            afterCursor: null,
        }).then(massageInboxEntriesQuery),
    ).toEqual([
        new InboxChannelPostsEntryModel({
            isArchived: false,
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: await scenario.session1.get(),
                createdTime: post2.createdTime,
                contentTextSnippet: printContentSingleLineTextSnippet(
                    emptyPostContentWithReferences,
                ),
            },
            otherPostAuthor: null,
        }),
    ]);

    expect(
        await getInboxEntries(context.action(scenario.session3), {
            spaceId: scenario.space.id,
            filter: "New",
            limit: 100,
            afterCursor: null,
        }).then(massageInboxEntriesQuery),
    ).toEqual([
        new InboxChannelPostsEntryModel({
            isArchived: false,
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: await scenario.session1.get(),
                createdTime: post2.createdTime,
                contentTextSnippet: printContentSingleLineTextSnippet(
                    emptyPostContentWithReferences,
                ),
            },
            otherPostAuthor: null,
        }),
    ]);
});

// Exercise idempotency by running the test suite again with jobs
// processed twice.
for (const [currentProcessingType, processingMultiple] of [
    ["Once", 1],
    ["TwiceSerially", 2],
    ["ThriceConcurrently", 3],
] as const) {
    describe(`processing: ${currentProcessingType}`, () => {
        beforeEach(() => {
            processingType = currentProcessingType;
        });

        test("commenting creates an inbox entry for all subscribers", async () => {
            const scenario = await createNotificationsScenario(context);

            const {getCount: getCount1} = notificationEventProcessingTestCounter.recordForTest(
                scenario.session1.account.id,
            );
            const {getCount: getCount2} = notificationEventProcessingTestCounter.recordForTest(
                scenario.session2.account.id,
            );
            const {getCount: getCount3} = notificationEventProcessingTestCounter.recordForTest(
                scenario.session3.account.id,
            );

            const _channel = await createChannel(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            const comment1 = await createPostComment(context.action(scenario.session2), {
                postId: post.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment1"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            const comment2 = await createPostComment(context.action(scenario.session3), {
                postId: post.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment2"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment2"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session2.get(),
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment2"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            const comment3 = await createPostComment(context.action(scenario.session1), {
                postId: post.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment3"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session3.get(),
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            // Make sure multiple processing is working.
            expect(getCount1()).toEqual(2 * processingMultiple);
            expect(getCount2()).toEqual(1 * processingMultiple);
            expect(getCount3()).toEqual(1 * processingMultiple);
        });

        test("can get individual inbox entries", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            await expect(
                getInboxEntry(context.action(scenario.otherSession), {
                    spaceId: scenario.space.id,
                    key: {type: "ChannelPosts", channelId: channel.id, bucketGeneration: 0},
                }),
            ).rejects.toThrow(PermissionDeniedError);

            await expect(
                getInboxEntry(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    key: {type: "ChannelPosts", channelId: channel.id, bucketGeneration: 0},
                }),
            ).rejects.toThrow(NotFoundError);

            await expect(
                getInboxEntry(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    key: {type: "ChannelPosts", channelId: channel.id, bucketGeneration: 0},
                }),
            ).resolves.toEqual({
                key: expect.any(String),
                version: expect.any(Number),
                model: new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            });

            await expect(
                getInboxEntry(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    key: {type: "ChannelPosts", channelId: channel.id, bucketGeneration: 0},
                }),
            ).resolves.toEqual({
                key: expect.any(String),
                version: expect.any(Number),
                model: new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            });
        });

        test("mentioning someone in a post a creates a loud notification for them whether or not they are a subscriber", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            const comment1 = await createPostComment(context.action(scenario.session2), {
                postId: post.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount3MessageContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount3MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session3.account.id, await scenario.session3.get()],
                                ]),
                            },
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount3MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session3.account.id, await scenario.session3.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            const comment2 = await createPostComment(context.action(scenario.session2), {
                postId: post.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount1MessageContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount1MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session1.account.id, await scenario.session1.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount3MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session3.account.id, await scenario.session3.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            const comment3 = await createPostComment(context.action(scenario.session3), {
                postId: post.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount1MessageContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 2,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount1MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session1.account.id, await scenario.session1.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: await scenario.session2.get(),
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount1MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session1.account.id, await scenario.session1.get()],
                                ]),
                            },
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);
        });

        test("mentioning yourself does not create a loud notification for yourself", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            const comment1 = await createPostComment(context.action(scenario.session2), {
                postId: post.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount2MessageContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            const comment2 = await createPostComment(context.action(scenario.session1), {
                postId: post.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment2"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment2"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            const comment3 = await createPostComment(context.action(scenario.session2), {
                postId: post.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount2MessageContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session2.get(),
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);
        });

        test("accounts have separate inboxes for each space", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const _otherChannel = await createChannel(context.action(scenario.otherSession), {
                spaceId: scenario.otherSpace.id,
                name: "Test",
            });

            const otherChannel = new ChannelPreviewModel({
                id: _otherChannel.id,
                spaceId: scenario.otherSpace.id,
                createdTime: _otherChannel.createdTime,
                name: "Test",
            });

            const otherPost = await createPost(context.action(scenario.otherSession), {
                channelId: otherChannel.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.sharedSession), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.sharedSession.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.sharedSession), {
                    spaceId: scenario.otherSpace.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.otherSpace.id,
                    accountId: scenario.sharedSession.account.id,
                    loudNotificationCount: 0,
                    channel: otherChannel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.otherSession.get(),
                        createdTime: otherPost.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            const comment1 = await createPostComment(context.action(scenario.session2), {
                postId: post.id,
                parentCommentIndex: null,
                content: scenario.mentionSharedAccountMessageContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.sharedSession), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.sharedSession.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionSharedAccountMessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [
                                        scenario.sharedSession.account.id,
                                        await scenario.sharedSession.get(),
                                    ],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.sharedSession.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.sharedSession), {
                    spaceId: scenario.otherSpace.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.otherSpace.id,
                    accountId: scenario.sharedSession.account.id,
                    loudNotificationCount: 0,
                    channel: otherChannel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.otherSession.get(),
                        createdTime: otherPost.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            const comment2 = await createPostComment(context.action(scenario.otherSession), {
                postId: otherPost.id,
                parentCommentIndex: null,
                content: scenario.mentionSharedAccountMessageContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.sharedSession), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.sharedSession.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionSharedAccountMessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [
                                        scenario.sharedSession.account.id,
                                        await scenario.sharedSession.get(),
                                    ],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.sharedSession.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.sharedSession), {
                    spaceId: scenario.otherSpace.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.otherSpace.id,
                    accountId: scenario.sharedSession.account.id,
                    postId: otherPost.id,
                    postAuthor: await scenario.otherSession.get(),
                    channel: otherChannel,
                    loudNotificationCount: 1,
                    postCreatedTime: otherPost.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.otherSession.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionSharedAccountMessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [
                                        scenario.sharedSession.account.id,
                                        await scenario.sharedSession.get(),
                                    ],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.otherSpace.id,
                    accountId: scenario.sharedSession.account.id,
                    loudNotificationCount: 0,
                    channel: otherChannel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.otherSession.get(),
                        createdTime: otherPost.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);
        });

        test("account can not see mention in a different space", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const otherChannel = await createChannel(context.action(scenario.otherSession), {
                spaceId: scenario.otherSpace.id,
                name: "Test",
            });

            const otherPost = await createPost(context.action(scenario.otherSession), {
                channelId: otherChannel.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            await expect(
                getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.otherSpace.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).rejects.toThrow(PermissionDeniedError);

            const comment1 = await createPostComment(context.action(scenario.session2), {
                postId: post.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount3MessageContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount3MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session3.account.id, await scenario.session3.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            await expect(
                getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.otherSpace.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).rejects.toThrow(PermissionDeniedError);

            await createPostComment(context.action(scenario.otherSession), {
                postId: otherPost.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount3MessageContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount3MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session3.account.id, await scenario.session3.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            await expect(
                getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.otherSpace.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).rejects.toThrow(PermissionDeniedError);
        });

        test("comment notification events processed out of order result in the same latest comment", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post = await createPost(context.action(scenario.session2), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            await createPostComment(context.action(scenario.session1), {
                postId: post.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment1"),
            });

            await ProcessContextModule.waitForTestTasks();

            const pause1Promise = notificationEventBeforeProcessingTestCheckpoint.pauseForTest(
                scenario.session1.account.id,
            );
            const pause2Promise = notificationEventAfterProcessingTestCheckpoint.pauseForTest(
                scenario.session3.account.id,
            );

            await createPostComment(context.action(scenario.session1), {
                postId: post.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount2MessageContent,
            });

            const comment3 = await createPostComment(context.action(scenario.session3), {
                postId: post.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment3"),
            });

            const {unpause: unpause1} = await pause1Promise;
            const {unpause: unpause2} = await pause2Promise;
            unpause2();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session2.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session2.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session1.get(),
                }),
            ]);

            unpause1();
            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session2.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session2.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session1.get(),
                }),
            ]);
        });

        test("comment notification events processed out of order result in the same latest comment including implicit archival states", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post = await createPost(context.action(scenario.session2), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            await createPostComment(context.action(scenario.session1), {
                postId: post.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment1"),
            });

            await ProcessContextModule.waitForTestTasks();

            const pause1Promise = notificationEventBeforeProcessingTestCheckpoint.pauseForTest(
                scenario.session1.account.id,
            );
            const pause2Promise = notificationEventAfterProcessingTestCheckpoint.pauseForTest(
                scenario.session2.account.id,
            );

            await createPostComment(context.action(scenario.session1), {
                postId: post.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount2MessageContent,
            });

            const comment3 = await createPostComment(context.action(scenario.session2), {
                postId: post.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment3"),
            });

            const {unpause: unpause1} = await pause1Promise;
            const {unpause: unpause2} = await pause2Promise;
            unpause2();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session2.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            unpause1();
            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session2.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);
        });

        test("loud notifications are always at the top of the inbox", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post1 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const post2 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const post3 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const comment1 = await createPostComment(context.action(scenario.session2), {
                postId: post1.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment1"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const comment2 = await createPostComment(context.action(scenario.session2), {
                postId: post2.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount1MessageContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount1MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session1.account.id, await scenario.session1.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const comment3 = await createPostComment(context.action(scenario.session2), {
                postId: post3.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment3"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount1MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session1.account.id, await scenario.session1.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const comment4 = await createPostComment(context.action(scenario.session2), {
                postId: post1.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment4"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount1MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session1.account.id, await scenario.session1.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment4"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await createPostComment(context.action(scenario.session2), {
                postId: post2.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment5"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount1MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session1.account.id, await scenario.session1.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment4"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const comment6 = await createPostComment(context.action(scenario.session2), {
                postId: post3.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount1MessageContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment6.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount1MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session1.account.id, await scenario.session1.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount1MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session1.account.id, await scenario.session1.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment4"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await createPostComment(context.action(scenario.session2), {
                postId: post2.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment7"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment6.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount1MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session1.account.id, await scenario.session1.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount1MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session1.account.id, await scenario.session1.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment4"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const comment8 = await createPostComment(context.action(scenario.session2), {
                postId: post2.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount1MessageContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 2,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment8.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount1MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session1.account.id, await scenario.session1.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment6.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount1MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session1.account.id, await scenario.session1.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment4"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("can not observe inbox in a space you don't have access to", async () => {
            const scenario = await createNotificationsScenario(context);

            await expect(
                observeInbox(context.action(scenario.session1), {spaceId: scenario.otherSpace.id}),
            ).rejects.toThrow(PermissionDeniedError);
        });

        test("observing an inbox freezes loud notifications in place", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post1 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const post2 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const post3 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const post4 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const comment1 = await createPostComment(context.action(scenario.session2), {
                postId: post1.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment1"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const comment2 = await createPostComment(context.action(scenario.session2), {
                postId: post2.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount1MessageContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount1MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session1.account.id, await scenario.session1.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const comment3 = await createPostComment(context.action(scenario.session2), {
                postId: post3.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment3"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount1MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session1.account.id, await scenario.session1.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await observeInbox(context.action(scenario.session1), {spaceId: scenario.space.id});

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount1MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session1.account.id, await scenario.session1.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const comment4 = await createPostComment(context.action(scenario.session2), {
                postId: post4.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment4"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post4.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post4.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment4"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount1MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session1.account.id, await scenario.session1.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await createPostComment(context.action(scenario.session2), {
                postId: post2.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment5"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post4.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post4.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment4"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount1MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session1.account.id, await scenario.session1.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const comment6 = await createPostComment(context.action(scenario.session2), {
                postId: post3.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment6"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post4.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post4.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment4"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount1MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session1.account.id, await scenario.session1.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment6.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment6"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const comment7 = await createPostComment(context.action(scenario.session2), {
                postId: post3.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount1MessageContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment7.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount1MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session1.account.id, await scenario.session1.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post4.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post4.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment4"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount1MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session1.account.id, await scenario.session1.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("can archive inbox entries", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post1 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const post2 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            await createPostComment(context.action(scenario.session2), {
                postId: post1.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment1"),
            });

            await ProcessContextModule.waitForTestTasks();

            await createPostComment(context.action(scenario.session3), {
                postId: post1.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment2"),
            });

            await ProcessContextModule.waitForTestTasks();

            const comment3 = await createPostComment(context.action(scenario.sharedSession), {
                postId: post1.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment3"),
            });

            await ProcessContextModule.waitForTestTasks();

            const comment4 = await createPostComment(context.action(scenario.session1), {
                postId: post2.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount2MessageContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.sharedSession.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session3.get(),
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.sharedSession.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session3.get(),
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.sharedSession.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session3).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post1.id},
                },
            );

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.sharedSession.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session3.get(),
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.sharedSession.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session3.get(),
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post2.id},
                },
            );

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.sharedSession.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session3.get(),
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.sharedSession.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session3.get(),
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post1.id},
                },
            );

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.sharedSession.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session3.get(),
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);
        });

        test("can unarchive inbox entries", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post1 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const post2 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const post3 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            await createPostComment(context.action(scenario.session2), {
                postId: post1.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment1"),
            });

            await ProcessContextModule.waitForTestTasks();

            await createPostComment(context.action(scenario.session3), {
                postId: post1.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment2"),
            });

            await ProcessContextModule.waitForTestTasks();

            const comment3 = await createPostComment(context.action(scenario.session1), {
                postId: post1.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment3"),
            });

            await ProcessContextModule.waitForTestTasks();

            const comment4 = await createPostComment(context.action(scenario.session1), {
                postId: post2.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount2MessageContent,
            });

            await ProcessContextModule.waitForTestTasks();

            const comment5 = await createPostComment(context.action(scenario.session1), {
                postId: post3.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount2MessageContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment5.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session3.get(),
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session3).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post1.id},
                },
            );

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post2.id},
                },
            );

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post1.id},
                },
            );

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment5.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            await unarchiveInboxEntry(
                context.action(scenario.session3).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post1.id},
                },
            );

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment5.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            await unarchiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post2.id},
                },
            );

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment5.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            await unarchiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post1.id},
                },
            );

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session3.get(),
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment5.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            await unarchiveInboxEntry(
                context.action(scenario.session1).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post1.id},
                },
            );

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session3.get(),
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session3.get(),
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment5.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);
        });

        test("can not archive or unarchive inbox entries in a space you don't have access to", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            await expect(
                archiveInboxEntry(
                    context
                        .action(scenario.otherSession)
                        .clone({apns: new TestApnsContextModule()}),
                    {
                        spaceId: scenario.space.id,
                        key: {type: "PostComments", postId: post.id},
                    },
                ),
            ).rejects.toThrow(PermissionDeniedError);

            await expect(
                unarchiveInboxEntry(
                    context
                        .action(scenario.otherSession)
                        .clone({apns: new TestApnsContextModule()}),
                    {
                        spaceId: scenario.space.id,
                        key: {type: "PostComments", postId: post.id},
                    },
                ),
            ).rejects.toThrow(PermissionDeniedError);
        });

        test("notification on an archived entry revives it", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const comment1 = await createPostComment(context.action(scenario.session2), {
                postId: post.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment1"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session1).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post.id},
                },
            );

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const comment2 = await createPostComment(context.action(scenario.session2), {
                postId: post.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment2"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment2"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("notification on an archived entry revives it clearing old loud notification count", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const comment1 = await createPostComment(context.action(scenario.session2), {
                postId: post.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount1MessageContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount1MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session1.account.id, await scenario.session1.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session1).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post.id},
                },
            );

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const comment2 = await createPostComment(context.action(scenario.session2), {
                postId: post.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment2"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment2"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("notification on an archived entry from own account does not revive it", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const comment1 = await createPostComment(context.action(scenario.session2), {
                postId: post.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment1"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session1).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post.id},
                },
            );

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            await createPostComment(context.action(scenario.session1), {
                postId: post.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment2"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            await unarchiveInboxEntry(
                context.action(scenario.session1).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post.id},
                },
            );

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("can not get inbox in a space you don't have access to", async () => {
            const scenario = await createNotificationsScenario(context);

            await expect(
                getInbox(context.action(scenario.session1), {spaceId: scenario.otherSpace.id}),
            ).rejects.toThrow(PermissionDeniedError);
        });

        test("gets an inbox model even in a fresh space", async () => {
            const scenario = await createNotificationsScenario(context);

            expect(
                (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    entryCount: 0,
                    lastZeroEntryCountTime: null,
                }),
            );
        });

        test("getting an inbox returns the current loud notification count", async () => {
            const scenario = await createNotificationsScenario(context);

            expect(
                (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    entryCount: 0,
                    lastZeroEntryCountTime: null,
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    entryCount: 0,
                    lastZeroEntryCountTime: null,
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    entryCount: 0,
                    lastZeroEntryCountTime: null,
                }),
            );

            const _channel = await createChannel(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post1 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const post2 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const post3 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    entryCount: 0,
                    lastZeroEntryCountTime: null,
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    entryCount: 1,
                    lastZeroEntryCountTime: null,
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    entryCount: 1,
                    lastZeroEntryCountTime: null,
                }),
            );

            await createPostComment(context.action(scenario.session2), {
                postId: post1.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment1"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    entryCount: 1,
                    lastZeroEntryCountTime: null,
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    entryCount: 1,
                    lastZeroEntryCountTime: null,
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    entryCount: 1,
                    lastZeroEntryCountTime: null,
                }),
            );

            await createPostComment(context.action(scenario.session3), {
                postId: post1.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment2"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    entryCount: 1,
                    lastZeroEntryCountTime: null,
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    entryCount: 2,
                    lastZeroEntryCountTime: null,
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    entryCount: 1,
                    lastZeroEntryCountTime: null,
                }),
            );

            await createPostComment(context.action(scenario.session2), {
                postId: post1.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment3"),
            });

            await ProcessContextModule.waitForTestTasks();

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "ChannelPosts", channelId: channel.id, bucketGeneration: 0},
                },
            );

            expect(
                (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    entryCount: 1,
                    lastZeroEntryCountTime: null,
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    entryCount: 0,
                    lastZeroEntryCountTime: expect.any(Date),
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    entryCount: 2,
                    lastZeroEntryCountTime: null,
                }),
            );

            await createPostComment(context.action(scenario.session1), {
                postId: post2.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount2MessageContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    entryCount: 1,
                    lastZeroEntryCountTime: null,
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 1,
                    entryCount: 1,
                    lastZeroEntryCountTime: expect.any(Date),
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    entryCount: 2,
                    lastZeroEntryCountTime: null,
                }),
            );

            await createPostComment(context.action(scenario.session1), {
                postId: post3.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount2MessageContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    entryCount: 1,
                    lastZeroEntryCountTime: null,
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 2,
                    entryCount: 2,
                    lastZeroEntryCountTime: expect.any(Date),
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    entryCount: 2,
                    lastZeroEntryCountTime: null,
                }),
            );

            await archiveInboxEntry(
                context.action(scenario.session3).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post1.id},
                },
            );

            await archiveInboxEntry(
                context.action(scenario.session3).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "ChannelPosts", channelId: channel.id, bucketGeneration: 0},
                },
            );

            expect(
                (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    entryCount: 1,
                    lastZeroEntryCountTime: null,
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 2,
                    entryCount: 2,
                    lastZeroEntryCountTime: expect.any(Date),
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    entryCount: 0,
                    lastZeroEntryCountTime: expect.any(Date),
                }),
            );

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post2.id},
                },
            );

            expect(
                (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    entryCount: 1,
                    lastZeroEntryCountTime: null,
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 1,
                    entryCount: 1,
                    lastZeroEntryCountTime: expect.any(Date),
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    entryCount: 0,
                    lastZeroEntryCountTime: expect.any(Date),
                }),
            );

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post1.id},
                },
            );

            expect(
                (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    entryCount: 1,
                    lastZeroEntryCountTime: null,
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 1,
                    entryCount: 1,
                    lastZeroEntryCountTime: expect.any(Date),
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    entryCount: 0,
                    lastZeroEntryCountTime: expect.any(Date),
                }),
            );

            await unarchiveInboxEntry(
                context.action(scenario.session3).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post1.id},
                },
            );

            expect(
                (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    entryCount: 1,
                    lastZeroEntryCountTime: null,
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 1,
                    entryCount: 1,
                    lastZeroEntryCountTime: expect.any(Date),
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    entryCount: 1,
                    lastZeroEntryCountTime: expect.any(Date),
                }),
            );

            await unarchiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post2.id},
                },
            );

            expect(
                (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    entryCount: 1,
                    lastZeroEntryCountTime: null,
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 1,
                    entryCount: 2,
                    lastZeroEntryCountTime: expect.any(Date),
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    entryCount: 1,
                    lastZeroEntryCountTime: expect.any(Date),
                }),
            );

            await unarchiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post1.id},
                },
            );

            expect(
                (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    entryCount: 1,
                    lastZeroEntryCountTime: null,
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 1,
                    entryCount: 3,
                    lastZeroEntryCountTime: expect.any(Date),
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                new InboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    entryCount: 1,
                    lastZeroEntryCountTime: expect.any(Date),
                }),
            );
        });

        test("start sort key and end sort key work properly in inclusive/exclusive mode", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post1 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const post2 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const post3 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const post4 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const post5 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const post6 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            const comment1 = await createPostComment(context.action(scenario.session2), {
                postId: post1.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment1"),
            });

            await ProcessContextModule.waitForTestTasks();

            const comment2 = await createPostComment(context.action(scenario.session2), {
                postId: post2.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment2"),
            });

            await ProcessContextModule.waitForTestTasks();

            await archiveInboxEntry(
                context.action(scenario.session1).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post1.id},
                },
            );

            const {archiveTime: archiveTime2} = await archiveInboxEntry(
                context.action(scenario.session1).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post2.id},
                },
            );

            await ProcessContextModule.waitForTestTasks();

            const comment3 = await createPostComment(context.action(scenario.session2), {
                postId: post3.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment3"),
            });

            await ProcessContextModule.waitForTestTasks();

            const comment4 = await createPostComment(context.action(scenario.session2), {
                postId: post4.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment4"),
            });

            await ProcessContextModule.waitForTestTasks();

            await observeInbox(context.action(scenario.session1), {spaceId: scenario.space.id});

            await ProcessContextModule.waitForTestTasks();

            const comment5 = await createPostComment(context.action(scenario.session2), {
                postId: post5.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment5"),
            });

            await ProcessContextModule.waitForTestTasks();

            const comment6 = await createPostComment(context.action(scenario.session2), {
                postId: post6.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment6"),
            });

            await ProcessContextModule.waitForTestTasks();

            const InboxEntriesIndex = getInboxEntriesIndexForTest();

            expect(
                await InboxEntriesIndex.realtimeQuery(context.action(scenario.session1), {
                    partitionKey: {
                        spaceId: scenario.space.id,
                        accountId: scenario.session1.account.id,
                    },
                    limit: "All",
                }),
            ).toEqual({
                readTime: expect.any(Date),
                indexName: "InboxEntries",
                partitionKey: expect.any(String),
                startCursorBound: null,
                endCursorBound: null,
                pageInfo: {
                    type: "FromStart",
                    afterCursor: null,
                    hasNextPage: false,
                },
                items: [
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 1,
                        model: new InboxPostCommentsEntryModel({
                            isArchived: false,
                            spaceId: scenario.space.id,
                            accountId: scenario.session1.account.id,
                            channel,
                            postId: post6.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post6.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment6.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: printContentSingleLineTextSnippet({
                                    doc: createSimpleMessageContent("comment6"),
                                    references: emptyContentReferences,
                                }),
                                isStickyMention: false,
                            },
                            otherCommentAuthor: null,
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 1,
                        model: new InboxPostCommentsEntryModel({
                            isArchived: false,
                            spaceId: scenario.space.id,
                            accountId: scenario.session1.account.id,
                            channel,
                            postId: post5.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post5.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment5.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: printContentSingleLineTextSnippet({
                                    doc: createSimpleMessageContent("comment5"),
                                    references: emptyContentReferences,
                                }),
                                isStickyMention: false,
                            },
                            otherCommentAuthor: null,
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 1,
                        model: new InboxPostCommentsEntryModel({
                            isArchived: false,
                            spaceId: scenario.space.id,
                            accountId: scenario.session1.account.id,
                            channel,
                            postId: post4.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post4.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment4.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: printContentSingleLineTextSnippet({
                                    doc: createSimpleMessageContent("comment4"),
                                    references: emptyContentReferences,
                                }),
                                isStickyMention: false,
                            },
                            otherCommentAuthor: null,
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 1,
                        model: new InboxPostCommentsEntryModel({
                            isArchived: false,
                            spaceId: scenario.space.id,
                            accountId: scenario.session1.account.id,
                            channel,
                            postId: post3.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post3.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment3.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: printContentSingleLineTextSnippet({
                                    doc: createSimpleMessageContent("comment3"),
                                    references: emptyContentReferences,
                                }),
                                isStickyMention: false,
                            },
                            otherCommentAuthor: null,
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 2,
                        model: new InboxPostCommentsEntryModel({
                            isArchived: true,
                            spaceId: scenario.space.id,
                            accountId: scenario.session1.account.id,
                            channel,
                            postId: post2.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post2.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment2.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: printContentSingleLineTextSnippet({
                                    doc: createSimpleMessageContent("comment2"),
                                    references: emptyContentReferences,
                                }),
                                isStickyMention: false,
                            },
                            otherCommentAuthor: null,
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 2,
                        model: new InboxPostCommentsEntryModel({
                            isArchived: true,
                            spaceId: scenario.space.id,
                            accountId: scenario.session1.account.id,
                            channel,
                            postId: post1.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post1.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment1.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: printContentSingleLineTextSnippet({
                                    doc: createSimpleMessageContent("comment1"),
                                    references: emptyContentReferences,
                                }),
                                isStickyMention: false,
                            },
                            otherCommentAuthor: null,
                        }),
                    },
                ],
            });

            expect(
                await InboxEntriesIndex.realtimeQuery(context.action(scenario.session1), {
                    partitionKey: {
                        spaceId: scenario.space.id,
                        accountId: scenario.session1.account.id,
                    },
                    startSortKey: {
                        isArchived: false,
                        generation: 0,
                        enteredTime: comment4.createdTime,
                    },
                    limit: "All",
                }),
            ).toEqual({
                readTime: expect.any(Date),
                indexName: "InboxEntries",
                partitionKey: expect.any(String),
                startCursorBound: expect.any(String),
                endCursorBound: null,
                pageInfo: {
                    type: "FromStart",
                    afterCursor: null,
                    hasNextPage: false,
                },
                items: [
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 1,
                        model: new InboxPostCommentsEntryModel({
                            isArchived: false,
                            spaceId: scenario.space.id,
                            accountId: scenario.session1.account.id,
                            channel,
                            postId: post4.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post4.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment4.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: printContentSingleLineTextSnippet({
                                    doc: createSimpleMessageContent("comment4"),
                                    references: emptyContentReferences,
                                }),
                                isStickyMention: false,
                            },
                            otherCommentAuthor: null,
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 1,
                        model: new InboxPostCommentsEntryModel({
                            isArchived: false,
                            spaceId: scenario.space.id,
                            accountId: scenario.session1.account.id,
                            channel,
                            postId: post3.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post3.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment3.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: printContentSingleLineTextSnippet({
                                    doc: createSimpleMessageContent("comment3"),
                                    references: emptyContentReferences,
                                }),
                                isStickyMention: false,
                            },
                            otherCommentAuthor: null,
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 2,
                        model: new InboxPostCommentsEntryModel({
                            isArchived: true,
                            spaceId: scenario.space.id,
                            accountId: scenario.session1.account.id,
                            channel,
                            postId: post2.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post2.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment2.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: printContentSingleLineTextSnippet({
                                    doc: createSimpleMessageContent("comment2"),
                                    references: emptyContentReferences,
                                }),
                                isStickyMention: false,
                            },
                            otherCommentAuthor: null,
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 2,
                        model: new InboxPostCommentsEntryModel({
                            isArchived: true,
                            spaceId: scenario.space.id,
                            accountId: scenario.session1.account.id,
                            channel,
                            postId: post1.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post1.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment1.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: printContentSingleLineTextSnippet({
                                    doc: createSimpleMessageContent("comment1"),
                                    references: emptyContentReferences,
                                }),
                                isStickyMention: false,
                            },
                            otherCommentAuthor: null,
                        }),
                    },
                ],
            });

            expect(
                await InboxEntriesIndex.realtimeQuery(context.action(scenario.session1), {
                    partitionKey: {
                        spaceId: scenario.space.id,
                        accountId: scenario.session1.account.id,
                    },
                    startSortKey: {
                        isArchived: false,
                        generation: 0,
                        enteredTime: comment4.createdTime,
                    },
                    isStartSortKeyExclusive: true,
                    limit: "All",
                }),
            ).toEqual({
                readTime: expect.any(Date),
                indexName: "InboxEntries",
                partitionKey: expect.any(String),
                startCursorBound: expect.any(String),
                endCursorBound: null,
                pageInfo: {
                    type: "FromStart",
                    afterCursor: null,
                    hasNextPage: false,
                },
                items: [
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 1,
                        model: new InboxPostCommentsEntryModel({
                            isArchived: false,
                            spaceId: scenario.space.id,
                            accountId: scenario.session1.account.id,
                            channel,
                            postId: post3.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post3.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment3.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: printContentSingleLineTextSnippet({
                                    doc: createSimpleMessageContent("comment3"),
                                    references: emptyContentReferences,
                                }),
                                isStickyMention: false,
                            },
                            otherCommentAuthor: null,
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 2,
                        model: new InboxPostCommentsEntryModel({
                            isArchived: true,
                            spaceId: scenario.space.id,
                            accountId: scenario.session1.account.id,
                            channel,
                            postId: post2.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post2.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment2.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: printContentSingleLineTextSnippet({
                                    doc: createSimpleMessageContent("comment2"),
                                    references: emptyContentReferences,
                                }),
                                isStickyMention: false,
                            },
                            otherCommentAuthor: null,
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 2,
                        model: new InboxPostCommentsEntryModel({
                            isArchived: true,
                            spaceId: scenario.space.id,
                            accountId: scenario.session1.account.id,
                            channel,
                            postId: post1.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post1.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment1.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: printContentSingleLineTextSnippet({
                                    doc: createSimpleMessageContent("comment1"),
                                    references: emptyContentReferences,
                                }),
                                isStickyMention: false,
                            },
                            otherCommentAuthor: null,
                        }),
                    },
                ],
            });

            expect(
                await InboxEntriesIndex.realtimeQuery(context.action(scenario.session1), {
                    partitionKey: {
                        spaceId: scenario.space.id,
                        accountId: scenario.session1.account.id,
                    },
                    endSortKey: {
                        isArchived: true,
                        generation: 0,
                        enteredTime: archiveTime2,
                    },
                    limit: "All",
                }),
            ).toEqual({
                readTime: expect.any(Date),
                indexName: "InboxEntries",
                partitionKey: expect.any(String),
                startCursorBound: null,
                endCursorBound: expect.any(String),
                pageInfo: {
                    type: "FromStart",
                    afterCursor: null,
                    hasNextPage: false,
                },
                items: [
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 1,
                        model: new InboxPostCommentsEntryModel({
                            isArchived: false,
                            spaceId: scenario.space.id,
                            accountId: scenario.session1.account.id,
                            channel,
                            postId: post6.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post6.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment6.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: printContentSingleLineTextSnippet({
                                    doc: createSimpleMessageContent("comment6"),
                                    references: emptyContentReferences,
                                }),
                                isStickyMention: false,
                            },
                            otherCommentAuthor: null,
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 1,
                        model: new InboxPostCommentsEntryModel({
                            isArchived: false,
                            spaceId: scenario.space.id,
                            accountId: scenario.session1.account.id,
                            channel,
                            postId: post5.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post5.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment5.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: printContentSingleLineTextSnippet({
                                    doc: createSimpleMessageContent("comment5"),
                                    references: emptyContentReferences,
                                }),
                                isStickyMention: false,
                            },
                            otherCommentAuthor: null,
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 1,
                        model: new InboxPostCommentsEntryModel({
                            isArchived: false,
                            spaceId: scenario.space.id,
                            accountId: scenario.session1.account.id,
                            channel,
                            postId: post4.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post4.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment4.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: printContentSingleLineTextSnippet({
                                    doc: createSimpleMessageContent("comment4"),
                                    references: emptyContentReferences,
                                }),
                                isStickyMention: false,
                            },
                            otherCommentAuthor: null,
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 1,
                        model: new InboxPostCommentsEntryModel({
                            isArchived: false,
                            spaceId: scenario.space.id,
                            accountId: scenario.session1.account.id,
                            channel,
                            postId: post3.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post3.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment3.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: printContentSingleLineTextSnippet({
                                    doc: createSimpleMessageContent("comment3"),
                                    references: emptyContentReferences,
                                }),
                                isStickyMention: false,
                            },
                            otherCommentAuthor: null,
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 2,
                        model: new InboxPostCommentsEntryModel({
                            isArchived: true,
                            spaceId: scenario.space.id,
                            accountId: scenario.session1.account.id,
                            channel,
                            postId: post2.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post2.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment2.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: printContentSingleLineTextSnippet({
                                    doc: createSimpleMessageContent("comment2"),
                                    references: emptyContentReferences,
                                }),
                                isStickyMention: false,
                            },
                            otherCommentAuthor: null,
                        }),
                    },
                ],
            });

            expect(
                await InboxEntriesIndex.realtimeQuery(context.action(scenario.session1), {
                    partitionKey: {
                        spaceId: scenario.space.id,
                        accountId: scenario.session1.account.id,
                    },
                    endSortKey: {
                        isArchived: true,
                        generation: 0,
                        enteredTime: archiveTime2,
                    },
                    isEndSortKeyExclusive: true,
                    limit: "All",
                }),
            ).toEqual({
                readTime: expect.any(Date),
                indexName: "InboxEntries",
                partitionKey: expect.any(String),
                startCursorBound: null,
                endCursorBound: expect.any(String),
                pageInfo: {
                    type: "FromStart",
                    afterCursor: null,
                    hasNextPage: false,
                },
                items: [
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 1,
                        model: new InboxPostCommentsEntryModel({
                            isArchived: false,
                            spaceId: scenario.space.id,
                            accountId: scenario.session1.account.id,
                            channel,
                            postId: post6.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post6.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment6.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: printContentSingleLineTextSnippet({
                                    doc: createSimpleMessageContent("comment6"),
                                    references: emptyContentReferences,
                                }),
                                isStickyMention: false,
                            },
                            otherCommentAuthor: null,
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 1,
                        model: new InboxPostCommentsEntryModel({
                            isArchived: false,
                            spaceId: scenario.space.id,
                            accountId: scenario.session1.account.id,
                            channel,
                            postId: post5.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post5.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment5.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: printContentSingleLineTextSnippet({
                                    doc: createSimpleMessageContent("comment5"),
                                    references: emptyContentReferences,
                                }),
                                isStickyMention: false,
                            },
                            otherCommentAuthor: null,
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 1,
                        model: new InboxPostCommentsEntryModel({
                            isArchived: false,
                            spaceId: scenario.space.id,
                            accountId: scenario.session1.account.id,
                            channel,
                            postId: post4.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post4.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment4.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: printContentSingleLineTextSnippet({
                                    doc: createSimpleMessageContent("comment4"),
                                    references: emptyContentReferences,
                                }),
                                isStickyMention: false,
                            },
                            otherCommentAuthor: null,
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 1,
                        model: new InboxPostCommentsEntryModel({
                            isArchived: false,
                            spaceId: scenario.space.id,
                            accountId: scenario.session1.account.id,
                            channel,
                            postId: post3.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post3.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment3.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: printContentSingleLineTextSnippet({
                                    doc: createSimpleMessageContent("comment3"),
                                    references: emptyContentReferences,
                                }),
                                isStickyMention: false,
                            },
                            otherCommentAuthor: null,
                        }),
                    },
                ],
            });
        });

        test("archiving an entry with loud notifications puts it back at the inbox generation", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post1 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const post2 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const comment1 = await createPostComment(context.action(scenario.session1), {
                postId: post1.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount2MessageContent,
            });

            const comment2 = await createPostComment(context.action(scenario.session1), {
                postId: post2.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount2MessageContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post2.id},
                },
            );

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            const comment3 = await createPostComment(context.action(scenario.session1), {
                postId: post2.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment3"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);
        });

        test("implicitly archiving an entry with loud notifications puts it back at the inbox generation", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post1 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const post2 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const comment1 = await createPostComment(context.action(scenario.session1), {
                postId: post1.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount2MessageContent,
            });

            const comment2 = await createPostComment(context.action(scenario.session1), {
                postId: post2.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount2MessageContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            await createPostComment(context.action(scenario.session2), {
                postId: post2.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("test"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            const comment3 = await createPostComment(context.action(scenario.session1), {
                postId: post2.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment3"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session1.get(),
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);
        });

        test("archived entries are in the order they were archived", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post1 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const post2 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const post3 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const comment1 = await createPostComment(context.action(scenario.session1), {
                postId: post1.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount2MessageContent,
            });

            const comment2 = await createPostComment(context.action(scenario.session1), {
                postId: post2.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount2MessageContent,
            });

            const comment3 = await createPostComment(context.action(scenario.session1), {
                postId: post3.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount2MessageContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "Archive",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post3.id},
                },
            );

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "Archive",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: true,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post1.id},
                },
            );

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "Archive",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: true,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: true,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post2.id},
                },
            );

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "Archive",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: true,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: true,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: true,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("implicitly archived entries are in the order they were archived", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post1 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const post2 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const post3 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const comment1 = await createPostComment(context.action(scenario.session1), {
                postId: post1.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount2MessageContent,
            });

            const comment2 = await createPostComment(context.action(scenario.session1), {
                postId: post2.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount2MessageContent,
            });

            const comment3 = await createPostComment(context.action(scenario.session1), {
                postId: post3.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount2MessageContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "Archive",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const comment4 = await createPostComment(context.action(scenario.session2), {
                postId: post3.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("test"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "Archive",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: true,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("test"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session1.get(),
                }),
            ]);

            const comment5 = await createPostComment(context.action(scenario.session2), {
                postId: post1.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("test"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "Archive",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: true,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment5.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("test"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session1.get(),
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: true,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("test"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session1.get(),
                }),
            ]);

            const comment6 = await createPostComment(context.action(scenario.session2), {
                postId: post2.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("test"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "Archive",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: true,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment6.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("test"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session1.get(),
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: true,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment5.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("test"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session1.get(),
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: true,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("test"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session1.get(),
                }),
            ]);
        });

        test("archive entry order does not change when it updates", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post1 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const post2 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const post3 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const comment1 = await createPostComment(context.action(scenario.session1), {
                postId: post1.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount2MessageContent,
            });

            const comment2 = await createPostComment(context.action(scenario.session1), {
                postId: post2.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount2MessageContent,
            });

            const comment3 = await createPostComment(context.action(scenario.session1), {
                postId: post3.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount2MessageContent,
            });

            await ProcessContextModule.waitForTestTasks();

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post3.id},
                },
            );

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post1.id},
                },
            );

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post2.id},
                },
            );

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "Archive",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: true,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: true,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: true,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await createPostComment(context.action(scenario.session2), {
                postId: post3.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment4"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "Archive",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: true,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: true,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: true,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await createPostComment(context.action(scenario.session2), {
                postId: post2.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment5"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "Archive",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: true,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: true,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxPostCommentsEntryModel({
                    isArchived: true,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("mentioning in a post creates an entry for the mentioned account", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: assertPostContent(
                    PostContentProsemirrorSchema.node("doc", {}, [
                        PostContentProsemirrorSchema.node("paragraph", {}, [
                            PostContentProsemirrorSchema.text("Hello "),
                            PostContentProsemirrorSchema.node("mention", {
                                mention: {accountId: scenario.session1.account.id, isShort: false},
                            }),
                            PostContentProsemirrorSchema.text("!"),
                        ]),
                    ]),
                ),
            });

            const post2 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: assertPostContent(
                    PostContentProsemirrorSchema.node("doc", {}, [
                        PostContentProsemirrorSchema.node("paragraph", {}, [
                            PostContentProsemirrorSchema.text("Hello "),
                            PostContentProsemirrorSchema.node("mention", {
                                mention: {accountId: scenario.session2.account.id, isShort: false},
                            }),
                            PostContentProsemirrorSchema.text("!"),
                        ]),
                    ]),
                ),
            });

            const post3 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: assertPostContent(
                    PostContentProsemirrorSchema.node("doc", {}, [
                        PostContentProsemirrorSchema.node("paragraph", {}, [
                            PostContentProsemirrorSchema.text("Hello "),
                            PostContentProsemirrorSchema.node("mention", {
                                mention: {accountId: scenario.session3.account.id, isShort: false},
                            }),
                            PostContentProsemirrorSchema.text("!"),
                        ]),
                    ]),
                ),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post2.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: printContentSingleLineTextSnippet({
                        doc: assertPostContent(
                            PostContentProsemirrorSchema.node("doc", {}, [
                                PostContentProsemirrorSchema.node("paragraph", {}, [
                                    PostContentProsemirrorSchema.text("Hello "),
                                    PostContentProsemirrorSchema.node("mention", {
                                        mention: {
                                            accountId: scenario.session2.account.id,
                                            isShort: false,
                                        },
                                    }),
                                    PostContentProsemirrorSchema.text("!"),
                                ]),
                            ]),
                        ),
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, await scenario.session2.get()],
                            ]),
                        },
                    }),
                    latestComment: null,
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: assertPostContent(
                                PostContentProsemirrorSchema.node("doc", {}, [
                                    PostContentProsemirrorSchema.node("paragraph", {}, [
                                        PostContentProsemirrorSchema.text("Hello "),
                                        PostContentProsemirrorSchema.node("mention", {
                                            mention: {
                                                accountId: scenario.session3.account.id,
                                                isShort: false,
                                            },
                                        }),
                                        PostContentProsemirrorSchema.text("!"),
                                    ]),
                                ]),
                            ),
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session3.account.id, await scenario.session3.get()],
                                ]),
                            },
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    postId: post3.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: printContentSingleLineTextSnippet({
                        doc: assertPostContent(
                            PostContentProsemirrorSchema.node("doc", {}, [
                                PostContentProsemirrorSchema.node("paragraph", {}, [
                                    PostContentProsemirrorSchema.text("Hello "),
                                    PostContentProsemirrorSchema.node("mention", {
                                        mention: {
                                            accountId: scenario.session3.account.id,
                                            isShort: false,
                                        },
                                    }),
                                    PostContentProsemirrorSchema.text("!"),
                                ]),
                            ]),
                        ),
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session3.account.id, await scenario.session3.get()],
                            ]),
                        },
                    }),
                    latestComment: null,
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: assertPostContent(
                                PostContentProsemirrorSchema.node("doc", {}, [
                                    PostContentProsemirrorSchema.node("paragraph", {}, [
                                        PostContentProsemirrorSchema.text("Hello "),
                                        PostContentProsemirrorSchema.node("mention", {
                                            mention: {
                                                accountId: scenario.session2.account.id,
                                                isShort: false,
                                            },
                                        }),
                                        PostContentProsemirrorSchema.text("!"),
                                    ]),
                                ]),
                            ),
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);
        });

        test("commenting on a post someone was mentioned on updates an entry for the mentioned account", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: assertPostContent(
                    PostContentProsemirrorSchema.node("doc", {}, [
                        PostContentProsemirrorSchema.node("paragraph", {}, [
                            PostContentProsemirrorSchema.text("Hello "),
                            PostContentProsemirrorSchema.node("mention", {
                                mention: {accountId: scenario.session2.account.id, isShort: false},
                            }),
                            PostContentProsemirrorSchema.text("!"),
                        ]),
                    ]),
                ),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: printContentSingleLineTextSnippet({
                        doc: assertPostContent(
                            PostContentProsemirrorSchema.node("doc", {}, [
                                PostContentProsemirrorSchema.node("paragraph", {}, [
                                    PostContentProsemirrorSchema.text("Hello "),
                                    PostContentProsemirrorSchema.node("mention", {
                                        mention: {
                                            accountId: scenario.session2.account.id,
                                            isShort: false,
                                        },
                                    }),
                                    PostContentProsemirrorSchema.text("!"),
                                ]),
                            ]),
                        ),
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, await scenario.session2.get()],
                            ]),
                        },
                    }),
                    latestComment: null,
                    otherCommentAuthor: null,
                }),
            ]);

            const comment1 = await createPostComment(context.action(scenario.session3), {
                postId: post.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment1"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: printContentSingleLineTextSnippet({
                        doc: assertPostContent(
                            PostContentProsemirrorSchema.node("doc", {}, [
                                PostContentProsemirrorSchema.node("paragraph", {}, [
                                    PostContentProsemirrorSchema.text("Hello "),
                                    PostContentProsemirrorSchema.node("mention", {
                                        mention: {
                                            accountId: scenario.session2.account.id,
                                            isShort: false,
                                        },
                                    }),
                                    PostContentProsemirrorSchema.text("!"),
                                ]),
                            ]),
                        ),
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, await scenario.session2.get()],
                            ]),
                        },
                    }),
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("commenting on a post revives an archived entry someone was mentioned on", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: assertPostContent(
                    PostContentProsemirrorSchema.node("doc", {}, [
                        PostContentProsemirrorSchema.node("paragraph", {}, [
                            PostContentProsemirrorSchema.text("Hello "),
                            PostContentProsemirrorSchema.node("mention", {
                                mention: {accountId: scenario.session2.account.id, isShort: false},
                            }),
                            PostContentProsemirrorSchema.text("!"),
                        ]),
                    ]),
                ),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: printContentSingleLineTextSnippet({
                        doc: assertPostContent(
                            PostContentProsemirrorSchema.node("doc", {}, [
                                PostContentProsemirrorSchema.node("paragraph", {}, [
                                    PostContentProsemirrorSchema.text("Hello "),
                                    PostContentProsemirrorSchema.node("mention", {
                                        mention: {
                                            accountId: scenario.session2.account.id,
                                            isShort: false,
                                        },
                                    }),
                                    PostContentProsemirrorSchema.text("!"),
                                ]),
                            ]),
                        ),
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, await scenario.session2.get()],
                            ]),
                        },
                    }),
                    latestComment: null,
                    otherCommentAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "Archive",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post.id},
                },
            );

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "Archive",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: true,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: printContentSingleLineTextSnippet({
                        doc: assertPostContent(
                            PostContentProsemirrorSchema.node("doc", {}, [
                                PostContentProsemirrorSchema.node("paragraph", {}, [
                                    PostContentProsemirrorSchema.text("Hello "),
                                    PostContentProsemirrorSchema.node("mention", {
                                        mention: {
                                            accountId: scenario.session2.account.id,
                                            isShort: false,
                                        },
                                    }),
                                    PostContentProsemirrorSchema.text("!"),
                                ]),
                            ]),
                        ),
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, await scenario.session2.get()],
                            ]),
                        },
                    }),
                    latestComment: null,
                    otherCommentAuthor: null,
                }),
            ]);

            const comment1 = await createPostComment(context.action(scenario.session3), {
                postId: post.id,
                parentCommentIndex: null,
                content: createSimpleMessageContent("comment1"),
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("comment1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "Archive",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);
        });

        test("post with mention create event processed after comment event", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const pause1Promise = notificationEventBeforeProcessingTestCheckpoint.pauseForTest(
                scenario.session1.account.id,
            );
            const pause2Promise = notificationEventAfterProcessingTestCheckpoint.pauseForTest(
                scenario.session3.account.id,
            );

            const post = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: assertPostContent(
                    PostContentProsemirrorSchema.node("doc", {}, [
                        PostContentProsemirrorSchema.node("paragraph", {}, [
                            PostContentProsemirrorSchema.text("Hello "),
                            PostContentProsemirrorSchema.node("mention", {
                                mention: {accountId: scenario.session2.account.id, isShort: false},
                            }),
                            PostContentProsemirrorSchema.text("!"),
                        ]),
                    ]),
                ),
            });

            const comment = await createPostComment(context.action(scenario.session3), {
                postId: post.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount2MessageContent,
            });

            const {unpause: unpause1} = await pause1Promise;
            const {unpause: unpause2} = await pause2Promise;
            unpause2();

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            unpause1();
            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 2,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: printContentSingleLineTextSnippet({
                        doc: assertPostContent(
                            PostContentProsemirrorSchema.node("doc", {}, [
                                PostContentProsemirrorSchema.node("paragraph", {}, [
                                    PostContentProsemirrorSchema.text("Hello "),
                                    PostContentProsemirrorSchema.node("mention", {
                                        mention: {
                                            accountId: scenario.session2.account.id,
                                            isShort: false,
                                        },
                                    }),
                                    PostContentProsemirrorSchema.text("!"),
                                ]),
                            ]),
                        ),
                        references: {
                            ...emptyContentReferences,
                            accountById: new Map([
                                [scenario.session2.account.id, await scenario.session2.get()],
                            ]),
                        },
                    }),
                    latestComment: {
                        createdTime: comment.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("post with mention create event processed after comment event and after entry was archived", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const pause1Promise = notificationEventBeforeProcessingTestCheckpoint.pauseForTest(
                scenario.session1.account.id,
            );
            const pause2Promise = notificationEventAfterProcessingTestCheckpoint.pauseForTest(
                scenario.session3.account.id,
            );

            const post = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: assertPostContent(
                    PostContentProsemirrorSchema.node("doc", {}, [
                        PostContentProsemirrorSchema.node("paragraph", {}, [
                            PostContentProsemirrorSchema.text("Hello "),
                            PostContentProsemirrorSchema.node("mention", {
                                mention: {accountId: scenario.session2.account.id, isShort: false},
                            }),
                            PostContentProsemirrorSchema.text("!"),
                        ]),
                    ]),
                ),
            });

            const comment = await createPostComment(context.action(scenario.session3), {
                postId: post.id,
                parentCommentIndex: null,
                content: scenario.mentionAccount2MessageContent,
            });

            const {unpause: unpause1} = await pause1Promise;
            const {unpause: unpause2} = await pause2Promise;
            unpause2();

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "Archive",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post.id},
                },
            );

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "Archive",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: true,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            unpause1();
            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "Archive",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: true,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    postId: post.id,
                    postAuthor: await scenario.session1.get(),
                    channel,
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: scenario.mentionAccount2MessageContent,
                            references: {
                                ...emptyContentReferences,
                                accountById: new Map([
                                    [scenario.session2.account.id, await scenario.session2.get()],
                                ]),
                            },
                        }),
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("creating posts updates an entry for every member in the space", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel1 = await createChannel(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                name: "Test 1",
            });

            const channel1 = new ChannelPreviewModel({
                id: _channel1.id,
                spaceId: scenario.space.id,
                createdTime: _channel1.createdTime,
                name: "Test 1",
            });

            const _channel2 = await createChannel(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                name: "Test 2",
            });

            const channel2 = new ChannelPreviewModel({
                id: _channel2.id,
                spaceId: scenario.space.id,
                createdTime: _channel2.createdTime,
                name: "Test 2",
            });

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.sharedSession), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.otherSession), {
                    spaceId: scenario.otherSpace.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const post1 = await createPost(context.action(scenario.session1), {
                channelId: channel1.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: channel1,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post1.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel: channel1,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post1.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.sharedSession), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.sharedSession.account.id,
                    loudNotificationCount: 0,
                    channel: channel1,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post1.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.otherSession), {
                    spaceId: scenario.otherSpace.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const post2 = await createPost(context.action(scenario.session1), {
                channelId: channel1.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: channel1,
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel: channel1,
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.sharedSession), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.sharedSession.account.id,
                    loudNotificationCount: 0,
                    channel: channel1,
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.otherSession), {
                    spaceId: scenario.otherSpace.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const post3 = await createPost(context.action(scenario.session2), {
                channelId: channel1.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    channel: channel1,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: channel1,
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel: channel1,
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 2,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: await scenario.session1.get(),
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.sharedSession), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.sharedSession.account.id,
                    loudNotificationCount: 0,
                    channel: channel1,
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 2,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: await scenario.session1.get(),
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.otherSession), {
                    spaceId: scenario.otherSpace.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const post4 = await createPost(context.action(scenario.session2), {
                channelId: channel2.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    channel: channel2,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post4.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    channel: channel1,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: channel1,
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel: channel2,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post4.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel: channel1,
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 2,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: await scenario.session1.get(),
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.sharedSession), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.sharedSession.account.id,
                    loudNotificationCount: 0,
                    channel: channel2,
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post4.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.sharedSession.account.id,
                    loudNotificationCount: 0,
                    channel: channel1,
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 2,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: emptyPostContent,
                            references: emptyContentReferences,
                        }),
                    },
                    otherPostAuthor: await scenario.session1.get(),
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.otherSession), {
                    spaceId: scenario.otherSpace.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);
        });

        test("can not get inbox entry posts for a space you don't have access to", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            await expect(
                testGetInboxChannelPostsEntryPosts(context.action(scenario.otherSession), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 0,
                    limit: 100,
                    commentLimit: 100,
                    afterPostId: null,
                }),
            ).rejects.toThrow(PermissionDeniedError);
        });

        test("getting inbox entry posts freezes the inbox entry", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post1 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            const post2 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet(
                            emptyPostContentWithReferences,
                        ),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 0,
                    limit: 100,
                    commentLimit: 100,
                    afterPostId: null,
                }),
            ).toEqual({
                hasMorePosts: false,
                posts: [
                    new PostModel({
                        id: post2.id,
                        spaceId: scenario.space.id,
                        channel,
                        createdTime: post2.createdTime,
                        author: await scenario.session1.get(),
                        content: emptyPostContentWithReferences,
                        contentUpdatedTime: null,
                        commentCount: 0,
                        lastCommentChangeTime: null,
                        commentAuthorCount: 0,
                        previewCommentAuthors: [],
                    }),
                    new PostModel({
                        id: post1.id,
                        spaceId: scenario.space.id,
                        channel,
                        createdTime: post1.createdTime,
                        author: await scenario.session1.get(),
                        content: emptyPostContentWithReferences,
                        contentUpdatedTime: null,
                        commentCount: 0,
                        lastCommentChangeTime: null,
                        commentAuthorCount: 0,
                        previewCommentAuthors: [],
                    }),
                ],
            });

            await expect(
                testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 4,
                    limit: 100,
                    commentLimit: 100,
                    afterPostId: null,
                }),
            ).rejects.toThrow(NotFoundError);

            const post3 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 2,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet(
                            emptyPostContentWithReferences,
                        ),
                    },
                    otherPostAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet(
                            emptyPostContentWithReferences,
                        ),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 0,
                    limit: 100,
                    commentLimit: 100,
                    afterPostId: null,
                }),
            ).toEqual({
                hasMorePosts: false,
                posts: [
                    new PostModel({
                        id: post2.id,
                        spaceId: scenario.space.id,
                        channel,
                        createdTime: post2.createdTime,
                        author: await scenario.session1.get(),
                        content: emptyPostContentWithReferences,
                        contentUpdatedTime: null,
                        commentCount: 0,
                        lastCommentChangeTime: null,
                        commentAuthorCount: 0,
                        previewCommentAuthors: [],
                    }),
                    new PostModel({
                        id: post1.id,
                        spaceId: scenario.space.id,
                        channel,
                        createdTime: post1.createdTime,
                        author: await scenario.session1.get(),
                        content: emptyPostContentWithReferences,
                        contentUpdatedTime: null,
                        commentCount: 0,
                        lastCommentChangeTime: null,
                        commentAuthorCount: 0,
                        previewCommentAuthors: [],
                    }),
                ],
            });

            expect(
                await testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 2,
                    limit: 100,
                    commentLimit: 100,
                    afterPostId: null,
                }),
            ).toEqual({
                hasMorePosts: false,
                posts: [
                    new PostModel({
                        id: post3.id,
                        spaceId: scenario.space.id,
                        channel,
                        createdTime: post3.createdTime,
                        author: await scenario.session1.get(),
                        content: emptyPostContentWithReferences,
                        contentUpdatedTime: null,
                        commentCount: 0,
                        lastCommentChangeTime: null,
                        commentAuthorCount: 0,
                        previewCommentAuthors: [],
                    }),
                ],
            });

            const post4 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 4,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post4.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet(
                            emptyPostContentWithReferences,
                        ),
                    },
                    otherPostAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 2,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet(
                            emptyPostContentWithReferences,
                        ),
                    },
                    otherPostAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet(
                            emptyPostContentWithReferences,
                        ),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 0,
                    limit: 100,
                    commentLimit: 100,
                    afterPostId: null,
                }),
            ).toEqual({
                hasMorePosts: false,
                posts: [
                    new PostModel({
                        id: post2.id,
                        spaceId: scenario.space.id,
                        channel,
                        createdTime: post2.createdTime,
                        author: await scenario.session1.get(),
                        content: emptyPostContentWithReferences,
                        contentUpdatedTime: null,
                        commentCount: 0,
                        lastCommentChangeTime: null,
                        commentAuthorCount: 0,
                        previewCommentAuthors: [],
                    }),
                    new PostModel({
                        id: post1.id,
                        spaceId: scenario.space.id,
                        channel,
                        createdTime: post1.createdTime,
                        author: await scenario.session1.get(),
                        content: emptyPostContentWithReferences,
                        contentUpdatedTime: null,
                        commentCount: 0,
                        lastCommentChangeTime: null,
                        commentAuthorCount: 0,
                        previewCommentAuthors: [],
                    }),
                ],
            });

            expect(
                await testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 2,
                    limit: 100,
                    commentLimit: 100,
                    afterPostId: null,
                }),
            ).toEqual({
                hasMorePosts: false,
                posts: [
                    new PostModel({
                        id: post3.id,
                        spaceId: scenario.space.id,
                        channel,
                        createdTime: post3.createdTime,
                        author: await scenario.session1.get(),
                        content: emptyPostContentWithReferences,
                        contentUpdatedTime: null,
                        commentCount: 0,
                        lastCommentChangeTime: null,
                        commentAuthorCount: 0,
                        previewCommentAuthors: [],
                    }),
                ],
            });

            expect(
                await testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 4,
                    limit: 100,
                    commentLimit: 100,
                    afterPostId: null,
                }),
            ).toEqual({
                hasMorePosts: false,
                posts: [
                    new PostModel({
                        id: post4.id,
                        spaceId: scenario.space.id,
                        channel,
                        createdTime: post4.createdTime,
                        author: await scenario.session1.get(),
                        content: emptyPostContentWithReferences,
                        contentUpdatedTime: null,
                        commentCount: 0,
                        lastCommentChangeTime: null,
                        commentAuthorCount: 0,
                        previewCommentAuthors: [],
                    }),
                ],
            });
        });

        test("getting inbox entry posts does not observe if inbox was already observed", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post1 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            const post2 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet(
                            emptyPostContentWithReferences,
                        ),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            await observeInbox(context.action(scenario.session2), {spaceId: scenario.space.id});

            const post3 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 2,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet(
                            emptyPostContentWithReferences,
                        ),
                    },
                    otherPostAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet(
                            emptyPostContentWithReferences,
                        ),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 0,
                    limit: 100,
                    commentLimit: 100,
                    afterPostId: null,
                }),
            ).toEqual({
                hasMorePosts: false,
                posts: [
                    new PostModel({
                        id: post2.id,
                        spaceId: scenario.space.id,
                        channel,
                        createdTime: post2.createdTime,
                        author: await scenario.session1.get(),
                        content: emptyPostContentWithReferences,
                        contentUpdatedTime: null,
                        commentCount: 0,
                        lastCommentChangeTime: null,
                        commentAuthorCount: 0,
                        previewCommentAuthors: [],
                    }),
                    new PostModel({
                        id: post1.id,
                        spaceId: scenario.space.id,
                        channel,
                        createdTime: post1.createdTime,
                        author: await scenario.session1.get(),
                        content: emptyPostContentWithReferences,
                        contentUpdatedTime: null,
                        commentCount: 0,
                        lastCommentChangeTime: null,
                        commentAuthorCount: 0,
                        previewCommentAuthors: [],
                    }),
                ],
            });

            const post4 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 2,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post4.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet(
                            emptyPostContentWithReferences,
                        ),
                    },
                    otherPostAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel,
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: printContentSingleLineTextSnippet(
                            emptyPostContentWithReferences,
                        ),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 0,
                    limit: 100,
                    commentLimit: 100,
                    afterPostId: null,
                }),
            ).toEqual({
                hasMorePosts: false,
                posts: [
                    new PostModel({
                        id: post2.id,
                        spaceId: scenario.space.id,
                        channel,
                        createdTime: post2.createdTime,
                        author: await scenario.session1.get(),
                        content: emptyPostContentWithReferences,
                        contentUpdatedTime: null,
                        commentCount: 0,
                        lastCommentChangeTime: null,
                        commentAuthorCount: 0,
                        previewCommentAuthors: [],
                    }),
                    new PostModel({
                        id: post1.id,
                        spaceId: scenario.space.id,
                        channel,
                        createdTime: post1.createdTime,
                        author: await scenario.session1.get(),
                        content: emptyPostContentWithReferences,
                        contentUpdatedTime: null,
                        commentCount: 0,
                        lastCommentChangeTime: null,
                        commentAuthorCount: 0,
                        previewCommentAuthors: [],
                    }),
                ],
            });

            expect(
                await testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 2,
                    limit: 100,
                    commentLimit: 100,
                    afterPostId: null,
                }),
            ).toEqual({
                hasMorePosts: false,
                posts: [
                    new PostModel({
                        id: post4.id,
                        spaceId: scenario.space.id,
                        channel,
                        createdTime: post4.createdTime,
                        author: await scenario.session1.get(),
                        content: emptyPostContentWithReferences,
                        contentUpdatedTime: null,
                        commentCount: 0,
                        lastCommentChangeTime: null,
                        commentAuthorCount: 0,
                        previewCommentAuthors: [],
                    }),
                    new PostModel({
                        id: post3.id,
                        spaceId: scenario.space.id,
                        channel,
                        createdTime: post3.createdTime,
                        author: await scenario.session1.get(),
                        content: emptyPostContentWithReferences,
                        contentUpdatedTime: null,
                        commentCount: 0,
                        lastCommentChangeTime: null,
                        commentAuthorCount: 0,
                        previewCommentAuthors: [],
                    }),
                ],
            });
        });

        test("can paginate getting inbox entries", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post1 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });
            await ProcessContextModule.waitForTestTasks();

            const post2 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });
            await ProcessContextModule.waitForTestTasks();

            const post3 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });
            await ProcessContextModule.waitForTestTasks();

            const post4 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });
            await ProcessContextModule.waitForTestTasks();

            const post5 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });
            await ProcessContextModule.waitForTestTasks();

            const post6 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });
            await ProcessContextModule.waitForTestTasks();

            const post7 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });
            await ProcessContextModule.waitForTestTasks();

            const post8 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });
            await ProcessContextModule.waitForTestTasks();

            const post1Model = new PostModel({
                id: post1.id,
                spaceId: scenario.space.id,
                channel,
                createdTime: post1.createdTime,
                author: await scenario.session1.get(),
                content: emptyPostContentWithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            });

            const post2Model = new PostModel({
                id: post2.id,
                spaceId: scenario.space.id,
                channel,
                createdTime: post2.createdTime,
                author: await scenario.session1.get(),
                content: emptyPostContentWithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            });

            const post3Model = new PostModel({
                id: post3.id,
                spaceId: scenario.space.id,
                channel,
                createdTime: post3.createdTime,
                author: await scenario.session1.get(),
                content: emptyPostContentWithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            });

            const post4Model = new PostModel({
                id: post4.id,
                spaceId: scenario.space.id,
                channel,
                createdTime: post4.createdTime,
                author: await scenario.session1.get(),
                content: emptyPostContentWithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            });

            const post5Model = new PostModel({
                id: post5.id,
                spaceId: scenario.space.id,
                channel,
                createdTime: post5.createdTime,
                author: await scenario.session1.get(),
                content: emptyPostContentWithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            });

            const post6Model = new PostModel({
                id: post6.id,
                spaceId: scenario.space.id,
                channel,
                createdTime: post6.createdTime,
                author: await scenario.session1.get(),
                content: emptyPostContentWithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            });

            const post7Model = new PostModel({
                id: post7.id,
                spaceId: scenario.space.id,
                channel,
                createdTime: post7.createdTime,
                author: await scenario.session1.get(),
                content: emptyPostContentWithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            });

            const post8Model = new PostModel({
                id: post8.id,
                spaceId: scenario.space.id,
                channel,
                createdTime: post8.createdTime,
                author: await scenario.session1.get(),
                content: emptyPostContentWithReferences,
                contentUpdatedTime: null,
                commentCount: 0,
                lastCommentChangeTime: null,
                commentAuthorCount: 0,
                previewCommentAuthors: [],
            });

            expect(
                await testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 0,
                    limit: 100,
                    commentLimit: 100,
                    afterPostId: null,
                }),
            ).toEqual({
                hasMorePosts: false,
                posts: [
                    post8Model,
                    post7Model,
                    post6Model,
                    post5Model,
                    post4Model,
                    post3Model,
                    post2Model,
                    post1Model,
                ],
            });

            expect(
                await testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 0,
                    limit: 4,
                    commentLimit: 100,
                    afterPostId: null,
                }),
            ).toEqual({
                hasMorePosts: true,
                posts: [post8Model, post7Model, post6Model, post5Model],
            });

            expect(
                await testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 0,
                    limit: 7,
                    commentLimit: 100,
                    afterPostId: null,
                }),
            ).toEqual({
                hasMorePosts: true,
                posts: [
                    post8Model,
                    post7Model,
                    post6Model,
                    post5Model,
                    post4Model,
                    post3Model,
                    post2Model,
                ],
            });

            expect(
                await testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 0,
                    limit: 8,
                    commentLimit: 100,
                    afterPostId: null,
                }),
            ).toEqual({
                hasMorePosts: false,
                posts: [
                    post8Model,
                    post7Model,
                    post6Model,
                    post5Model,
                    post4Model,
                    post3Model,
                    post2Model,
                    post1Model,
                ],
            });

            expect(
                await testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 0,
                    limit: 100,
                    commentLimit: 100,
                    afterPostId: post5.id,
                }),
            ).toEqual({
                hasMorePosts: false,
                posts: [post4Model, post3Model, post2Model, post1Model],
            });

            expect(
                await testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 0,
                    limit: 4,
                    commentLimit: 100,
                    afterPostId: post5.id,
                }),
            ).toEqual({
                hasMorePosts: false,
                posts: [post4Model, post3Model, post2Model, post1Model],
            });

            expect(
                await testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 0,
                    limit: 3,
                    commentLimit: 100,
                    afterPostId: post5.id,
                }),
            ).toEqual({
                hasMorePosts: true,
                posts: [post4Model, post3Model, post2Model],
            });

            expect(
                await testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 0,
                    limit: 4,
                    commentLimit: 100,
                    afterPostId: post7.id,
                }),
            ).toEqual({
                hasMorePosts: true,
                posts: [post6Model, post5Model, post4Model, post3Model],
            });

            const post9 = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });
            await ProcessContextModule.waitForTestTasks();

            await expect(
                testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 0,
                    limit: 4,
                    commentLimit: 100,
                    afterPostId: post9.id,
                }),
            ).rejects.toThrow(NotFoundError);
        });

        test("account can't backfill in a space it can't access", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            const otherChannel = await createChannel(context.action(scenario.otherSession), {
                spaceId: scenario.otherSpace.id,
                name: "Test",
            });

            await createPost(context.action(scenario.otherSession), {
                channelId: otherChannel.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await backfillInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    readTime: new Date(),
                }),
            ).toEqual({
                type: "Available",
                readTime: expect.any(Date),
                eventTransaction: [
                    {
                        type: "PutItem",
                        item: {
                            key: expect.any(String),
                            version: expect.any(Number),
                            model: new InboxChannelPostsEntryModel({
                                isArchived: false,
                                spaceId: scenario.space.id,
                                accountId: scenario.session3.account.id,
                                loudNotificationCount: 0,
                                channel,
                                bucketGeneration: 0,
                                postCount: 1,
                                postAuthorCount: 1,
                                latestPost: {
                                    author: await scenario.session1.get(),
                                    createdTime: post.createdTime,
                                    contentTextSnippet: printContentSingleLineTextSnippet({
                                        doc: emptyPostContent,
                                        references: emptyContentReferences,
                                    }),
                                },
                                otherPostAuthor: null,
                            }),
                        },
                        indexes: expect.any(Map),
                    },
                ],
            });

            await expect(
                backfillInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.otherSpace.id,
                    readTime: new Date(),
                }),
            ).rejects.toThrow(PermissionDeniedError);
        });

        test("won't backfill events that happened far in the past", async () => {
            const scenario = await createNotificationsScenario(context);

            const _channel = await createChannel(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                name: "Test",
            });

            const channel = new ChannelPreviewModel({
                id: _channel.id,
                spaceId: scenario.space.id,
                createdTime: _channel.createdTime,
                name: "Test",
            });

            const post = await createPost(context.action(scenario.session1), {
                channelId: channel.id,
                content: emptyPostContent,
            });

            await ProcessContextModule.waitForTestTasks();

            expect(
                await backfillInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    readTime: subMinutes(new Date(), 30),
                }),
            ).toEqual({
                type: "Available",
                readTime: expect.any(Date),
                eventTransaction: [
                    {
                        type: "PutItem",
                        item: {
                            key: expect.any(String),
                            version: expect.any(Number),
                            model: new InboxChannelPostsEntryModel({
                                isArchived: false,
                                spaceId: scenario.space.id,
                                accountId: scenario.session3.account.id,
                                loudNotificationCount: 0,
                                channel,
                                bucketGeneration: 0,
                                postCount: 1,
                                postAuthorCount: 1,
                                latestPost: {
                                    author: await scenario.session1.get(),
                                    createdTime: post.createdTime,
                                    contentTextSnippet: printContentSingleLineTextSnippet({
                                        doc: emptyPostContent,
                                        references: emptyContentReferences,
                                    }),
                                },
                                otherPostAuthor: null,
                            }),
                        },
                        indexes: expect.any(Map),
                    },
                ],
            });

            expect(
                await backfillInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    readTime: addMinutes(new Date(), 30),
                }),
            ).toEqual({
                type: "Available",
                readTime: expect.any(Date),
                eventTransaction: [],
            });
        });
    });

    test("if an account is mentioned then the mentioned message sticks around until archival", async () => {
        const space = await TestSpace.create(context);

        const session1 = await space.createSession();
        const session2 = await space.createSession();

        const channel = await TestChannel.create(session1);
        const post = await channel.createPost(session1);

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(session2.action(), {
                spaceId: space.id,
                filter: "New",
                limit: 100,
                afterCursor: null,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChannelPostsEntryModel({
                isArchived: false,
                spaceId: space.id,
                accountId: session2.account.id,
                loudNotificationCount: 0,
                channel: expect.any(ChannelPreviewModel),
                bucketGeneration: 0,
                postCount: 1,
                postAuthorCount: 1,
                latestPost: expect.any(Object),
                otherPostAuthor: null,
            }),
        ]);

        await createPostComment(session2.action(), {
            postId: post.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test comment 1"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(session2.action(), {
                spaceId: space.id,
                filter: "New",
                limit: 100,
                afterCursor: null,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxChannelPostsEntryModel({
                isArchived: false,
                spaceId: space.id,
                accountId: session2.account.id,
                loudNotificationCount: 0,
                channel: expect.any(ChannelPreviewModel),
                bucketGeneration: 0,
                postCount: 1,
                postAuthorCount: 1,
                latestPost: expect.any(Object),
                otherPostAuthor: null,
            }),
        ]);

        await archiveInboxEntry(session2.action().clone({apns: new TestApnsContextModule()}), {
            spaceId: space.id,
            key: {type: "ChannelPosts", channelId: channel.id, bucketGeneration: 0},
        });

        expect(
            await getInboxEntries(session2.action(), {
                spaceId: space.id,
                filter: "New",
                limit: 100,
                afterCursor: null,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const comment2 = await createPostComment(session1.action(), {
            postId: post.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test comment 2"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(session2.action(), {
                spaceId: space.id,
                filter: "New",
                limit: 100,
                afterCursor: null,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                isArchived: false,
                spaceId: space.id,
                accountId: session2.account.id,
                postId: post.id,
                postAuthor: await session1.get(),
                channel: expect.any(ChannelPreviewModel),
                loudNotificationCount: 0,
                postCreatedTime: post.createdTime,
                postContentTextSnippetIfMentioned: null,
                latestComment: {
                    createdTime: comment2.createdTime,
                    author: await session1.get(),
                    contentTextSnippet: printContentSingleLineTextSnippet({
                        doc: createSimpleMessageContent("Test comment 2"),
                        references: emptyContentReferences,
                    }),
                    isStickyMention: false,
                },
                otherCommentAuthor: null,
            }),
        ]);

        const comment3 = await createPostComment(session1.action(), {
            postId: post.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test comment 3"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(session2.action(), {
                spaceId: space.id,
                filter: "New",
                limit: 100,
                afterCursor: null,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                isArchived: false,
                spaceId: space.id,
                accountId: session2.account.id,
                postId: post.id,
                postAuthor: await session1.get(),
                channel: expect.any(ChannelPreviewModel),
                loudNotificationCount: 0,
                postCreatedTime: post.createdTime,
                postContentTextSnippetIfMentioned: null,
                latestComment: {
                    createdTime: comment3.createdTime,
                    author: await session1.get(),
                    contentTextSnippet: printContentSingleLineTextSnippet({
                        doc: createSimpleMessageContent("Test comment 3"),
                        references: emptyContentReferences,
                    }),
                    isStickyMention: false,
                },
                otherCommentAuthor: null,
            }),
        ]);

        const comment4 = await createPostComment(session1.action(), {
            postId: post.id,
            parentCommentIndex: null,
            content: assertMessageContent(
                MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Test comment 4 "),
                        MessageContentProsemirrorSchema.node("mention", {
                            mention: {accountId: session2.account.id, isShort: false},
                        }),
                    ]),
                ]),
            ),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(session2.action(), {
                spaceId: space.id,
                filter: "New",
                limit: 100,
                afterCursor: null,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                isArchived: false,
                spaceId: space.id,
                accountId: session2.account.id,
                postId: post.id,
                postAuthor: await session1.get(),
                channel: expect.any(ChannelPreviewModel),
                loudNotificationCount: 1,
                postCreatedTime: post.createdTime,
                postContentTextSnippetIfMentioned: null,
                latestComment: {
                    createdTime: comment4.createdTime,
                    author: await session1.get(),
                    contentTextSnippet: `Test comment 4 @${session2.account.initialName}`,
                    isStickyMention: true,
                },
                otherCommentAuthor: null,
            }),
        ]);

        await createPostComment(session1.action(), {
            postId: post.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test comment 5"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(session2.action(), {
                spaceId: space.id,
                filter: "New",
                limit: 100,
                afterCursor: null,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                isArchived: false,
                spaceId: space.id,
                accountId: session2.account.id,
                postId: post.id,
                postAuthor: await session1.get(),
                channel: expect.any(ChannelPreviewModel),
                loudNotificationCount: 1,
                postCreatedTime: post.createdTime,
                postContentTextSnippetIfMentioned: null,
                latestComment: {
                    createdTime: comment4.createdTime,
                    author: await session1.get(),
                    contentTextSnippet: `Test comment 4 @${session2.account.initialName}`,
                    isStickyMention: true,
                },
                otherCommentAuthor: null,
            }),
        ]);

        await createPostComment(session1.action(), {
            postId: post.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test comment 6"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(session2.action(), {
                spaceId: space.id,
                filter: "New",
                limit: 100,
                afterCursor: null,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                isArchived: false,
                spaceId: space.id,
                accountId: session2.account.id,
                postId: post.id,
                postAuthor: await session1.get(),
                channel: expect.any(ChannelPreviewModel),
                loudNotificationCount: 1,
                postCreatedTime: post.createdTime,
                postContentTextSnippetIfMentioned: null,
                latestComment: {
                    createdTime: comment4.createdTime,
                    author: await session1.get(),
                    contentTextSnippet: `Test comment 4 @${session2.account.initialName}`,
                    isStickyMention: true,
                },
                otherCommentAuthor: null,
            }),
        ]);

        const comment7 = await createPostComment(session1.action(), {
            postId: post.id,
            parentCommentIndex: null,
            content: assertMessageContent(
                MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Test comment 7 "),
                        MessageContentProsemirrorSchema.node("mention", {
                            mention: {accountId: session2.account.id, isShort: false},
                        }),
                    ]),
                ]),
            ),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(session2.action(), {
                spaceId: space.id,
                filter: "New",
                limit: 100,
                afterCursor: null,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                isArchived: false,
                spaceId: space.id,
                accountId: session2.account.id,
                postId: post.id,
                postAuthor: await session1.get(),
                channel: expect.any(ChannelPreviewModel),
                loudNotificationCount: 2,
                postCreatedTime: post.createdTime,
                postContentTextSnippetIfMentioned: null,
                latestComment: {
                    createdTime: comment7.createdTime,
                    author: await session1.get(),
                    contentTextSnippet: `Test comment 7 @${session2.account.initialName}`,
                    isStickyMention: true,
                },
                otherCommentAuthor: null,
            }),
        ]);

        await createPostComment(session1.action(), {
            postId: post.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test comment 8"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(session2.action(), {
                spaceId: space.id,
                filter: "New",
                limit: 100,
                afterCursor: null,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                isArchived: false,
                spaceId: space.id,
                accountId: session2.account.id,
                postId: post.id,
                postAuthor: await session1.get(),
                channel: expect.any(ChannelPreviewModel),
                loudNotificationCount: 2,
                postCreatedTime: post.createdTime,
                postContentTextSnippetIfMentioned: null,
                latestComment: {
                    createdTime: comment7.createdTime,
                    author: await session1.get(),
                    contentTextSnippet: `Test comment 7 @${session2.account.initialName}`,
                    isStickyMention: true,
                },
                otherCommentAuthor: null,
            }),
        ]);

        await archiveInboxEntry(session2.action().clone({apns: new TestApnsContextModule()}), {
            spaceId: space.id,
            key: {type: "PostComments", postId: post.id},
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(session2.action(), {
                spaceId: space.id,
                filter: "New",
                limit: 100,
                afterCursor: null,
            }).then(massageInboxEntriesQuery),
        ).toEqual([]);

        const comment9 = await createPostComment(session1.action(), {
            postId: post.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test comment 9"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntries(session2.action(), {
                spaceId: space.id,
                filter: "New",
                limit: 100,
                afterCursor: null,
            }).then(massageInboxEntriesQuery),
        ).toEqual([
            new InboxPostCommentsEntryModel({
                isArchived: false,
                spaceId: space.id,
                accountId: session2.account.id,
                postId: post.id,
                postAuthor: await session1.get(),
                channel: expect.any(ChannelPreviewModel),
                loudNotificationCount: 0,
                postCreatedTime: post.createdTime,
                postContentTextSnippetIfMentioned: null,
                latestComment: {
                    createdTime: comment9.createdTime,
                    author: await session1.get(),
                    contentTextSnippet: "Test comment 9",
                    isStickyMention: false,
                },
                otherCommentAuthor: null,
            }),
        ]);
    });

    test("if an account is removed from a space their inbox won't update anymore", async () => {
        const space = await TestSpace.create(context);

        const session1 = await space.createSession({hasInternalAccess: true});
        const session2 = await space.createSession();

        const channel = await TestChannel.create(session1);
        const post = await channel.createPost(session2);

        await expect(
            getInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {type: "PostComments", postId: post.id},
            }),
        ).rejects.toThrow(NotFoundError);

        await createPostComment(session1.action(), {
            postId: post.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test comment 1"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {type: "PostComments", postId: post.id},
            }),
        ).toEqual({
            key: expect.any(String),
            version: 1,
            model: expect.objectContaining({
                latestComment: expect.objectContaining({
                    contentTextSnippet: "Test comment 1",
                }),
            }),
        });

        await createPostComment(session1.action(), {
            postId: post.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test comment 2"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {type: "PostComments", postId: post.id},
            }),
        ).toEqual({
            key: expect.any(String),
            version: 2,
            model: expect.objectContaining({
                latestComment: expect.objectContaining({
                    contentTextSnippet: "Test comment 2",
                }),
            }),
        });

        await createPostComment(session1.action(), {
            postId: post.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test comment 3"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {type: "PostComments", postId: post.id},
            }),
        ).toEqual({
            key: expect.any(String),
            version: 3,
            model: expect.objectContaining({
                latestComment: expect.objectContaining({
                    contentTextSnippet: "Test comment 3",
                }),
            }),
        });

        await removeSpaceAccountAsAdmin(session1.action(), {
            spaceId: space.id,
            accountId: session2.account.id,
        });

        const spaceAccountsCache = getSpaceAccountsCacheForTest();
        spaceAccountsCache.clearForTest();

        await expect(
            getInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {type: "PostComments", postId: post.id},
            }),
        ).rejects.toThrow(PermissionDeniedError);

        await createPostComment(session1.action(), {
            postId: post.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test comment 4"),
        });

        await ProcessContextModule.waitForTestTasks();

        await expect(
            getInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {type: "PostComments", postId: post.id},
            }),
        ).rejects.toThrow(PermissionDeniedError);

        await createPostComment(session1.action(), {
            postId: post.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test comment 5"),
        });

        await ProcessContextModule.waitForTestTasks();

        await expect(
            getInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {type: "PostComments", postId: post.id},
            }),
        ).rejects.toThrow(PermissionDeniedError);

        await dangerouslyAddSpaceAccountAsAdmin(session1.action(), {
            spaceId: space.id,
            accountId: session2.account.id,
        });

        expect(
            await getInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {type: "PostComments", postId: post.id},
            }),
        ).toEqual({
            key: expect.any(String),
            version: 3,
            model: expect.objectContaining({
                latestComment: expect.objectContaining({
                    contentTextSnippet: "Test comment 3",
                }),
            }),
        });

        await createPostComment(session1.action(), {
            postId: post.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test comment 6"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {type: "PostComments", postId: post.id},
            }),
        ).toEqual({
            key: expect.any(String),
            version: 4,
            model: expect.objectContaining({
                latestComment: expect.objectContaining({
                    contentTextSnippet: "Test comment 6",
                }),
            }),
        });

        await createPostComment(session1.action(), {
            postId: post.id,
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test comment 7"),
        });

        await ProcessContextModule.waitForTestTasks();

        expect(
            await getInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {type: "PostComments", postId: post.id},
            }),
        ).toEqual({
            key: expect.any(String),
            version: 5,
            model: expect.objectContaining({
                latestComment: expect.objectContaining({
                    contentTextSnippet: "Test comment 7",
                }),
            }),
        });
    });
}
