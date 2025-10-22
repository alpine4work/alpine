import {addMinutes, subMinutes} from "date-fns";
import {TestApnsContextModule} from "~/server/apns/apns_context_module.js";
import {printContentSingleLineTextSnippetForServer} from "~/server/content/print_content_single_line_text_snippet_for_server.js";
import {isServerActionContext} from "~/server/context/is_server_action_context.js";
import {getDocumentPreviewIfPossible} from "~/server/documents/data/documents_actions.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestLocalEdgeServiceContextModule} from "~/server/dynamo/test_helpers/test_local_edge_service_context_module.js";
import {subscribeToChannel} from "~/server/forum/data/subscribe_to_channel.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestPost} from "~/server/forum/test_helpers/test_post.js";
import {archiveInboxEntry} from "~/server/notifications/data/archive_inbox_entry.js";
import {getInbox} from "~/server/notifications/data/get_inbox.js";
import {getInboxChannelPostsEntryPosts} from "~/server/notifications/data/get_inbox_channel_posts_entry_posts.js";
import {
    backfillInboxEntries,
    getInboxEntries,
} from "~/server/notifications/data/get_inbox_entries.js";
import {getInboxEntry} from "~/server/notifications/data/get_inbox_entry.js";
import {InboxEntriesIndex} from "~/server/notifications/data/internal/inbox_table.js";
import {observeInbox} from "~/server/notifications/data/observe_inbox.js";
import {
    notificationEventAfterProcessingTestCheckpoint,
    notificationEventBeforeProcessingTestCheckpoint,
    notificationEventProcessingTestCounter,
    processNotificationEvent,
} from "~/server/notifications/data/process/process_notification_event.js";
import {
    createNotificationsScenario,
    createTestInboxModel,
    massageInboxEntriesQuery,
} from "~/server/notifications/data/test_helpers/notifications_table_test_helpers.js";
import {unarchiveInboxEntry} from "~/server/notifications/data/unarchive_inbox_entry.js";
import {
    acceptSpaceAccountInvite,
    addSpaceAccount,
    getSpaceAccountsCacheForTest,
    removeSpaceAccount,
} from "~/server/spaces/spaces_actions.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {NotFoundError, PermissionDeniedError, UnimplementedError} from "~/shared/error/error.js";
import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {
    assertPostContent,
    PostContentProsemirrorSchema as schema,
} from "~/shared/forum/post_content_schema.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
    createSimpleMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {
    InboxChannelPostsEntryModel,
    InboxPostCommentsEntryModel,
} from "~/shared/notifications/inbox_model.js";
import {MyAccountBroadcastInboxRealtimeEventTransactionSchema} from "~/shared/notifications/my_account_protocol.js";
import {parseSearchDynamicEntityId} from "~/shared/search/search_entity_id.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {generateServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";

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
    searchInjection: {
        getSearchMentionEntityIfPossible: async (context, spaceId, entityId) => {
            const entityIdObject = parseSearchDynamicEntityId(entityId);
            if (entityIdObject.type !== "Document") {
                throw new UnimplementedError(
                    quote`Loading search entity for ${entityIdObject.type} is unimplemented`,
                );
            }

            assert(isServerActionContext(context));

            const documentResult = await getDocumentPreviewIfPossible(
                context,
                entityIdObject.documentId,
            );
            if (!documentResult) return null;
            if (!documentResult.ok) return {isPrivate: true};

            return {
                isPrivate: false,
                entity: new SearchEntityModel({
                    id: entityId,
                    title: documentResult.value.getTitle(),
                    titleVersion: {type: "Integer", version: documentResult.value.version},
                    media: null,
                }),
            };
        },
    },
});

async function testGetInboxChannelPostsEntryPosts(
    ...args: Parameters<typeof getInboxChannelPostsEntryPosts>
) {
    const {hasMorePosts, posts} = await getInboxChannelPostsEntryPosts(...args);
    return {hasMorePosts, posts: posts.map(post => post.model)};
}

async function getPostContentTextSnippet(post: TestPost) {
    const {content} = await post.get();
    return printContentSingleLineTextSnippetForServer(content);
}

test("won’t create two inbox entries if inbox is observed between serial event processing", async () => {
    processingType = "TwiceSerially";

    const scenario = await createNotificationsScenario(context);

    const channel = await TestChannel.create(scenario.session2);

    await runAllPromises([
        subscribeToChannel(scenario.session1.action(), channel.id),
        subscribeToChannel(scenario.session2.action(), channel.id),
        subscribeToChannel(scenario.session3.action(), channel.id),
    ]);

    await channel.createPost(scenario.session1);
    await ProcessContextModule.waitForTestTasks();

    const pausePromise1 = notificationEventAfterProcessingTestCheckpoint.pauseForTest(
        scenario.session1.account.id,
    );

    const post2 = await channel.createPost(scenario.session1);

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
            channel: {isPrivate: false, channel: await channel.getPreview()},
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: await scenario.session1.get(),
                createdTime: post2.createdTime,
                contentTextSnippet: await getPostContentTextSnippet(post2),
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
            channel: {isPrivate: false, channel: await channel.getPreview()},
            bucketGeneration: 0,
            postCount: 2,
            postAuthorCount: 1,
            latestPost: {
                author: await scenario.session1.get(),
                createdTime: post2.createdTime,
                contentTextSnippet: await getPostContentTextSnippet(post2),
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

        test("posting creates an inbox entry for all subscribers", async () => {
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

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session1.action(), channel.id),
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post = await channel.createPost(scenario.session1);

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            const comment1 = await post.createComment(
                scenario.session2,
                createSimpleMessageContent("comment1"),
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment1",
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            const comment2 = await post.createComment(
                scenario.session3,
                createSimpleMessageContent("comment2"),
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: "comment2",
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: "comment2",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            const comment3 = await post.createComment(
                scenario.session1,
                createSimpleMessageContent("comment3"),
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "comment3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session3.get(),
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "comment3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            // Make sure multiple processing is working.
            expect(getCount1()).toEqual(2 * processingMultiple);
            expect(getCount2()).toEqual(1 * processingMultiple);
            expect(getCount3()).toEqual(1 * processingMultiple);
        });

        test("posting creates an inbox entry for all subscribers unless a subscriber has lost access", async () => {
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

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session1.action(), channel.id),
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post = await channel.createPost(scenario.session3);

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session3.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session3.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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
            ).toEqual([]);

            await channel.access.revokeDefault(scenario.session1);
            await channel.access.grant(scenario.session1, scenario.session2);

            await post.createComment(scenario.session2, createSimpleMessageContent("comment1"));

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session3.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session3.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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
            ).toEqual([]);

            const comment2 = await post.createComment(
                scenario.session1,
                createSimpleMessageContent("comment2"),
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session3.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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
                    postAuthor: await scenario.session3.get(),
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "comment2",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session3.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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
            ).toEqual([]);

            await channel.access.grant(scenario.session1, scenario.session3);

            const comment3 = await post.createComment(
                scenario.session1,
                createSimpleMessageContent("comment3"),
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session3.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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
                    postAuthor: await scenario.session3.get(),
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "comment3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session3.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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
                    postAuthor: await scenario.session3.get(),
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "comment3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            // Make sure multiple processing is working.
            expect(getCount1()).toEqual(2 * processingMultiple);
            expect(getCount2()).toEqual(1 * processingMultiple);
            expect(getCount3()).toEqual(1 * processingMultiple);
        });

        test("can get individual inbox entries", async () => {
            const scenario = await createNotificationsScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session1.action(), channel.id),
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post = await channel.createPost(scenario.session1);

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
                    },
                    otherPostAuthor: null,
                }),
            });
        });

        test("mentioning someone in a post a creates a loud notification for them whether or not they are a subscriber", async () => {
            const scenario = await createNotificationsScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session1.action(), channel.id),
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post = await channel.createPost(scenario.session1);

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            const comment1 = await post.createComment(
                scenario.session2,
                scenario.mentionAccount3MessageContent,
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            const comment2 = await post.createComment(
                scenario.session2,
                scenario.mentionAccount1MessageContent,
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            const comment3 = await post.createComment(
                scenario.session3,
                scenario.mentionAccount1MessageContent,
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 2,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
                    },
                    otherPostAuthor: null,
                }),
            ]);
        });

        test("mentioning yourself does not create a loud notification for yourself", async () => {
            const scenario = await createNotificationsScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session1.action(), channel.id),
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post = await channel.createPost(scenario.session1);

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            const comment1 = await post.createComment(
                scenario.session2,
                scenario.mentionAccount2MessageContent,
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            const comment2 = await post.createComment(
                scenario.session1,
                createSimpleMessageContent("comment2"),
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "comment2",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            const comment3 = await post.createComment(
                scenario.session2,
                scenario.mentionAccount2MessageContent,
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
                    },
                    otherPostAuthor: null,
                }),
            ]);
        });

        test("accounts have separate inboxes for each space", async () => {
            const scenario = await createNotificationsScenario(context);

            const channel = await TestChannel.create(scenario.session1);
            const otherChannel = await TestChannel.create(scenario.otherSession);

            await runAllPromises([
                subscribeToChannel(scenario.sharedSession.action(), channel.id),
                subscribeToChannel(scenario.sharedSession.action(), otherChannel.id),
            ]);

            const post = await channel.createPost(scenario.session1);
            const otherPost = await otherChannel.createPost(scenario.otherSession);

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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
                    channel: {isPrivate: false, channel: await otherChannel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.otherSession.get(),
                        createdTime: otherPost.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(otherPost),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            const comment1 = await post.createComment(
                scenario.session2,
                scenario.mentionSharedAccountMessageContent,
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.sharedSession.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.sharedSession.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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
                    channel: {isPrivate: false, channel: await otherChannel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.otherSession.get(),
                        createdTime: otherPost.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(otherPost),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            const comment2 = await otherPost.createComment(
                scenario.otherSession,
                scenario.mentionSharedAccountMessageContent,
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.sharedSession.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.sharedSession.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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
                    channel: {isPrivate: false, channel: await otherChannel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: otherPost.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.otherSession.get(),
                        contentTextSnippet: `Hello ${scenario.sharedSession.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.otherSpace.id,
                    accountId: scenario.sharedSession.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await otherChannel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.otherSession.get(),
                        createdTime: otherPost.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(otherPost),
                    },
                    otherPostAuthor: null,
                }),
            ]);
        });

        test("account can not see mention in a different space", async () => {
            const scenario = await createNotificationsScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post = await channel.createPost(scenario.session1);

            const otherChannel = await TestChannel.create(scenario.otherSession);

            const otherPost = await otherChannel.createPost(scenario.otherSession);

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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

            const comment1 = await post.createComment(
                scenario.session2,
                scenario.mentionAccount3MessageContent,
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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

            await otherPost.createComment(
                scenario.otherSession,
                scenario.mentionAccount3MessageContent,
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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

            const channel = await TestChannel.create(scenario.session2);

            await runAllPromises([
                subscribeToChannel(scenario.session1.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post = await channel.createPost(scenario.session2);

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

            await post.createComment(scenario.session1, createSimpleMessageContent("comment1"));

            await ProcessContextModule.waitForTestTasks();

            const pause1Promise = notificationEventBeforeProcessingTestCheckpoint.pauseForTest(
                scenario.session1.account.id,
            );
            const pause2Promise = notificationEventAfterProcessingTestCheckpoint.pauseForTest(
                scenario.session3.account.id,
            );

            await post.createComment(scenario.session1, scenario.mentionAccount2MessageContent);

            const comment3 = await post.createComment(
                scenario.session3,
                createSimpleMessageContent("comment3"),
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: "comment3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: "comment3",
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: "comment3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: "comment3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session1.get(),
                }),
            ]);
        });

        test("comment notification events processed out of order result in the same latest comment including implicit archival states", async () => {
            const scenario = await createNotificationsScenario(context);

            const channel = await TestChannel.create(scenario.session2);

            await runAllPromises([
                subscribeToChannel(scenario.session1.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post = await channel.createPost(scenario.session2);

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

            await post.createComment(scenario.session1, createSimpleMessageContent("comment1"));

            await ProcessContextModule.waitForTestTasks();

            const pause1Promise = notificationEventBeforeProcessingTestCheckpoint.pauseForTest(
                scenario.session1.account.id,
            );
            const pause2Promise = notificationEventAfterProcessingTestCheckpoint.pauseForTest(
                scenario.session2.account.id,
            );

            await post.createComment(scenario.session1, scenario.mentionAccount2MessageContent);

            const comment3 = await post.createComment(
                scenario.session2,
                createSimpleMessageContent("comment3"),
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post),
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

            const channel = await TestChannel.create(scenario.session1);

            const post1 = await channel.createPost(scenario.session1);

            const post2 = await channel.createPost(scenario.session1);

            const post3 = await channel.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const comment1 = await post1.createComment(
                scenario.session2,
                createSimpleMessageContent("comment1"),
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment1",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const comment2 = await post2.createComment(
                scenario.session2,
                scenario.mentionAccount1MessageContent,
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment1",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const comment3 = await post3.createComment(
                scenario.session2,
                createSimpleMessageContent("comment3"),
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment3",
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment1",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const comment4 = await post1.createComment(
                scenario.session2,
                createSimpleMessageContent("comment4"),
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment3",
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment4",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await post2.createComment(scenario.session2, createSimpleMessageContent("comment5"));

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment3",
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment4",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const comment6 = await post3.createComment(
                scenario.session2,
                scenario.mentionAccount1MessageContent,
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment6.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment4",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await post2.createComment(scenario.session2, createSimpleMessageContent("comment7"));

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment6.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment4",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const comment8 = await post2.createComment(
                scenario.session2,
                scenario.mentionAccount1MessageContent,
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 2,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment8.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment6.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment4",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("can not observe inbox in a space you don’t have access to", async () => {
            const scenario = await createNotificationsScenario(context);

            await expect(
                observeInbox(context.action(scenario.session1), {spaceId: scenario.otherSpace.id}),
            ).rejects.toThrow(PermissionDeniedError);
        });

        test("observing an inbox freezes loud notifications in place", async () => {
            const scenario = await createNotificationsScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            const post1 = await channel.createPost(scenario.session1);

            const post2 = await channel.createPost(scenario.session1);

            const post3 = await channel.createPost(scenario.session1);

            const post4 = await channel.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const comment1 = await post1.createComment(
                scenario.session2,
                createSimpleMessageContent("comment1"),
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment1",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const comment2 = await post2.createComment(
                scenario.session2,
                scenario.mentionAccount1MessageContent,
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment1",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const comment3 = await post3.createComment(
                scenario.session2,
                createSimpleMessageContent("comment3"),
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment3",
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment1",
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment3",
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment1",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const comment4 = await post4.createComment(
                scenario.session2,
                createSimpleMessageContent("comment4"),
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post4.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment4",
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment3",
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment1",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await post2.createComment(scenario.session2, createSimpleMessageContent("comment5"));

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post4.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment4",
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment3",
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment1",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const comment6 = await post3.createComment(
                scenario.session2,
                createSimpleMessageContent("comment6"),
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post4.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment4",
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment6.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment6",
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment1",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const comment7 = await post3.createComment(
                scenario.session2,
                scenario.mentionAccount1MessageContent,
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment7.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post4.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment4",
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment1",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("can archive inbox entries", async () => {
            const scenario = await createNotificationsScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post1 = await channel.createPost(scenario.session1);

            const post2 = await channel.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            await post1.createComment(scenario.session2, createSimpleMessageContent("comment1"));

            await ProcessContextModule.waitForTestTasks();

            await post1.createComment(scenario.session3, createSimpleMessageContent("comment2"));

            await ProcessContextModule.waitForTestTasks();

            const comment3 = await post1.createComment(
                scenario.sharedSession,
                createSimpleMessageContent("comment3"),
            );

            await ProcessContextModule.waitForTestTasks();

            const comment4 = await post2.createComment(
                scenario.session1,
                scenario.mentionAccount2MessageContent,
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.sharedSession.get(),
                        contentTextSnippet: "comment3",
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.sharedSession.get(),
                        contentTextSnippet: "comment3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session3.get(),
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post2),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.sharedSession.get(),
                        contentTextSnippet: "comment3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post2),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.sharedSession.get(),
                        contentTextSnippet: "comment3",
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.sharedSession.get(),
                        contentTextSnippet: "comment3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session3.get(),
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post2),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post2),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.sharedSession.get(),
                        contentTextSnippet: "comment3",
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.sharedSession.get(),
                        contentTextSnippet: "comment3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session3.get(),
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post2),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post2),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.sharedSession.get(),
                        contentTextSnippet: "comment3",
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post2),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post2),
                    },
                    otherPostAuthor: null,
                }),
            ]);
        });

        test("can unarchive inbox entries", async () => {
            const scenario = await createNotificationsScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post1 = await channel.createPost(scenario.session1);

            const post2 = await channel.createPost(scenario.session1);

            const post3 = await channel.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            await post1.createComment(scenario.session2, createSimpleMessageContent("comment1"));

            await ProcessContextModule.waitForTestTasks();

            const comment2 = await post1.createComment(
                scenario.session3,
                createSimpleMessageContent("comment2"),
            );

            await ProcessContextModule.waitForTestTasks();

            const comment3 = await post1.createComment(
                scenario.session1,
                createSimpleMessageContent("comment3"),
            );

            await ProcessContextModule.waitForTestTasks();

            const comment4 = await post2.createComment(
                scenario.session1,
                scenario.mentionAccount2MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            const comment5 = await post3.createComment(
                scenario.session1,
                scenario.mentionAccount2MessageContent,
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment5.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "comment3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: await scenario.session3.get(),
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "comment3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment5.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment5.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "comment3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment5.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "comment3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "comment3",
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment5.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "comment3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: "comment2",
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
                    postId: post1.id,
                    postAuthor: await scenario.session1.get(),
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "comment3",
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment5.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "comment3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
                    },
                    otherPostAuthor: null,
                }),
            ]);
        });

        test("can not archive or unarchive inbox entries in a space you don’t have access to", async () => {
            const scenario = await createNotificationsScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            const post = await channel.createPost(scenario.session1);

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

            const channel = await TestChannel.create(scenario.session1);

            const post = await channel.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const comment1 = await post.createComment(
                scenario.session2,
                createSimpleMessageContent("comment1"),
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment1",
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

            const comment2 = await post.createComment(
                scenario.session2,
                createSimpleMessageContent("comment2"),
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment2",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("notification on an archived entry revives it clearing old loud notification count", async () => {
            const scenario = await createNotificationsScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            const post = await channel.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const comment1 = await post.createComment(
                scenario.session2,
                scenario.mentionAccount1MessageContent,
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
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

            const comment2 = await post.createComment(
                scenario.session2,
                createSimpleMessageContent("comment2"),
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment2",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("notification on an archived entry from own account does not revive it", async () => {
            const scenario = await createNotificationsScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            const post = await channel.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const comment1 = await post.createComment(
                scenario.session2,
                createSimpleMessageContent("comment1"),
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment1",
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

            await post.createComment(scenario.session1, createSimpleMessageContent("comment2"));

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "comment1",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("can not get inbox in a space you don’t have access to", async () => {
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
                createTestInboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                }),
            );
        });

        test("getting an inbox returns the current loud notification count", async () => {
            const scenario = await createNotificationsScenario(context);

            expect(
                (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                createTestInboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                createTestInboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                createTestInboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                }),
            );

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post1 = await channel.createPost(scenario.session1);

            const post2 = await channel.createPost(scenario.session1);

            const post3 = await channel.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            expect(
                (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                createTestInboxModel({
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
                createTestInboxModel({
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
                createTestInboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    entryCount: 1,
                    lastZeroEntryCountTime: null,
                }),
            );

            await post1.createComment(scenario.session2, createSimpleMessageContent("comment1"));

            await ProcessContextModule.waitForTestTasks();

            expect(
                (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                createTestInboxModel({
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
                createTestInboxModel({
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
                createTestInboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    entryCount: 1,
                    lastZeroEntryCountTime: null,
                }),
            );

            await post1.createComment(scenario.session3, createSimpleMessageContent("comment2"));

            await ProcessContextModule.waitForTestTasks();

            expect(
                (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                createTestInboxModel({
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
                createTestInboxModel({
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
                createTestInboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    entryCount: 1,
                    lastZeroEntryCountTime: null,
                }),
            );

            await post1.createComment(scenario.session2, createSimpleMessageContent("comment3"));

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
                createTestInboxModel({
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
                createTestInboxModel({
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
                createTestInboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    entryCount: 2,
                    lastZeroEntryCountTime: null,
                }),
            );

            await post2.createComment(scenario.session1, scenario.mentionAccount2MessageContent);

            await ProcessContextModule.waitForTestTasks();

            expect(
                (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                createTestInboxModel({
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
                createTestInboxModel({
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
                createTestInboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    entryCount: 2,
                    lastZeroEntryCountTime: null,
                }),
            );

            await post3.createComment(scenario.session1, scenario.mentionAccount2MessageContent);

            await ProcessContextModule.waitForTestTasks();

            expect(
                (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                createTestInboxModel({
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
                createTestInboxModel({
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
                createTestInboxModel({
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
                createTestInboxModel({
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
                createTestInboxModel({
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
                createTestInboxModel({
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
                createTestInboxModel({
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
                createTestInboxModel({
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
                createTestInboxModel({
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
                createTestInboxModel({
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
                createTestInboxModel({
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
                createTestInboxModel({
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
                createTestInboxModel({
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
                createTestInboxModel({
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
                createTestInboxModel({
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
                createTestInboxModel({
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
                createTestInboxModel({
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
                createTestInboxModel({
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
                createTestInboxModel({
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
                createTestInboxModel({
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
                createTestInboxModel({
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

            const channel = await TestChannel.create(scenario.session1);

            const post1 = await channel.createPost(scenario.session1);

            const post2 = await channel.createPost(scenario.session1);

            const post3 = await channel.createPost(scenario.session1);

            const post4 = await channel.createPost(scenario.session1);

            const post5 = await channel.createPost(scenario.session1);

            const post6 = await channel.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            const comment1 = await post1.createComment(
                scenario.session2,
                createSimpleMessageContent("comment1"),
            );

            await ProcessContextModule.waitForTestTasks();

            const comment2 = await post2.createComment(
                scenario.session2,
                createSimpleMessageContent("comment2"),
            );

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

            const comment3 = await post3.createComment(
                scenario.session2,
                createSimpleMessageContent("comment3"),
            );

            await ProcessContextModule.waitForTestTasks();

            const comment4 = await post4.createComment(
                scenario.session2,
                createSimpleMessageContent("comment4"),
            );

            await ProcessContextModule.waitForTestTasks();

            await observeInbox(context.action(scenario.session1), {spaceId: scenario.space.id});

            await ProcessContextModule.waitForTestTasks();

            const comment5 = await post5.createComment(
                scenario.session2,
                createSimpleMessageContent("comment5"),
            );

            await ProcessContextModule.waitForTestTasks();

            const comment6 = await post6.createComment(
                scenario.session2,
                createSimpleMessageContent("comment6"),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(
                await InboxEntriesIndex.realtimeQuery(context.action(scenario.session1), {
                    partitionKey: {
                        spaceId: scenario.space.id,
                        accountId: scenario.session1.account.id,
                    },
                    limit: "All",
                }),
            ).toEqual({
                checkpoint: expect.any(Date),
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
                            channel: {isPrivate: false, channel: await channel.getPreview()},
                            postId: post6.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post6.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment6.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: "comment6",
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
                            channel: {isPrivate: false, channel: await channel.getPreview()},
                            postId: post5.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post5.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment5.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: "comment5",
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
                            channel: {isPrivate: false, channel: await channel.getPreview()},
                            postId: post4.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post4.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment4.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: "comment4",
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
                            channel: {isPrivate: false, channel: await channel.getPreview()},
                            postId: post3.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post3.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment3.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: "comment3",
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
                            channel: {isPrivate: false, channel: await channel.getPreview()},
                            postId: post2.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post2.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment2.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: "comment2",
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
                            channel: {isPrivate: false, channel: await channel.getPreview()},
                            postId: post1.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post1.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment1.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: "comment1",
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
                checkpoint: expect.any(Date),
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
                            channel: {isPrivate: false, channel: await channel.getPreview()},
                            postId: post4.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post4.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment4.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: "comment4",
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
                            channel: {isPrivate: false, channel: await channel.getPreview()},
                            postId: post3.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post3.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment3.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: "comment3",
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
                            channel: {isPrivate: false, channel: await channel.getPreview()},
                            postId: post2.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post2.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment2.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: "comment2",
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
                            channel: {isPrivate: false, channel: await channel.getPreview()},
                            postId: post1.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post1.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment1.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: "comment1",
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
                checkpoint: expect.any(Date),
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
                            channel: {isPrivate: false, channel: await channel.getPreview()},
                            postId: post3.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post3.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment3.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: "comment3",
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
                            channel: {isPrivate: false, channel: await channel.getPreview()},
                            postId: post2.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post2.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment2.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: "comment2",
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
                            channel: {isPrivate: false, channel: await channel.getPreview()},
                            postId: post1.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post1.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment1.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: "comment1",
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
                checkpoint: expect.any(Date),
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
                            channel: {isPrivate: false, channel: await channel.getPreview()},
                            postId: post6.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post6.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment6.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: "comment6",
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
                            channel: {isPrivate: false, channel: await channel.getPreview()},
                            postId: post5.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post5.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment5.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: "comment5",
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
                            channel: {isPrivate: false, channel: await channel.getPreview()},
                            postId: post4.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post4.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment4.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: "comment4",
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
                            channel: {isPrivate: false, channel: await channel.getPreview()},
                            postId: post3.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post3.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment3.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: "comment3",
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
                            channel: {isPrivate: false, channel: await channel.getPreview()},
                            postId: post2.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post2.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment2.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: "comment2",
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
                checkpoint: expect.any(Date),
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
                            channel: {isPrivate: false, channel: await channel.getPreview()},
                            postId: post6.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post6.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment6.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: "comment6",
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
                            channel: {isPrivate: false, channel: await channel.getPreview()},
                            postId: post5.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post5.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment5.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: "comment5",
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
                            channel: {isPrivate: false, channel: await channel.getPreview()},
                            postId: post4.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post4.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment4.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: "comment4",
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
                            channel: {isPrivate: false, channel: await channel.getPreview()},
                            postId: post3.id,
                            postAuthor: await scenario.session1.get(),
                            loudNotificationCount: 0,
                            postCreatedTime: post3.createdTime,
                            postContentTextSnippetIfMentioned: null,
                            latestComment: {
                                createdTime: comment3.createdTime,
                                author: await scenario.session2.get(),
                                contentTextSnippet: "comment3",
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

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post1 = await channel.createPost(scenario.session1);

            const post2 = await channel.createPost(scenario.session1);

            const comment1 = await post1.createComment(
                scenario.session1,
                scenario.mentionAccount2MessageContent,
            );

            const comment2 = await post2.createComment(
                scenario.session1,
                scenario.mentionAccount2MessageContent,
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post2),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post2),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            const comment3 = await post2.createComment(
                scenario.session1,
                createSimpleMessageContent("comment3"),
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "comment3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post2),
                    },
                    otherPostAuthor: null,
                }),
            ]);
        });

        test("implicitly archiving an entry with loud notifications puts it back at the inbox generation", async () => {
            const scenario = await createNotificationsScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post1 = await channel.createPost(scenario.session1);

            const post2 = await channel.createPost(scenario.session1);

            const comment1 = await post1.createComment(
                scenario.session1,
                scenario.mentionAccount2MessageContent,
            );

            const comment2 = await post2.createComment(
                scenario.session1,
                scenario.mentionAccount2MessageContent,
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post2),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            await post2.createComment(scenario.session2, createSimpleMessageContent("test"));

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post2),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            const comment3 = await post2.createComment(
                scenario.session1,
                createSimpleMessageContent("comment3"),
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "comment3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post2),
                    },
                    otherPostAuthor: null,
                }),
            ]);
        });

        test("archived entries are in the order they were archived", async () => {
            const scenario = await createNotificationsScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post1 = await channel.createPost(scenario.session1);

            const post2 = await channel.createPost(scenario.session1);

            const post3 = await channel.createPost(scenario.session1);

            const comment1 = await post1.createComment(
                scenario.session1,
                scenario.mentionAccount2MessageContent,
            );

            const comment2 = await post2.createComment(
                scenario.session1,
                scenario.mentionAccount2MessageContent,
            );

            const comment3 = await post3.createComment(
                scenario.session1,
                scenario.mentionAccount2MessageContent,
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("implicitly archived entries are in the order they were archived", async () => {
            const scenario = await createNotificationsScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post1 = await channel.createPost(scenario.session1);

            const post2 = await channel.createPost(scenario.session1);

            const post3 = await channel.createPost(scenario.session1);

            const comment1 = await post1.createComment(
                scenario.session1,
                scenario.mentionAccount2MessageContent,
            );

            const comment2 = await post2.createComment(
                scenario.session1,
                scenario.mentionAccount2MessageContent,
            );

            const comment3 = await post3.createComment(
                scenario.session1,
                scenario.mentionAccount2MessageContent,
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
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

            await post3.createComment(scenario.session2, createSimpleMessageContent("test"));

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await post1.createComment(scenario.session2, createSimpleMessageContent("test"));

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await post2.createComment(scenario.session2, createSimpleMessageContent("test"));

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("archive entry order does not change when it updates", async () => {
            const scenario = await createNotificationsScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            const post1 = await channel.createPost(scenario.session1);

            const post2 = await channel.createPost(scenario.session1);

            const post3 = await channel.createPost(scenario.session1);

            const comment1 = await post1.createComment(
                scenario.session1,
                scenario.mentionAccount2MessageContent,
            );

            const comment2 = await post2.createComment(
                scenario.session1,
                scenario.mentionAccount2MessageContent,
            );

            const comment3 = await post3.createComment(
                scenario.session1,
                scenario.mentionAccount2MessageContent,
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await post3.createComment(scenario.session2, createSimpleMessageContent("comment4"));

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await post2.createComment(scenario.session2, createSimpleMessageContent("comment5"));

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post1.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("mentioning in a post creates an entry for the mentioned account", async () => {
            const scenario = await createNotificationsScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            await channel.createPost(
                scenario.session1,
                assertPostContent(
                    schema.node("doc", {}, [
                        schema.node("paragraph", {}, [
                            schema.text("Hello "),
                            schema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: scenario.session1.account.id,
                                    isShort: false,
                                }),
                            }),
                            schema.text("!"),
                        ]),
                    ]),
                ),
            );

            const post2 = await channel.createPost(
                scenario.session1,
                assertPostContent(
                    schema.node("doc", {}, [
                        schema.node("paragraph", {}, [
                            schema.text("Hello "),
                            schema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: scenario.session2.account.id,
                                    isShort: false,
                                }),
                            }),
                            schema.text("!"),
                        ]),
                    ]),
                ),
            );

            const post3 = await channel.createPost(
                scenario.session1,
                assertPostContent(
                    schema.node("doc", {}, [
                        schema.node("paragraph", {}, [
                            schema.text("Hello "),
                            schema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: scenario.session3.account.id,
                                    isShort: false,
                                }),
                            }),
                            schema.text("!"),
                        ]),
                    ]),
                ),
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post2.createdTime,
                    postContentTextSnippetIfMentioned: `Hello ${scenario.session2.account.initialName}!`,
                    latestComment: null,
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post3.createdTime,
                    postContentTextSnippetIfMentioned: `Hello ${scenario.session3.account.initialName}!`,
                    latestComment: null,
                    otherCommentAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post2),
                    },
                    otherPostAuthor: null,
                }),
            ]);
        });

        test("commenting on a post someone was mentioned on updates an entry for the mentioned account", async () => {
            const scenario = await createNotificationsScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post = await channel.createPost(
                scenario.session1,
                assertPostContent(
                    schema.node("doc", {}, [
                        schema.node("paragraph", {}, [
                            schema.text("Hello "),
                            schema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: scenario.session2.account.id,
                                    isShort: false,
                                }),
                            }),
                            schema.text("!"),
                        ]),
                    ]),
                ),
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: `Hello ${scenario.session2.account.initialName}!`,
                    latestComment: null,
                    otherCommentAuthor: null,
                }),
            ]);

            const comment1 = await post.createComment(
                scenario.session3,
                createSimpleMessageContent("comment1"),
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: `Hello ${scenario.session2.account.initialName}!`,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: "comment1",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("commenting on a post revives an archived entry someone was mentioned on", async () => {
            const scenario = await createNotificationsScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post = await channel.createPost(
                scenario.session1,
                assertPostContent(
                    schema.node("doc", {}, [
                        schema.node("paragraph", {}, [
                            schema.text("Hello "),
                            schema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: scenario.session2.account.id,
                                    isShort: false,
                                }),
                            }),
                            schema.text("!"),
                        ]),
                    ]),
                ),
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: `Hello ${scenario.session2.account.initialName}!`,
                    latestComment: null,
                    otherCommentAuthor: null,
                }),
            ]);

            const comment1 = await post.createComment(
                scenario.session3,
                createSimpleMessageContent("comment1"),
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment1.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: "comment1",
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

            const channel = await TestChannel.create(scenario.session2);

            const pause1Promise = notificationEventBeforeProcessingTestCheckpoint.pauseForTest(
                scenario.session1.account.id,
            );
            const pause2Promise = notificationEventAfterProcessingTestCheckpoint.pauseForTest(
                scenario.session3.account.id,
            );

            const post = await channel.createPost(
                scenario.session1,
                assertPostContent(
                    schema.node("doc", {}, [
                        schema.node("paragraph", {}, [
                            schema.text("Hello "),
                            schema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: scenario.session2.account.id,
                                    isShort: false,
                                }),
                            }),
                            schema.text("!"),
                        ]),
                    ]),
                ),
            );

            const comment = await post.createComment(
                scenario.session3,
                scenario.mentionAccount2MessageContent,
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 2,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: `Hello ${scenario.session2.account.initialName}!`,
                    latestComment: {
                        createdTime: comment.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("post with mention create event processed after comment event and after entry was archived", async () => {
            const scenario = await createNotificationsScenario(context);

            const channel = await TestChannel.create(scenario.session2);

            const pause1Promise = notificationEventBeforeProcessingTestCheckpoint.pauseForTest(
                scenario.session1.account.id,
            );
            const pause2Promise = notificationEventAfterProcessingTestCheckpoint.pauseForTest(
                scenario.session3.account.id,
            );

            const post = await channel.createPost(
                scenario.session1,
                assertPostContent(
                    schema.node("doc", {}, [
                        schema.node("paragraph", {}, [
                            schema.text("Hello "),
                            schema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: scenario.session2.account.id,
                                    isShort: false,
                                }),
                            }),
                            schema.text("!"),
                        ]),
                    ]),
                ),
            );

            const comment = await post.createComment(
                scenario.session3,
                scenario.mentionAccount2MessageContent,
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("creating posts updates an entry for every subscriber", async () => {
            const scenario = await createNotificationsScenario(context);

            const session4 = await scenario.space.createSession();
            const session5 = await scenario.space.createSession();

            const channel1 = await TestChannel.create(scenario.session2);

            const channel2 = await TestChannel.create(scenario.session2);

            await runAllPromises([
                subscribeToChannel(scenario.session1.action(), channel1.id),
                subscribeToChannel(scenario.session3.action(), channel1.id),
                subscribeToChannel(scenario.sharedSession.action(), channel1.id),
                subscribeToChannel(scenario.session1.action(), channel2.id),
                subscribeToChannel(scenario.session3.action(), channel2.id),
                subscribeToChannel(session5.action(), channel2.id),
                subscribeToChannel(scenario.sharedSession.action(), channel2.id),
            ]);

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
                await getInboxEntries(context.action(session4), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(session5), {
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

            const post1 = await channel1.createPost(scenario.session1);

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
                    channel: {isPrivate: false, channel: await channel1.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post1.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post1),
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
                    channel: {isPrivate: false, channel: await channel1.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post1.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post1),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(session4), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(session5), {
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
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.sharedSession.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel1.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post1.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post1),
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

            const post2 = await channel1.createPost(scenario.session1);

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
                    channel: {isPrivate: false, channel: await channel1.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post2),
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
                    channel: {isPrivate: false, channel: await channel1.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post2),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(session4), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(session5), {
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
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.sharedSession.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel1.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post2),
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

            const post3 = await channel1.createPost(scenario.session2);

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
                    channel: {isPrivate: false, channel: await channel1.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
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
                    channel: {isPrivate: false, channel: await channel1.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post2),
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
                    channel: {isPrivate: false, channel: await channel1.getPreview()},
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 2,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
                    },
                    otherPostAuthor: await scenario.session1.get(),
                }),
            ]);

            expect(
                await getInboxEntries(context.action(session4), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(session5), {
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
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.sharedSession.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel1.getPreview()},
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 2,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
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

            const post4 = await channel2.createPost(scenario.session2);

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
                    channel: {isPrivate: false, channel: await channel2.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post4.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post4),
                    },
                    otherPostAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel1.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
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
                    channel: {isPrivate: false, channel: await channel1.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post2),
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
                    channel: {isPrivate: false, channel: await channel2.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post4.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post4),
                    },
                    otherPostAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel1.getPreview()},
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 2,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
                    },
                    otherPostAuthor: await scenario.session1.get(),
                }),
            ]);

            expect(
                await getInboxEntries(context.action(session4), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(session5), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: session5.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel2.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post4.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post4),
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
                    channel: {isPrivate: false, channel: await channel2.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post4.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post4),
                    },
                    otherPostAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.sharedSession.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel1.getPreview()},
                    bucketGeneration: 0,
                    postCount: 3,
                    postAuthorCount: 2,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
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

        test("creating posts updates an entry for every subscriber unless the subscriber lost channel access", async () => {
            const scenario = await createNotificationsScenario(context);

            const session4 = await scenario.space.createSession();

            const channel = await TestChannel.create(scenario.session2);

            await runAllPromises([
                subscribeToChannel(scenario.session1.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
                subscribeToChannel(scenario.sharedSession.action(), channel.id),
            ]);

            await channel.access.revokeDefault(scenario.session2);
            await channel.access.grant(scenario.session2, scenario.session3);
            await channel.access.grant(scenario.session2, session4);
            await channel.access.grant(scenario.session2, scenario.sharedSession);

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
                await getInboxEntries(context.action(session4), {
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

            const post1 = await channel.createPost(session4);

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await session4.get(),
                        createdTime: post1.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post1),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await session4.get(),
                        createdTime: post1.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post1),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(session4), {
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
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.sharedSession.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await session4.get(),
                        createdTime: post1.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post1),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            await channel.access.revoke(scenario.session2, scenario.sharedSession);

            const post2 = await channel.createPost(scenario.session3);

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 2,
                    latestPost: {
                        author: await scenario.session3.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post2),
                    },
                    otherPostAuthor: await session4.get(),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await session4.get(),
                        createdTime: post1.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post1),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(session4), {
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
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.sharedSession.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: true, channelId: channel.id},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await session4.get(),
                        createdTime: post1.createdTime,
                        contentTextSnippet: "",
                    },
                    otherPostAuthor: null,
                }),
            ]);

            await channel.access.grant(scenario.session2, scenario.session1);

            const post3 = await channel.createPost(scenario.session2);

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 2,
                    latestPost: {
                        author: await scenario.session3.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post2),
                    },
                    otherPostAuthor: await session4.get(),
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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 2,
                    latestPost: {
                        author: await scenario.session2.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
                    },
                    otherPostAuthor: await session4.get(),
                }),
            ]);

            expect(
                await getInboxEntries(context.action(session4), {
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
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.sharedSession.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: true, channelId: channel.id},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await session4.get(),
                        createdTime: post1.createdTime,
                        contentTextSnippet: "",
                    },
                    otherPostAuthor: null,
                }),
            ]);
        });

        test("can not get inbox entry posts for a space you don’t have access to", async () => {
            const scenario = await createNotificationsScenario(context);

            const channel = await TestChannel.create(scenario.session2);

            await channel.createPost(scenario.session1);

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

            const channel = await TestChannel.create(scenario.session2);

            const post1 = await channel.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            const post2 = await channel.createPost(scenario.session1);

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post2),
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
                posts: await runAllPromises([post2.get(), post1.get()]),
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

            const post3 = await channel.createPost(scenario.session1);

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 2,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
                    },
                    otherPostAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post2),
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
                posts: await runAllPromises([post2.get(), post1.get()]),
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
                posts: await runAllPromises([post3.get()]),
            });

            const post4 = await channel.createPost(scenario.session1);

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 4,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post4.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post4),
                    },
                    otherPostAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 2,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
                    },
                    otherPostAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post2),
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
                posts: await runAllPromises([post2.get(), post1.get()]),
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
                posts: await runAllPromises([post3.get()]),
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
                posts: await runAllPromises([post4.get()]),
            });
        });

        test("getting inbox entry posts does not observe if inbox was already observed", async () => {
            const scenario = await createNotificationsScenario(context);

            const channel = await TestChannel.create(scenario.session2);

            const post1 = await channel.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            const post2 = await channel.createPost(scenario.session1);

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post2),
                    },
                    otherPostAuthor: null,
                }),
            ]);

            await observeInbox(context.action(scenario.session2), {spaceId: scenario.space.id});

            const post3 = await channel.createPost(scenario.session1);

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 2,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post3.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post3),
                    },
                    otherPostAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post2),
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
                posts: await runAllPromises([post2.get(), post1.get()]),
            });

            const post4 = await channel.createPost(scenario.session1);

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 2,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post4.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post4),
                    },
                    otherPostAuthor: null,
                }),
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 2,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post2.createdTime,
                        contentTextSnippet: await getPostContentTextSnippet(post2),
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
                posts: await runAllPromises([post2.get(), post1.get()]),
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
                posts: await runAllPromises([post4.get(), post3.get()]),
            });
        });

        test("can paginate getting inbox entries", async () => {
            const scenario = await createNotificationsScenario(context);

            const channel = await TestChannel.create(scenario.session2);

            const post1 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            const post2 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            const post3 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            const post4 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            const post5 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            const post6 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            const post7 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            const post8 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

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
                posts: await runAllPromises([
                    post8.get(),
                    post7.get(),
                    post6.get(),
                    post5.get(),
                    post4.get(),
                    post3.get(),
                    post2.get(),
                    post1.get(),
                ]),
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
                posts: await runAllPromises([post8.get(), post7.get(), post6.get(), post5.get()]),
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
                posts: await runAllPromises([
                    post8.get(),
                    post7.get(),
                    post6.get(),
                    post5.get(),
                    post4.get(),
                    post3.get(),
                    post2.get(),
                ]),
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
                posts: await runAllPromises([
                    post8.get(),
                    post7.get(),
                    post6.get(),
                    post5.get(),
                    post4.get(),
                    post3.get(),
                    post2.get(),
                    post1.get(),
                ]),
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
                posts: await runAllPromises([post4.get(), post3.get(), post2.get(), post1.get()]),
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
                posts: await runAllPromises([post4.get(), post3.get(), post2.get(), post1.get()]),
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
                posts: await runAllPromises([post4.get(), post3.get(), post2.get()]),
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
                posts: await runAllPromises([post6.get(), post5.get(), post4.get(), post3.get()]),
            });

            const post9 = await channel.createPost(scenario.session1);
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

        test("account can’t backfill in a space it can’t access", async () => {
            const scenario = await createNotificationsScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post = await channel.createPost(scenario.session1);

            const otherChannel = await TestChannel.create(scenario.otherSession);

            await otherChannel.createPost(scenario.otherSession);

            await ProcessContextModule.waitForTestTasks();

            expect(
                await backfillInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    checkpoint: generateServerSynchronizationCheckpoint(),
                }),
            ).toEqual({
                type: "Available",
                checkpoint: expect.any(Date),
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
                                channel: {isPrivate: false, channel: await channel.getPreview()},
                                bucketGeneration: 0,
                                postCount: 1,
                                postAuthorCount: 1,
                                latestPost: {
                                    author: await scenario.session1.get(),
                                    createdTime: post.createdTime,
                                    contentTextSnippet: await getPostContentTextSnippet(post),
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
                    checkpoint: generateServerSynchronizationCheckpoint(),
                }),
            ).rejects.toThrow(PermissionDeniedError);
        });

        test("won’t backfill events that happened far in the past", async () => {
            const scenario = await createNotificationsScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post = await channel.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            expect(
                await backfillInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    checkpoint: subMinutes(generateServerSynchronizationCheckpoint(), 30),
                }),
            ).toEqual({
                type: "Available",
                checkpoint: expect.any(Date),
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
                                channel: {isPrivate: false, channel: await channel.getPreview()},
                                bucketGeneration: 0,
                                postCount: 1,
                                postAuthorCount: 1,
                                latestPost: {
                                    author: await scenario.session1.get(),
                                    createdTime: post.createdTime,
                                    contentTextSnippet: await getPostContentTextSnippet(post),
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
                    checkpoint: addMinutes(generateServerSynchronizationCheckpoint(), 30),
                }),
            ).toEqual({
                type: "Available",
                checkpoint: expect.any(Date),
                eventTransaction: [],
            });
        });

        test("if an account is mentioned then the mentioned message sticks around until archival", async () => {
            const space = await TestSpace.create(context);

            const session1 = await space.createSession();
            const session2 = await space.createSession();

            const channel = await TestChannel.create(session1);

            await runAllPromises([
                subscribeToChannel(session1.action(), channel.id),
                subscribeToChannel(session2.action(), channel.id),
            ]);

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
                    channel: {isPrivate: false, channel: expect.any(ChannelPreviewModel)},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: expect.any(Object),
                    otherPostAuthor: null,
                }),
            ]);

            await post.createComment(session2, "Test comment 1");

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
                    channel: {isPrivate: false, channel: expect.any(ChannelPreviewModel)},
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

            const comment2 = await post.createComment(session1, "Test comment 2");

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
                    channel: {isPrivate: false, channel: expect.any(ChannelPreviewModel)},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment2.createdTime,
                        author: await session1.get(),
                        contentTextSnippet: "Test comment 2",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const comment3 = await post.createComment(session1, "Test comment 3");

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
                    channel: {isPrivate: false, channel: expect.any(ChannelPreviewModel)},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment3.createdTime,
                        author: await session1.get(),
                        contentTextSnippet: "Test comment 3",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const comment4 = await post.createComment(
                session1,
                assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Test comment 4 "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: session2.account.id,
                                    isShort: false,
                                }),
                            }),
                        ]),
                    ]),
                ),
            );

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
                    channel: {isPrivate: false, channel: expect.any(ChannelPreviewModel)},
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await session1.get(),
                        contentTextSnippet: `Test comment 4 ${session2.account.initialName}`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await post.createComment(session1, "Test comment 5");

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
                    channel: {isPrivate: false, channel: expect.any(ChannelPreviewModel)},
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await session1.get(),
                        contentTextSnippet: `Test comment 4 ${session2.account.initialName}`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await post.createComment(session1, "Test comment 6");

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
                    channel: {isPrivate: false, channel: expect.any(ChannelPreviewModel)},
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment4.createdTime,
                        author: await session1.get(),
                        contentTextSnippet: `Test comment 4 ${session2.account.initialName}`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            const comment7 = await post.createComment(
                session1,
                assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Test comment 7 "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: session2.account.id,
                                    isShort: false,
                                }),
                            }),
                        ]),
                    ]),
                ),
            );

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
                    channel: {isPrivate: false, channel: expect.any(ChannelPreviewModel)},
                    loudNotificationCount: 2,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment7.createdTime,
                        author: await session1.get(),
                        contentTextSnippet: `Test comment 7 ${session2.account.initialName}`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await post.createComment(session1, "Test comment 8");

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
                    channel: {isPrivate: false, channel: expect.any(ChannelPreviewModel)},
                    loudNotificationCount: 2,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        createdTime: comment7.createdTime,
                        author: await session1.get(),
                        contentTextSnippet: `Test comment 7 ${session2.account.initialName}`,
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

            const comment9 = await post.createComment(session1, "Test comment 9");

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
                    channel: {isPrivate: false, channel: expect.any(ChannelPreviewModel)},
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

        test("if an account is removed from a space their inbox won’t update anymore", async () => {
            const space = await TestSpace.create(context);

            const session1 = await space.createSession({role: "Admin"});
            const session2 = await space.createSession();

            const channel = await TestChannel.create(session1);
            const post = await channel.createPost(session2);

            await expect(
                getInboxEntry(session2.action(), {
                    spaceId: space.id,
                    key: {type: "PostComments", postId: post.id},
                }),
            ).rejects.toThrow(NotFoundError);

            await post.createComment(session1, "Test comment 1");

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

            await post.createComment(session1, "Test comment 2");

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

            await post.createComment(session1, "Test comment 3");

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

            await removeSpaceAccount(session1.action(), {
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

            await post.createComment(session1, "Test comment 4");

            await ProcessContextModule.waitForTestTasks();

            await expect(
                getInboxEntry(session2.action(), {
                    spaceId: space.id,
                    key: {type: "PostComments", postId: post.id},
                }),
            ).rejects.toThrow(PermissionDeniedError);

            await post.createComment(session1, "Test comment 5");

            await ProcessContextModule.waitForTestTasks();

            await expect(
                getInboxEntry(session2.action(), {
                    spaceId: space.id,
                    key: {type: "PostComments", postId: post.id},
                }),
            ).rejects.toThrow(PermissionDeniedError);

            await addSpaceAccount(session1.action(), {
                spaceId: space.id,
                accountId: session2.account.id,
            });

            await acceptSpaceAccountInvite(session2.action(), space.id);

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

            await post.createComment(session1, "Test comment 6");

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

            await post.createComment(session1, "Test comment 7");

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

        test("will send account mentioned in post a notification even if they’re not subscribed", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3, session4] = await space.createSessions(4);

            const channel = await TestChannel.create(session1);

            await subscribeToChannel(session4.action(), channel.id);

            const post = await channel.createPost(
                session1,
                assertPostContent(
                    schema.node("doc", null, [
                        schema.node("paragraph", null, [
                            schema.text("Hello "),
                            schema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: session2.account.id,
                                    isShort: false,
                                }),
                            }),
                        ]),
                    ]),
                ),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(session1.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: `Hello ${session2.account.initialName}`,
                    latestComment: null,
                    otherCommentAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(session3.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(session4.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session4.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: `Hello ${session2.account.initialName}`,
                    },
                    otherPostAuthor: null,
                }),
            ]);
        });

        test("won’t send account mentioned in post a notification if they don’t have access", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3, session4] = await space.createSessions(4);

            const channel = await TestChannel.create(session1);

            await channel.access.revokeDefault(session1);
            await channel.access.grant(session1, session3);
            await channel.access.grant(session1, session4);

            await subscribeToChannel(session4.action(), channel.id);

            const post = await channel.createPost(
                session1,
                assertPostContent(
                    schema.node("doc", null, [
                        schema.node("paragraph", null, [
                            schema.text("Hello "),
                            schema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: session2.account.id,
                                    isShort: false,
                                }),
                            }),
                        ]),
                    ]),
                ),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(session1.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(session3.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(session4.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session4.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: `Hello ${session2.account.initialName}`,
                    },
                    otherPostAuthor: null,
                }),
            ]);
        });

        test("will hide channel name in post comments entry where account was mentioned but they lost access to the channel", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1);

            await channel.access.revokeDefault(session1);
            await channel.access.grant(session1, session2);

            const post = await channel.createPost(
                session1,
                assertPostContent(
                    schema.node("doc", null, [
                        schema.node("paragraph", null, [
                            schema.text("Hello "),
                            schema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: session2.account.id,
                                    isShort: false,
                                }),
                            }),
                        ]),
                    ]),
                ),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(session1.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: `Hello ${session2.account.initialName}`,
                    latestComment: null,
                    otherCommentAuthor: null,
                }),
            ]);

            await channel.access.revoke(session1, session2);

            expect(
                await getInboxEntries(session1.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

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
                    channel: {isPrivate: true},
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: null,
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("will hide channel name in post comments entry where account left a comment but they lost access to the channel", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1);

            await channel.access.revokeDefault(session1);
            await channel.access.grant(session1, session2);

            const post = await channel.createPost(session1);

            await post.createComment(session2, "comment1");
            const comment2 = await post.createComment(session1, "comment2");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(session1.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        author: await session1.get(),
                        createdTime: comment2.createdTime,
                        contentTextSnippet: "comment2",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await channel.access.revoke(session1, session2);

            expect(
                await getInboxEntries(session1.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

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
                    channel: {isPrivate: true},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        author: await session1.get(),
                        createdTime: comment2.createdTime,
                        contentTextSnippet: "",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("will hide channel name in post comments entry where account left a comment and later was mentioned but they lost access to the channel", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1);

            await channel.access.revokeDefault(session1);
            await channel.access.grant(session1, session2);

            const post = await channel.createPost(session1);

            await post.createComment(session2, "comment1");

            const comment2 = await post.createComment(
                session1,
                assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", null, [
                        MessageContentProsemirrorSchema.node("paragraph", null, [
                            MessageContentProsemirrorSchema.text("Hello "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: session2.account.id,
                                    isShort: false,
                                }),
                            }),
                        ]),
                    ]),
                ),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(session1.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        author: await session1.get(),
                        createdTime: comment2.createdTime,
                        contentTextSnippet: `Hello ${session2.account.initialName}`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
            ]);

            await channel.access.revoke(session1, session2);

            expect(
                await getInboxEntries(session1.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

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
                    channel: {isPrivate: true},
                    loudNotificationCount: 1,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        author: await session1.get(),
                        createdTime: comment2.createdTime,
                        contentTextSnippet: "",
                        isStickyMention: true,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
        });

        test("multiline post content is printed in the text snippet", async () => {
            const scenario = await createNotificationsScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session1.action(), channel.id),
                subscribeToChannel(scenario.session2.action(), channel.id),
            ]);

            const post = await channel.createPost(
                scenario.session1,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [schema.text("Yes")]),
                    schema.node("paragraph", {}, [schema.text("But actually this other thing")]),
                    schema.node("paragraph", {}, [schema.text("And one final thing!")]),
                ]),
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await scenario.session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet:
                            "Yes. But actually this other thing. And one final thing!",
                    },
                    otherPostAuthor: null,
                }),
            ]);
        });

        test("private entity in mention isn’t included in channel post notification", async () => {
            const space = await TestSpace.create(context);

            const [session1, session2, session3] = await space.createSessions(3);

            const channel = await TestChannel.create(session1);
            const document = await TestDocument.create(session2, {title: "TOP SECRET"});

            await subscribeToChannel(session2.action(), channel.id);
            await subscribeToChannel(session3.action(), channel.id);

            const post = await channel.createPost(
                session1,
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Can you see this? "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: `Document:${document.id}`,
                            }),
                        }),
                    ]),
                ]),
            );

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
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: "Can you see this? TOP SECRET",
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                await getInboxEntries(session3.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChannelPostsEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session3.account.id,
                    loudNotificationCount: 0,
                    channel: {isPrivate: false, channel: await channel.getPreview()},
                    bucketGeneration: 0,
                    postCount: 1,
                    postAuthorCount: 1,
                    latestPost: {
                        author: await session1.get(),
                        createdTime: post.createdTime,
                        contentTextSnippet: "Can you see this? Private document",
                    },
                    otherPostAuthor: null,
                }),
            ]);

            expect(
                new Map(
                    filterMapArray(
                        TestLocalEdgeServiceContextModule.takeDurableObjectBroadcasts(),
                        ({url, body = {}}) => {
                            const match = url.match(
                                /^\/api\/durable-objects\/my-account\/([^/]+)\/broadcast-inbox-realtime-event-transaction$/,
                            );
                            if (!match) return;

                            return [
                                match[1],
                                MyAccountBroadcastInboxRealtimeEventTransactionSchema.deserialize(
                                    body,
                                ),
                            ];
                        },
                    ),
                ),
            ).toEqual(
                new Map([
                    [
                        session2.account.id,
                        {
                            eventTransaction: [
                                {
                                    type: "PutItem",
                                    indexes: expect.any(Map),
                                    item: {
                                        key: expect.any(String),
                                        version: expect.any(Number),
                                        model: createTestInboxModel({
                                            spaceId: space.id,
                                            accountId: session2.account.id,
                                            loudNotificationCount: 0,
                                            entryCount: 1,
                                            lastZeroEntryCountTime: null,
                                        }),
                                    },
                                },
                                {
                                    type: "PutItem",
                                    indexes: expect.any(Map),
                                    item: {
                                        key: expect.any(String),
                                        version: expect.any(Number),
                                        model: new InboxChannelPostsEntryModel({
                                            isArchived: false,
                                            spaceId: space.id,
                                            accountId: session2.account.id,
                                            loudNotificationCount: 0,
                                            channel: {
                                                isPrivate: false,
                                                channel: await channel.getPreview(),
                                            },
                                            bucketGeneration: 0,
                                            postCount: 1,
                                            postAuthorCount: 1,
                                            latestPost: {
                                                author: await session1.get(),
                                                createdTime: post.createdTime,
                                                contentTextSnippet: "Can you see this? TOP SECRET",
                                            },
                                            otherPostAuthor: null,
                                        }),
                                    },
                                },
                            ],
                        },
                    ],
                    [
                        session3.account.id,
                        {
                            eventTransaction: [
                                {
                                    type: "PutItem",
                                    indexes: expect.any(Map),
                                    item: {
                                        key: expect.any(String),
                                        version: expect.any(Number),
                                        model: createTestInboxModel({
                                            spaceId: space.id,
                                            accountId: session3.account.id,
                                            loudNotificationCount: 0,
                                            entryCount: 1,
                                            lastZeroEntryCountTime: null,
                                        }),
                                    },
                                },
                                {
                                    type: "PutItem",
                                    indexes: expect.any(Map),
                                    item: {
                                        key: expect.any(String),
                                        version: expect.any(Number),
                                        model: new InboxChannelPostsEntryModel({
                                            isArchived: false,
                                            spaceId: space.id,
                                            accountId: session3.account.id,
                                            loudNotificationCount: 0,
                                            channel: {
                                                isPrivate: false,
                                                channel: await channel.getPreview(),
                                            },
                                            bucketGeneration: 0,
                                            postCount: 1,
                                            postAuthorCount: 1,
                                            latestPost: {
                                                author: await session1.get(),
                                                createdTime: post.createdTime,
                                                contentTextSnippet:
                                                    "Can you see this? Private document",
                                            },
                                            otherPostAuthor: null,
                                        }),
                                    },
                                },
                            ],
                        },
                    ],
                ]),
            );
        });

        test("private entity in mention isn’t included in post comments notification", async () => {
            const space = await TestSpace.create(context);

            const [session1, session2, session3] = await space.createSessions(3);

            const channel = await TestChannel.create(session1);
            const document = await TestDocument.create(session2, {title: "TOP SECRET"});

            const post = await channel.createPost(session1);

            await post.createComment(session2, "Subscribe");
            await ProcessContextModule.waitForTestTasks();

            await post.createComment(session3, "Subscribe");
            await ProcessContextModule.waitForTestTasks();

            // Ignore any previous broadcasts.
            TestLocalEdgeServiceContextModule.takeDurableObjectBroadcasts();

            const comment = await post.createComment(
                session1,
                MessageContentProsemirrorSchema.node("doc", {}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Can you see this? "),
                        MessageContentProsemirrorSchema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "SearchEntity",
                                entityId: `Document:${document.id}`,
                            }),
                        }),
                    ]),
                ]),
            );

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
                    postAuthor: expect.any(AccountModel),
                    channel: {isPrivate: false, channel: expect.any(ChannelPreviewModel)},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        author: await session1.get(),
                        createdTime: comment.createdTime,
                        contentTextSnippet: "Can you see this? TOP SECRET",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: expect.any(AccountModel),
                }),
            ]);

            expect(
                await getInboxEntries(session3.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxPostCommentsEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session3.account.id,
                    postId: post.id,
                    postAuthor: expect.any(AccountModel),
                    channel: {isPrivate: false, channel: expect.any(ChannelPreviewModel)},
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    postContentTextSnippetIfMentioned: null,
                    latestComment: {
                        author: await session1.get(),
                        createdTime: comment.createdTime,
                        contentTextSnippet: "Can you see this? Private document",
                        isStickyMention: false,
                    },
                    otherCommentAuthor: null,
                }),
            ]);
            const expected = new Map(
                filterMapArray(
                    TestLocalEdgeServiceContextModule.takeDurableObjectBroadcasts(),
                    ({url, body = {}}) => {
                        const match = url.match(
                            /^\/api\/durable-objects\/my-account\/([^/]+)\/broadcast-inbox-realtime-event-transaction$/,
                        );
                        if (!match) return;

                        // Ignore any realtime updates `session1` received.
                        if (match[1] === session1.account.id) return;

                        return [
                            match[1],
                            MyAccountBroadcastInboxRealtimeEventTransactionSchema.deserialize(body),
                        ];
                    },
                ),
            );

            expect(expected).toEqual(
                new Map([
                    [
                        session2.account.id,
                        {
                            eventTransaction: [
                                {
                                    type: "PutItem",
                                    indexes: expect.any(Map),
                                    item: {
                                        key: expect.any(String),
                                        version: expect.any(Number),
                                        model: createTestInboxModel({
                                            spaceId: space.id,
                                            accountId: session2.account.id,
                                            loudNotificationCount: 0,
                                            entryCount: 1,
                                            lastZeroEntryCountTime: null,
                                        }),
                                    },
                                },
                                {
                                    type: "PutItem",
                                    indexes: expect.any(Map),
                                    item: {
                                        key: expect.any(String),
                                        version: expect.any(Number),
                                        model: new InboxPostCommentsEntryModel({
                                            isArchived: false,
                                            spaceId: space.id,
                                            accountId: session2.account.id,
                                            postId: post.id,
                                            postAuthor: expect.any(AccountModel),
                                            channel: {
                                                isPrivate: false,
                                                channel: expect.any(ChannelPreviewModel),
                                            },
                                            loudNotificationCount: 0,
                                            postCreatedTime: post.createdTime,
                                            postContentTextSnippetIfMentioned: null,
                                            latestComment: {
                                                author: await session1.get(),
                                                createdTime: comment.createdTime,
                                                contentTextSnippet: "Can you see this? TOP SECRET",
                                                isStickyMention: false,
                                            },
                                            otherCommentAuthor: expect.any(AccountModel),
                                        }),
                                    },
                                },
                            ],
                        },
                    ],
                    [
                        session3.account.id,
                        {
                            eventTransaction: [
                                {
                                    type: "PutItem",
                                    indexes: expect.any(Map),
                                    item: {
                                        key: expect.any(String),
                                        version: expect.any(Number),
                                        model: createTestInboxModel({
                                            spaceId: space.id,
                                            accountId: session3.account.id,
                                            loudNotificationCount: 0,
                                            entryCount: 1,
                                            lastZeroEntryCountTime: null,
                                        }),
                                    },
                                },
                                {
                                    type: "PutItem",
                                    indexes: expect.any(Map),
                                    item: {
                                        key: expect.any(String),
                                        version: expect.any(Number),
                                        model: new InboxPostCommentsEntryModel({
                                            isArchived: false,
                                            spaceId: space.id,
                                            accountId: session3.account.id,
                                            postId: post.id,
                                            postAuthor: expect.any(AccountModel),
                                            channel: {
                                                isPrivate: false,
                                                channel: expect.any(ChannelPreviewModel),
                                            },
                                            loudNotificationCount: 0,
                                            postCreatedTime: post.createdTime,
                                            postContentTextSnippetIfMentioned: null,
                                            latestComment: {
                                                author: await session1.get(),
                                                createdTime: comment.createdTime,
                                                contentTextSnippet:
                                                    "Can you see this? Private document",
                                                isStickyMention: false,
                                            },
                                            otherCommentAuthor: null,
                                        }),
                                    },
                                },
                            ],
                        },
                    ],
                ]),
            );
        });
    });
}
