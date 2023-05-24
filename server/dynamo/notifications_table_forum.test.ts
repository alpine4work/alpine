import {createChannel, createPost, createPostComment} from "~/server/dynamo/forum_table";
import {
    archiveInboxEntry,
    getInbox,
    getInboxChannelPostsEntryPosts,
    getInboxEntries,
    getInboxEntriesIndexForTest,
    notificationEventAfterProcessingTestCheckpoint,
    notificationEventBeforeProcessingTestCheckpoint,
    observeInbox,
    unarchiveInboxEntry,
} from "~/server/dynamo/notifications_table";
import {
    createNotificationsScenario,
    massageInboxEntriesQuery,
} from "~/server/dynamo/test_helpers/jest/notifications_table_test_helpers";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context";
import {emptyContentReferences} from "~/shared/content/content_references";
import {ProcessContextModule} from "~/shared/context/process_context_module";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error";
import {ChannelPreviewModel} from "~/shared/forum/channel_model";
import {
    PostContentProsemirrorSchema,
    assertPostContent,
    emptyPostContent,
} from "~/shared/forum/post_content_schema";
import {PostModel, emptyPostContentWithReferences} from "~/shared/forum/post_model";
import {createSimpleMessageContent} from "~/shared/messaging/message_content_schema";
import {
    InboxChannelPostsEntryModel,
    InboxModel,
    InboxPostCommentsEntryModel,
} from "~/shared/notifications/inbox_model";

const context = createTestContext();

test("commenting creates an inbox entry for all subscribers", async () => {
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment1"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment2.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment2"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: scenario.session2.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment2.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment2"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: scenario.session3.account,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
            },
            otherPostAuthor: null,
        }),
    ]);
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: scenario.mentionAccount3MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session3.account.id, scenario.session3.account],
                        ]),
                    },
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: scenario.mentionAccount3MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session3.account.id, scenario.session3.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment2.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: scenario.mentionAccount1MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session1.account.id, scenario.session1.account],
                        ]),
                    },
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment2.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: scenario.mentionAccount1MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session1.account.id, scenario.session1.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 2,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: scenario.mentionAccount1MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session1.account.id, scenario.session1.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: scenario.session2.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: scenario.mentionAccount1MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session1.account.id, scenario.session1.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment2.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment2"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: scenario.session2.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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

    expect(
        await getInboxEntries(context.action(scenario.sharedSession), {
            spaceId: scenario.space.id,
            filter: "New",
            limit: 100,
            afterCursor: null,
        }).then(massageInboxEntriesQuery),
    ).toEqual([
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.sharedSession.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.otherSpace.id,
            accountId: scenario.sharedSession.account.id,
            loudNotificationCount: 0,
            channel: otherChannel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.otherSession.account,
                createdTime: otherPost.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.sharedSession.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: scenario.mentionSharedAccountMessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.sharedSession.account.id, scenario.sharedSession.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.sharedSession.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.otherSpace.id,
            accountId: scenario.sharedSession.account.id,
            loudNotificationCount: 0,
            channel: otherChannel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.otherSession.account,
                createdTime: otherPost.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.sharedSession.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: scenario.mentionSharedAccountMessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.sharedSession.account.id, scenario.sharedSession.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.sharedSession.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.otherSpace.id,
            accountId: scenario.sharedSession.account.id,
            postId: otherPost.id,
            postAuthor: scenario.otherSession.account,
            channel: otherChannel,
            loudNotificationCount: 1,
            postCreatedTime: otherPost.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment2.createdTime,
                author: scenario.otherSession.account,
                contentSnippet: {
                    doc: scenario.mentionSharedAccountMessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.sharedSession.account.id, scenario.sharedSession.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.otherSpace.id,
            accountId: scenario.sharedSession.account.id,
            loudNotificationCount: 0,
            channel: otherChannel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.otherSession.account,
                createdTime: otherPost.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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

    expect(
        await getInboxEntries(context.action(scenario.session3), {
            spaceId: scenario.space.id,
            filter: "New",
            limit: 100,
            afterCursor: null,
        }).then(massageInboxEntriesQuery),
    ).toEqual([
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: scenario.mentionAccount3MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session3.account.id, scenario.session3.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: scenario.mentionAccount3MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session3.account.id, scenario.session3.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post.id,
            postAuthor: scenario.session2.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session2.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post.id,
            postAuthor: scenario.session2.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: scenario.session1.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post.id,
            postAuthor: scenario.session2.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session2.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post.id,
            postAuthor: scenario.session2.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: scenario.session1.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post.id,
            postAuthor: scenario.session2.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session2.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post.id,
            postAuthor: scenario.session2.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session2.account,
                createdTime: post.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment1"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment2.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: scenario.mentionAccount1MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session1.account.id, scenario.session1.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment1"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment2.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: scenario.mentionAccount1MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session1.account.id, scenario.session1.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment1"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment2.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: scenario.mentionAccount1MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session1.account.id, scenario.session1.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment4.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment4"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
    ]);

    const comment5 = await createPostComment(context.action(scenario.session2), {
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment5.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment5"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment4.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment4"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment6.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: scenario.mentionAccount1MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session1.account.id, scenario.session1.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment5.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment5"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment4.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment4"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
    ]);

    const comment7 = await createPostComment(context.action(scenario.session2), {
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment6.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: scenario.mentionAccount1MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session1.account.id, scenario.session1.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment7.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment7"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment4.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment4"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 2,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment8.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: scenario.mentionAccount1MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session1.account.id, scenario.session1.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment6.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: scenario.mentionAccount1MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session1.account.id, scenario.session1.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment4.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment4"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment1"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment2.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: scenario.mentionAccount1MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session1.account.id, scenario.session1.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment1"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment2.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: scenario.mentionAccount1MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session1.account.id, scenario.session1.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment1"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment2.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: scenario.mentionAccount1MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session1.account.id, scenario.session1.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment1"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post4.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post4.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment4.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment4"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment2.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: scenario.mentionAccount1MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session1.account.id, scenario.session1.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment1"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
    ]);

    const comment5 = await createPostComment(context.action(scenario.session2), {
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post4.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post4.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment4.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment4"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment5.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment5"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment1"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post4.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post4.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment4.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment4"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment5.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment5"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment6.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment6"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment1"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment7.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: scenario.mentionAccount1MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session1.account.id, scenario.session1.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post4.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post4.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment4.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment4"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment5.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment5"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment1"),
                    references: emptyContentReferences,
                },
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

    await createPostComment(context.action(scenario.session3), {
        postId: post1.id,
        parentCommentIndex: null,
        content: createSimpleMessageContent("comment2"),
    });

    const comment3 = await createPostComment(context.action(scenario.sharedSession), {
        postId: post1.id,
        parentCommentIndex: null,
        content: createSimpleMessageContent("comment3"),
    });

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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.sharedSession.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: scenario.session3.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment4.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.sharedSession.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: scenario.session3.account,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post2.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.sharedSession.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post2.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
            },
            otherPostAuthor: null,
        }),
    ]);

    await archiveInboxEntry(context.action(scenario.session3), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post1.id},
    });

    expect(
        await getInboxEntries(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            filter: "New",
            limit: 100,
            afterCursor: null,
        }).then(massageInboxEntriesQuery),
    ).toEqual([
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.sharedSession.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: scenario.session3.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment4.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.sharedSession.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: scenario.session3.account,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post2.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post2.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
            },
            otherPostAuthor: null,
        }),
    ]);

    await archiveInboxEntry(context.action(scenario.session2), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post2.id},
    });

    expect(
        await getInboxEntries(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            filter: "New",
            limit: 100,
            afterCursor: null,
        }).then(massageInboxEntriesQuery),
    ).toEqual([
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.sharedSession.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: scenario.session3.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.sharedSession.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: scenario.session3.account,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post2.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post2.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
            },
            otherPostAuthor: null,
        }),
    ]);

    await archiveInboxEntry(context.action(scenario.session2), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post1.id},
    });

    expect(
        await getInboxEntries(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            filter: "New",
            limit: 100,
            afterCursor: null,
        }).then(massageInboxEntriesQuery),
    ).toEqual([
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.sharedSession.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: scenario.session3.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post2.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post2.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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

    await createPostComment(context.action(scenario.session3), {
        postId: post1.id,
        parentCommentIndex: null,
        content: createSimpleMessageContent("comment2"),
    });

    const comment3 = await createPostComment(context.action(scenario.session1), {
        postId: post1.id,
        parentCommentIndex: null,
        content: createSimpleMessageContent("comment3"),
    });

    const comment4 = await createPostComment(context.action(scenario.session1), {
        postId: post2.id,
        parentCommentIndex: null,
        content: scenario.mentionAccount2MessageContent,
    });

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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment5.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment4.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: scenario.session3.account,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 3,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post3.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 3,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post3.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
            },
            otherPostAuthor: null,
        }),
    ]);

    await archiveInboxEntry(context.action(scenario.session3), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post1.id},
    });

    await archiveInboxEntry(context.action(scenario.session2), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post2.id},
    });

    await archiveInboxEntry(context.action(scenario.session2), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post1.id},
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
    ).toEqual([
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment5.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 3,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post3.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 3,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post3.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
            },
            otherPostAuthor: null,
        }),
    ]);

    await unarchiveInboxEntry(context.action(scenario.session3), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post1.id},
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
    ).toEqual([
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment5.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 3,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post3.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 3,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post3.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
            },
            otherPostAuthor: null,
        }),
    ]);

    await unarchiveInboxEntry(context.action(scenario.session2), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post2.id},
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
    ).toEqual([
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment4.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment5.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 3,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post3.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 3,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post3.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
            },
            otherPostAuthor: null,
        }),
    ]);

    await unarchiveInboxEntry(context.action(scenario.session2), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post1.id},
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
    ).toEqual([
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: scenario.session3.account,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment4.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment5.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 3,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post3.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 3,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post3.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
            },
            otherPostAuthor: null,
        }),
    ]);

    await unarchiveInboxEntry(context.action(scenario.session1), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post1.id},
    });

    expect(
        await getInboxEntries(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            filter: "New",
            limit: 100,
            afterCursor: null,
        }).then(massageInboxEntriesQuery),
    ).toEqual([
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: scenario.session3.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: scenario.session3.account,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment4.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment5.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 3,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post3.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 3,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post3.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
        archiveInboxEntry(context.action(scenario.otherSession), {
            spaceId: scenario.space.id,
            key: {type: "PostComments", postId: post.id},
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        unarchiveInboxEntry(context.action(scenario.otherSession), {
            spaceId: scenario.space.id,
            key: {type: "PostComments", postId: post.id},
        }),
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment1"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
    ]);

    await archiveInboxEntry(context.action(scenario.session1), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post.id},
    });

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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment2.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment2"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: scenario.mentionAccount1MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session1.account.id, scenario.session1.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
    ]);

    await archiveInboxEntry(context.action(scenario.session1), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post.id},
    });

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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment2.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment2"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment1"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
    ]);

    await archiveInboxEntry(context.action(scenario.session1), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post.id},
    });

    expect(
        await getInboxEntries(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            filter: "New",
            limit: 100,
            afterCursor: null,
        }).then(massageInboxEntriesQuery),
    ).toEqual([]);

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

    await unarchiveInboxEntry(context.action(scenario.session1), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post.id},
    });

    expect(
        await getInboxEntries(context.action(scenario.session1), {
            spaceId: scenario.space.id,
            filter: "New",
            limit: 100,
            afterCursor: null,
        }).then(massageInboxEntriesQuery),
    ).toEqual([
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment2.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment2"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: scenario.session2.account,
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
        (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id})).model,
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

    await archiveInboxEntry(context.action(scenario.session2), {
        spaceId: scenario.space.id,
        key: {type: "ChannelPosts", channelId: channel.id, bucketGeneration: 0},
    });

    expect(
        (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id})).model,
    ).toEqual(
        new InboxModel({
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            entryCount: 2,
            lastZeroEntryCountTime: null,
        }),
    );

    await archiveInboxEntry(context.action(scenario.session3), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post1.id},
    });

    await archiveInboxEntry(context.action(scenario.session3), {
        spaceId: scenario.space.id,
        key: {type: "ChannelPosts", channelId: channel.id, bucketGeneration: 0},
    });

    expect(
        (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id})).model,
    ).toEqual(
        new InboxModel({
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            entryCount: 0,
            lastZeroEntryCountTime: expect.any(Date),
        }),
    );

    await archiveInboxEntry(context.action(scenario.session2), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post2.id},
    });

    expect(
        (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id})).model,
    ).toEqual(
        new InboxModel({
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            entryCount: 0,
            lastZeroEntryCountTime: expect.any(Date),
        }),
    );

    await archiveInboxEntry(context.action(scenario.session2), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post1.id},
    });

    expect(
        (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id})).model,
    ).toEqual(
        new InboxModel({
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            entryCount: 0,
            lastZeroEntryCountTime: expect.any(Date),
        }),
    );

    await unarchiveInboxEntry(context.action(scenario.session3), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post1.id},
    });

    expect(
        (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id})).model,
    ).toEqual(
        new InboxModel({
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            entryCount: 1,
            lastZeroEntryCountTime: expect.any(Date),
        }),
    );

    await unarchiveInboxEntry(context.action(scenario.session2), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post2.id},
    });

    expect(
        (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id})).model,
    ).toEqual(
        new InboxModel({
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            entryCount: 1,
            lastZeroEntryCountTime: expect.any(Date),
        }),
    );

    await unarchiveInboxEntry(context.action(scenario.session2), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post1.id},
    });

    expect(
        (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id})).model,
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
        (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id})).model,
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

    const comment1 = await createPostComment(context.action(scenario.session2), {
        postId: post1.id,
        parentCommentIndex: null,
        content: createSimpleMessageContent("comment1"),
    });

    const comment2 = await createPostComment(context.action(scenario.session2), {
        postId: post2.id,
        parentCommentIndex: null,
        content: createSimpleMessageContent("comment2"),
    });

    await ProcessContextModule.waitForTestTasks();

    await archiveInboxEntry(context.action(scenario.session1), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post1.id},
    });

    const {archiveTime: archiveTime2} = await archiveInboxEntry(context.action(scenario.session1), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post2.id},
    });

    await ProcessContextModule.waitForTestTasks();

    const comment3 = await createPostComment(context.action(scenario.session2), {
        postId: post3.id,
        parentCommentIndex: null,
        content: createSimpleMessageContent("comment3"),
    });

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
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    channel,
                    postId: post6.id,
                    postAuthor: scenario.session1.account,
                    loudNotificationCount: 0,
                    postCreatedTime: post6.createdTime,
                    postContentSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment6.createdTime,
                        author: scenario.session2.account,
                        contentSnippet: {
                            doc: createSimpleMessageContent("comment6"),
                            references: emptyContentReferences,
                        },
                    },
                    otherCommentAuthor: null,
                }),
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 1,
                model: new InboxPostCommentsEntryModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    channel,
                    postId: post5.id,
                    postAuthor: scenario.session1.account,
                    loudNotificationCount: 0,
                    postCreatedTime: post5.createdTime,
                    postContentSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment5.createdTime,
                        author: scenario.session2.account,
                        contentSnippet: {
                            doc: createSimpleMessageContent("comment5"),
                            references: emptyContentReferences,
                        },
                    },
                    otherCommentAuthor: null,
                }),
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 1,
                model: new InboxPostCommentsEntryModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    channel,
                    postId: post4.id,
                    postAuthor: scenario.session1.account,
                    loudNotificationCount: 0,
                    postCreatedTime: post4.createdTime,
                    postContentSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: scenario.session2.account,
                        contentSnippet: {
                            doc: createSimpleMessageContent("comment4"),
                            references: emptyContentReferences,
                        },
                    },
                    otherCommentAuthor: null,
                }),
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 1,
                model: new InboxPostCommentsEntryModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    channel,
                    postId: post3.id,
                    postAuthor: scenario.session1.account,
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: scenario.session2.account,
                        contentSnippet: {
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        },
                    },
                    otherCommentAuthor: null,
                }),
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 2,
                model: new InboxPostCommentsEntryModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    channel,
                    postId: post2.id,
                    postAuthor: scenario.session1.account,
                    loudNotificationCount: 0,
                    postCreatedTime: post2.createdTime,
                    postContentSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: scenario.session2.account,
                        contentSnippet: {
                            doc: createSimpleMessageContent("comment2"),
                            references: emptyContentReferences,
                        },
                    },
                    otherCommentAuthor: null,
                }),
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 2,
                model: new InboxPostCommentsEntryModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    channel,
                    postId: post1.id,
                    postAuthor: scenario.session1.account,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: scenario.session2.account,
                        contentSnippet: {
                            doc: createSimpleMessageContent("comment1"),
                            references: emptyContentReferences,
                        },
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
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    channel,
                    postId: post4.id,
                    postAuthor: scenario.session1.account,
                    loudNotificationCount: 0,
                    postCreatedTime: post4.createdTime,
                    postContentSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: scenario.session2.account,
                        contentSnippet: {
                            doc: createSimpleMessageContent("comment4"),
                            references: emptyContentReferences,
                        },
                    },
                    otherCommentAuthor: null,
                }),
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 1,
                model: new InboxPostCommentsEntryModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    channel,
                    postId: post3.id,
                    postAuthor: scenario.session1.account,
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: scenario.session2.account,
                        contentSnippet: {
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        },
                    },
                    otherCommentAuthor: null,
                }),
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 2,
                model: new InboxPostCommentsEntryModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    channel,
                    postId: post2.id,
                    postAuthor: scenario.session1.account,
                    loudNotificationCount: 0,
                    postCreatedTime: post2.createdTime,
                    postContentSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: scenario.session2.account,
                        contentSnippet: {
                            doc: createSimpleMessageContent("comment2"),
                            references: emptyContentReferences,
                        },
                    },
                    otherCommentAuthor: null,
                }),
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 2,
                model: new InboxPostCommentsEntryModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    channel,
                    postId: post1.id,
                    postAuthor: scenario.session1.account,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: scenario.session2.account,
                        contentSnippet: {
                            doc: createSimpleMessageContent("comment1"),
                            references: emptyContentReferences,
                        },
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
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    channel,
                    postId: post3.id,
                    postAuthor: scenario.session1.account,
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: scenario.session2.account,
                        contentSnippet: {
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        },
                    },
                    otherCommentAuthor: null,
                }),
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 2,
                model: new InboxPostCommentsEntryModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    channel,
                    postId: post2.id,
                    postAuthor: scenario.session1.account,
                    loudNotificationCount: 0,
                    postCreatedTime: post2.createdTime,
                    postContentSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: scenario.session2.account,
                        contentSnippet: {
                            doc: createSimpleMessageContent("comment2"),
                            references: emptyContentReferences,
                        },
                    },
                    otherCommentAuthor: null,
                }),
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 2,
                model: new InboxPostCommentsEntryModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    channel,
                    postId: post1.id,
                    postAuthor: scenario.session1.account,
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: scenario.session2.account,
                        contentSnippet: {
                            doc: createSimpleMessageContent("comment1"),
                            references: emptyContentReferences,
                        },
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
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    channel,
                    postId: post6.id,
                    postAuthor: scenario.session1.account,
                    loudNotificationCount: 0,
                    postCreatedTime: post6.createdTime,
                    postContentSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment6.createdTime,
                        author: scenario.session2.account,
                        contentSnippet: {
                            doc: createSimpleMessageContent("comment6"),
                            references: emptyContentReferences,
                        },
                    },
                    otherCommentAuthor: null,
                }),
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 1,
                model: new InboxPostCommentsEntryModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    channel,
                    postId: post5.id,
                    postAuthor: scenario.session1.account,
                    loudNotificationCount: 0,
                    postCreatedTime: post5.createdTime,
                    postContentSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment5.createdTime,
                        author: scenario.session2.account,
                        contentSnippet: {
                            doc: createSimpleMessageContent("comment5"),
                            references: emptyContentReferences,
                        },
                    },
                    otherCommentAuthor: null,
                }),
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 1,
                model: new InboxPostCommentsEntryModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    channel,
                    postId: post4.id,
                    postAuthor: scenario.session1.account,
                    loudNotificationCount: 0,
                    postCreatedTime: post4.createdTime,
                    postContentSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: scenario.session2.account,
                        contentSnippet: {
                            doc: createSimpleMessageContent("comment4"),
                            references: emptyContentReferences,
                        },
                    },
                    otherCommentAuthor: null,
                }),
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 1,
                model: new InboxPostCommentsEntryModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    channel,
                    postId: post3.id,
                    postAuthor: scenario.session1.account,
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: scenario.session2.account,
                        contentSnippet: {
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        },
                    },
                    otherCommentAuthor: null,
                }),
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 2,
                model: new InboxPostCommentsEntryModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    channel,
                    postId: post2.id,
                    postAuthor: scenario.session1.account,
                    loudNotificationCount: 0,
                    postCreatedTime: post2.createdTime,
                    postContentSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: scenario.session2.account,
                        contentSnippet: {
                            doc: createSimpleMessageContent("comment2"),
                            references: emptyContentReferences,
                        },
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
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    channel,
                    postId: post6.id,
                    postAuthor: scenario.session1.account,
                    loudNotificationCount: 0,
                    postCreatedTime: post6.createdTime,
                    postContentSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment6.createdTime,
                        author: scenario.session2.account,
                        contentSnippet: {
                            doc: createSimpleMessageContent("comment6"),
                            references: emptyContentReferences,
                        },
                    },
                    otherCommentAuthor: null,
                }),
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 1,
                model: new InboxPostCommentsEntryModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    channel,
                    postId: post5.id,
                    postAuthor: scenario.session1.account,
                    loudNotificationCount: 0,
                    postCreatedTime: post5.createdTime,
                    postContentSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment5.createdTime,
                        author: scenario.session2.account,
                        contentSnippet: {
                            doc: createSimpleMessageContent("comment5"),
                            references: emptyContentReferences,
                        },
                    },
                    otherCommentAuthor: null,
                }),
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 1,
                model: new InboxPostCommentsEntryModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    channel,
                    postId: post4.id,
                    postAuthor: scenario.session1.account,
                    loudNotificationCount: 0,
                    postCreatedTime: post4.createdTime,
                    postContentSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: scenario.session2.account,
                        contentSnippet: {
                            doc: createSimpleMessageContent("comment4"),
                            references: emptyContentReferences,
                        },
                    },
                    otherCommentAuthor: null,
                }),
            },
            {
                cursor: expect.any(String),
                key: expect.any(String),
                version: 1,
                model: new InboxPostCommentsEntryModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    channel,
                    postId: post3.id,
                    postAuthor: scenario.session1.account,
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: scenario.session2.account,
                        contentSnippet: {
                            doc: createSimpleMessageContent("comment3"),
                            references: emptyContentReferences,
                        },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment2.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post2.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
            },
            otherPostAuthor: null,
        }),
    ]);

    await archiveInboxEntry(context.action(scenario.session2), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post2.id},
    });

    expect(
        await getInboxEntries(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            filter: "New",
            limit: 100,
            afterCursor: null,
        }).then(massageInboxEntriesQuery),
    ).toEqual([
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post2.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post2.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment2.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post2.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post2.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment3"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: scenario.session1.account,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post2.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment2.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 3,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post3.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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

    await archiveInboxEntry(context.action(scenario.session2), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post3.id},
    });

    expect(
        await getInboxEntries(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            filter: "New",
            limit: 100,
            afterCursor: null,
        }).then(massageInboxEntriesQuery),
    ).toEqual([
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment2.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 3,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post3.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
    ]);

    await archiveInboxEntry(context.action(scenario.session2), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post1.id},
    });

    expect(
        await getInboxEntries(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            filter: "New",
            limit: 100,
            afterCursor: null,
        }).then(massageInboxEntriesQuery),
    ).toEqual([
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment2.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 3,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post3.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
    ]);

    await archiveInboxEntry(context.action(scenario.session2), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post2.id},
    });

    expect(
        await getInboxEntries(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            filter: "New",
            limit: 100,
            afterCursor: null,
        }).then(massageInboxEntriesQuery),
    ).toEqual([
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 3,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post3.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment2.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment2.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 3,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post3.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment2.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 3,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post3.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment4.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("test"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: scenario.session1.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment2.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 3,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post3.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment5.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("test"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: scenario.session1.account,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment4.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("test"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: scenario.session1.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 3,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post3.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment6.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("test"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: scenario.session1.account,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment5.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("test"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: scenario.session1.account,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment4.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("test"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: scenario.session1.account,
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

    await archiveInboxEntry(context.action(scenario.session2), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post3.id},
    });

    await archiveInboxEntry(context.action(scenario.session2), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post1.id},
    });

    await archiveInboxEntry(context.action(scenario.session2), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post2.id},
    });

    expect(
        await getInboxEntries(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            filter: "Archive",
            limit: 100,
            afterCursor: null,
        }).then(massageInboxEntriesQuery),
    ).toEqual([
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment2.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
    ]);

    const comment4 = await createPostComment(context.action(scenario.session2), {
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment2.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment4.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment4"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: scenario.session1.account,
        }),
    ]);

    const comment5 = await createPostComment(context.action(scenario.session2), {
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment5.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment5"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: scenario.session1.account,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post1.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post1.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
            },
            otherCommentAuthor: null,
        }),
        new InboxPostCommentsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment4.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment4"),
                    references: emptyContentReferences,
                },
            },
            otherCommentAuthor: scenario.session1.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post2.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post2.createdTime,
            postContentSnippetIfMentioned: {
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
                        [scenario.session2.account.id, scenario.session2.account],
                    ]),
                },
            },
            latestComment: null,
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post3.createdTime,
                contentSnippet: {
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
                            [scenario.session3.account.id, scenario.session3.account],
                        ]),
                    },
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            postId: post3.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post3.createdTime,
            postContentSnippetIfMentioned: {
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
                        [scenario.session3.account.id, scenario.session3.account],
                    ]),
                },
            },
            latestComment: null,
            otherCommentAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post2.createdTime,
                contentSnippet: {
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
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: {
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
                        [scenario.session2.account.id, scenario.session2.account],
                    ]),
                },
            },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: {
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
                        [scenario.session2.account.id, scenario.session2.account],
                    ]),
                },
            },
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment1"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: {
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
                        [scenario.session2.account.id, scenario.session2.account],
                    ]),
                },
            },
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

    await archiveInboxEntry(context.action(scenario.session2), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post.id},
    });

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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: {
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
                        [scenario.session2.account.id, scenario.session2.account],
                    ]),
                },
            },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment1.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("comment1"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 2,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: {
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
                        [scenario.session2.account.id, scenario.session2.account],
                    ]),
                },
            },
            latestComment: {
                createdTime: comment.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 1,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
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

    await archiveInboxEntry(context.action(scenario.session2), {
        spaceId: scenario.space.id,
        key: {type: "PostComments", postId: post.id},
    });

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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: null,
            latestComment: {
                createdTime: comment.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            postId: post.id,
            postAuthor: scenario.session1.account,
            channel,
            loudNotificationCount: 0,
            postCreatedTime: post.createdTime,
            postContentSnippetIfMentioned: {
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
                        [scenario.session2.account.id, scenario.session2.account],
                    ]),
                },
            },
            latestComment: {
                createdTime: comment.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: scenario.mentionAccount2MessageContent,
                    references: {
                        ...emptyContentReferences,
                        accountById: new Map([
                            [scenario.session2.account.id, scenario.session2.account],
                        ]),
                    },
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel: channel1,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post1.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel: channel1,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post1.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.sharedSession.account.id,
            loudNotificationCount: 0,
            channel: channel1,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post1.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel: channel1,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post2.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel: channel1,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post2.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.sharedSession.account.id,
            loudNotificationCount: 0,
            channel: channel1,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post2.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            loudNotificationCount: 0,
            channel: channel1,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session2.account,
                createdTime: post3.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel: channel1,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post2.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel: channel1,
            bucketGeneration: 0,
            postCount: 3,
            postAuthorCount: 2,
            latestPost: {
                author: scenario.session2.account,
                createdTime: post3.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
            },
            otherPostAuthor: scenario.session1.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.sharedSession.account.id,
            loudNotificationCount: 0,
            channel: channel1,
            bucketGeneration: 0,
            postCount: 3,
            postAuthorCount: 2,
            latestPost: {
                author: scenario.session2.account,
                createdTime: post3.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
            },
            otherPostAuthor: scenario.session1.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            loudNotificationCount: 0,
            channel: channel2,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session2.account,
                createdTime: post4.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
            },
            otherPostAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            loudNotificationCount: 0,
            channel: channel1,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session2.account,
                createdTime: post3.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel: channel1,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post2.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel: channel2,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session2.account,
                createdTime: post4.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
            },
            otherPostAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            loudNotificationCount: 0,
            channel: channel1,
            bucketGeneration: 0,
            postCount: 3,
            postAuthorCount: 2,
            latestPost: {
                author: scenario.session2.account,
                createdTime: post3.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
            },
            otherPostAuthor: scenario.session1.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.sharedSession.account.id,
            loudNotificationCount: 0,
            channel: channel2,
            bucketGeneration: 0,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session2.account,
                createdTime: post4.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
            },
            otherPostAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.sharedSession.account.id,
            loudNotificationCount: 0,
            channel: channel1,
            bucketGeneration: 0,
            postCount: 3,
            postAuthorCount: 2,
            latestPost: {
                author: scenario.session2.account,
                createdTime: post3.createdTime,
                contentSnippet: {
                    doc: emptyPostContent,
                    references: emptyContentReferences,
                },
            },
            otherPostAuthor: scenario.session1.account,
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
        getInboxChannelPostsEntryPosts(context.action(scenario.otherSession), {
            spaceId: scenario.space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            limit: 100,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post2.createdTime,
                contentSnippet: emptyPostContentWithReferences,
            },
            otherPostAuthor: null,
        }),
    ]);

    expect(
        await getInboxChannelPostsEntryPosts(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            limit: 100,
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
                author: scenario.session1.account,
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
                author: scenario.session1.account,
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
        getInboxChannelPostsEntryPosts(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            channelId: channel.id,
            bucketGeneration: 4,
            limit: 100,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 2,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post3.createdTime,
                contentSnippet: emptyPostContentWithReferences,
            },
            otherPostAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post2.createdTime,
                contentSnippet: emptyPostContentWithReferences,
            },
            otherPostAuthor: null,
        }),
    ]);

    expect(
        await getInboxChannelPostsEntryPosts(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            limit: 100,
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
                author: scenario.session1.account,
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
                author: scenario.session1.account,
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
        await getInboxChannelPostsEntryPosts(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            channelId: channel.id,
            bucketGeneration: 2,
            limit: 100,
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
                author: scenario.session1.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 4,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post4.createdTime,
                contentSnippet: emptyPostContentWithReferences,
            },
            otherPostAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 2,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post3.createdTime,
                contentSnippet: emptyPostContentWithReferences,
            },
            otherPostAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post2.createdTime,
                contentSnippet: emptyPostContentWithReferences,
            },
            otherPostAuthor: null,
        }),
    ]);

    expect(
        await getInboxChannelPostsEntryPosts(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            limit: 100,
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
                author: scenario.session1.account,
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
                author: scenario.session1.account,
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
        await getInboxChannelPostsEntryPosts(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            channelId: channel.id,
            bucketGeneration: 2,
            limit: 100,
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
                author: scenario.session1.account,
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
        await getInboxChannelPostsEntryPosts(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            channelId: channel.id,
            bucketGeneration: 4,
            limit: 100,
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
                author: scenario.session1.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post2.createdTime,
                contentSnippet: emptyPostContentWithReferences,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 2,
            postCount: 1,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post3.createdTime,
                contentSnippet: emptyPostContentWithReferences,
            },
            otherPostAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post2.createdTime,
                contentSnippet: emptyPostContentWithReferences,
            },
            otherPostAuthor: null,
        }),
    ]);

    expect(
        await getInboxChannelPostsEntryPosts(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            limit: 100,
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
                author: scenario.session1.account,
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
                author: scenario.session1.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 2,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post4.createdTime,
                contentSnippet: emptyPostContentWithReferences,
            },
            otherPostAuthor: null,
        }),
        new InboxChannelPostsEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            loudNotificationCount: 0,
            channel,
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: scenario.session1.account,
                createdTime: post2.createdTime,
                contentSnippet: emptyPostContentWithReferences,
            },
            otherPostAuthor: null,
        }),
    ]);

    expect(
        await getInboxChannelPostsEntryPosts(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            limit: 100,
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
                author: scenario.session1.account,
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
                author: scenario.session1.account,
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
        await getInboxChannelPostsEntryPosts(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            channelId: channel.id,
            bucketGeneration: 2,
            limit: 100,
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
                author: scenario.session1.account,
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
                author: scenario.session1.account,
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
        author: scenario.session1.account,
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
        author: scenario.session1.account,
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
        author: scenario.session1.account,
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
        author: scenario.session1.account,
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
        author: scenario.session1.account,
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
        author: scenario.session1.account,
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
        author: scenario.session1.account,
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
        author: scenario.session1.account,
        content: emptyPostContentWithReferences,
        contentUpdatedTime: null,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    expect(
        await getInboxChannelPostsEntryPosts(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            limit: 100,
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
        await getInboxChannelPostsEntryPosts(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            limit: 4,
            afterPostId: null,
        }),
    ).toEqual({
        hasMorePosts: true,
        posts: [post8Model, post7Model, post6Model, post5Model],
    });

    expect(
        await getInboxChannelPostsEntryPosts(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            limit: 7,
            afterPostId: null,
        }),
    ).toEqual({
        hasMorePosts: true,
        posts: [post8Model, post7Model, post6Model, post5Model, post4Model, post3Model, post2Model],
    });

    expect(
        await getInboxChannelPostsEntryPosts(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            limit: 8,
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
        await getInboxChannelPostsEntryPosts(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            limit: 100,
            afterPostId: post5.id,
        }),
    ).toEqual({
        hasMorePosts: false,
        posts: [post4Model, post3Model, post2Model, post1Model],
    });

    expect(
        await getInboxChannelPostsEntryPosts(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            limit: 4,
            afterPostId: post5.id,
        }),
    ).toEqual({
        hasMorePosts: false,
        posts: [post4Model, post3Model, post2Model, post1Model],
    });

    expect(
        await getInboxChannelPostsEntryPosts(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            limit: 3,
            afterPostId: post5.id,
        }),
    ).toEqual({
        hasMorePosts: true,
        posts: [post4Model, post3Model, post2Model],
    });

    expect(
        await getInboxChannelPostsEntryPosts(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            limit: 4,
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
        getInboxChannelPostsEntryPosts(context.action(scenario.session2), {
            spaceId: scenario.space.id,
            channelId: channel.id,
            bucketGeneration: 0,
            limit: 4,
            afterPostId: post9.id,
        }),
    ).rejects.toThrow(NotFoundError);
});
