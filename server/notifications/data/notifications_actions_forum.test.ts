import {addMinutes, subMinutes} from "date-fns";
import {TestApnsContextModule} from "~/server/apns/apns_context_module.js";
import {isServerActionContext} from "~/server/context/is_server_action_context.js";
import {getDocumentPreviewIfPossible} from "~/server/documents/data/documents_actions.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestLocalEdgeServiceContextModule} from "~/server/dynamo/test_helpers/test_local_edge_service_context_module.js";
import {subscribeToChannel} from "~/server/forum/data/subscribe_to_channel.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {archiveInboxEntry} from "~/server/notifications/data/archive_inbox_entry.js";
import {getInbox} from "~/server/notifications/data/get_inbox.js";
import {getInboxChannelPostsEntryPosts} from "~/server/notifications/data/get_inbox_channel_posts_entry_posts.js";
import {backfillInboxEntries} from "~/server/notifications/data/get_inbox_entries.js";
import {getInboxEntry} from "~/server/notifications/data/get_inbox_entry.js";
import {InboxEntriesIndex} from "~/server/notifications/data/internal/inbox_table.js";
import {NotificationsTable} from "~/server/notifications/data/internal/notifications_table.js";
import {
    updateInboxEntryAfterExecuteTransactionTestCheckpoint,
    updateInboxEntryBeforeExecuteTransactionTestCheckpoint,
} from "~/server/notifications/data/internal/update_inbox_entry.js";
import {notificationsInjection} from "~/server/notifications/data/notifications_injection.js";
import {observeInbox} from "~/server/notifications/data/observe_inbox.js";
import {
    notificationEventAfterProcessingTestCheckpoint,
    notificationEventBeforeProcessingTestCheckpoint,
    notificationEventProcessingTestCounter,
    processNotificationEvent,
} from "~/server/notifications/data/process/process_notification_event.js";
import {createNotificationsTestScenario} from "~/server/notifications/data/test_helpers/create_notifications_test_scenario.js";
import {createTestInboxModel} from "~/server/notifications/data/test_helpers/create_test_inbox_model.js";
import {expectInboxChannelPostsEntryModel} from "~/server/notifications/data/test_helpers/expect_inbox_channel_posts_entry_model.js";
import {expectInboxPostCommentsEntryModel} from "~/server/notifications/data/test_helpers/expect_inbox_post_comments_entry_model.js";
import {testGetInboxEntries} from "~/server/notifications/data/test_helpers/test_get_inbox_entries.js";
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
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
    createSimpleMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {MyAccountBroadcastInboxRealtimeEventTransactionSchema} from "~/shared/notifications/my_account_protocol.js";
import {parseSearchDynamicEntityId} from "~/shared/search/search_entity_id.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {generateServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";

type ProcessingType = "Once" | "TwiceSerially" | "ThriceConcurrently";

let processingType: ProcessingType = "Once";

const testSuites: Array<{
    type: ProcessingType;
    processingMultiple: number;
    only?: CommitBlocker;
}> = [
    {type: "Once", processingMultiple: 1},
    {type: "TwiceSerially", processingMultiple: 2},
    {type: "ThriceConcurrently", processingMultiple: 3},
];

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
    notificationsInjection,
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
    const {posts} = await getInboxChannelPostsEntryPosts(...args);
    return posts.map(post => post.model);
}

test("won’t create two inbox entries if inbox is observed between serial event processing", async () => {
    processingType = "TwiceSerially";

    const scenario = await createNotificationsTestScenario(context);

    const channel = await TestChannel.create(scenario.session2);

    await runAllPromises([
        subscribeToChannel(scenario.session1.action(), channel.id),
        subscribeToChannel(scenario.session2.action(), channel.id),
        subscribeToChannel(scenario.session3.action(), channel.id),
    ]);

    const post1 = await channel.createPost(scenario.session1);
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

    expect(await testGetInboxEntries(scenario.session2)).toEqual([
        expectInboxChannelPostsEntryModel({
            session: scenario.session2,
            channel,
            bucketGeneration: 0,
            posts: [post1, post2],
            latestPost: {post: post2, contentTextSnippet: expect.any(String)},
        }),
    ]);

    expect(await testGetInboxEntries(scenario.session3)).toEqual([
        expectInboxChannelPostsEntryModel({
            session: scenario.session3,
            channel,
            bucketGeneration: 0,
            posts: [post1, post2],
            latestPost: {post: post2, contentTextSnippet: expect.any(String)},
        }),
    ]);
});

// Exercise idempotency by running the test suite again with jobs
// processed twice.
for (const {type: currentProcessingType, processingMultiple} of testSuites) {
    // If another suite has `only` set then skip this suite so we only run the
    // suite with `only` set.
    if (
        testSuites.some(testSuite => !!testSuite.only && testSuite.type !== currentProcessingType)
    ) {
        continue;
    }

    describe(`processing: ${currentProcessingType}`, () => {
        beforeEach(() => {
            processingType = currentProcessingType;
        });

        test("posting creates an inbox entry for all subscribers", async () => {
            const scenario = await createNotificationsTestScenario(context);

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

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session2,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session3,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post, contentTextSnippet: expect.any(String)},
                }),
            ]);

            const comment1 = await post.createComment(
                scenario.session2,
                createSimpleMessageContent("comment1"),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: "comment1",
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session3,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post, contentTextSnippet: expect.any(String)},
                }),
            ]);

            const comment2 = await post.createComment(
                scenario.session3,
                createSimpleMessageContent("comment2"),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: "comment2",
                    },
                    otherCommentAuthor: scenario.session2,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: "comment2",
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([]);

            const comment3 = await post.createComment(
                scenario.session1,
                createSimpleMessageContent("comment3"),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                    otherCommentAuthor: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session3,
                    post,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                }),
            ]);

            // Make sure multiple processing is working.
            expect(getCount1()).toEqual(2 * processingMultiple);
            expect(getCount2()).toEqual(1 * processingMultiple);
            expect(getCount3()).toEqual(1 * processingMultiple);
        });

        test("posting creates an inbox entry for all subscribers unless a subscriber has lost access", async () => {
            const scenario = await createNotificationsTestScenario(context);

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

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session1,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session2,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([]);

            await channel.access.revokeDefault(scenario.session1);
            await channel.access.grant(scenario.session1, scenario.session2);

            await post.createComment(scenario.session2, createSimpleMessageContent("comment1"));

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session1,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([]);

            const comment2 = await post.createComment(
                scenario.session1,
                createSimpleMessageContent("comment2"),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: "comment2",
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([]);

            await channel.access.grant(scenario.session1, scenario.session3);

            const comment3 = await post.createComment(
                scenario.session1,
                createSimpleMessageContent("comment3"),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session3,
                    post,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                }),
            ]);

            // Make sure multiple processing is working.
            expect(getCount1()).toEqual(2 * processingMultiple);
            expect(getCount2()).toEqual(1 * processingMultiple);
            expect(getCount3()).toEqual(1 * processingMultiple);
        });

        test("can get individual inbox entries", async () => {
            const scenario = await createNotificationsTestScenario(context);

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
                model: expectInboxChannelPostsEntryModel({
                    session: scenario.session2,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post, contentTextSnippet: expect.any(String)},
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
                model: expectInboxChannelPostsEntryModel({
                    session: scenario.session3,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post, contentTextSnippet: expect.any(String)},
                }),
            });
        });

        test("mentioning someone in a post a creates a loud notification for them whether or not they are a subscriber", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session1.action(), channel.id),
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post = await channel.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session2,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session3,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post, contentTextSnippet: expect.any(String)},
                }),
            ]);

            const comment1 = await post.createComment(
                scenario.session2,
                scenario.mentionAccount3MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session3,
                    post,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            const comment2 = await post.createComment(
                scenario.session2,
                scenario.mentionAccount1MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session3,
                    post,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            const comment3 = await post.createComment(
                scenario.session3,
                scenario.mentionAccount1MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post,
                    loudNotificationCount: 2,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherCommentAuthor: scenario.session2,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([]);
        });

        test("mentioning yourself does not create a loud notification for yourself", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session1.action(), channel.id),
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post = await channel.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session2,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session3,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post, contentTextSnippet: expect.any(String)},
                }),
            ]);

            const comment1 = await post.createComment(
                scenario.session2,
                scenario.mentionAccount2MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session3,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post, contentTextSnippet: expect.any(String)},
                }),
            ]);

            const comment2 = await post.createComment(
                scenario.session1,
                createSimpleMessageContent("comment2"),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: "comment2",
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session3,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post, contentTextSnippet: expect.any(String)},
                }),
            ]);

            const comment3 = await post.createComment(
                scenario.session2,
                scenario.mentionAccount2MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session3,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post, contentTextSnippet: expect.any(String)},
                }),
            ]);
        });

        test("accounts have separate inboxes for each space", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const channel = await TestChannel.create(scenario.session1);
            const otherChannel = await TestChannel.create(scenario.otherSession);

            await runAllPromises([
                subscribeToChannel(scenario.sharedSession.action(), channel.id),
                subscribeToChannel(scenario.sharedSession.action(), otherChannel.id),
            ]);

            const post = await channel.createPost(scenario.session1);
            const otherPost = await otherChannel.createPost(scenario.otherSession);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.sharedSession)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.sharedSession,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(
                await testGetInboxEntries(scenario.sharedSession, {space: scenario.otherSpace}),
            ).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.sharedSession,
                    channel: otherChannel,
                    bucketGeneration: 0,
                    latestPost: {post: otherPost, contentTextSnippet: expect.any(String)},
                }),
            ]);

            const comment1 = await post.createComment(
                scenario.session2,
                scenario.mentionSharedAccountMessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.sharedSession)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.sharedSession,
                    post,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${scenario.sharedSession.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            expect(
                await testGetInboxEntries(scenario.sharedSession, {space: scenario.otherSpace}),
            ).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.sharedSession,
                    channel: otherChannel,
                    bucketGeneration: 0,
                    latestPost: {post: otherPost, contentTextSnippet: expect.any(String)},
                }),
            ]);

            const comment2 = await otherPost.createComment(
                scenario.otherSession,
                scenario.mentionSharedAccountMessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.sharedSession)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.sharedSession,
                    post,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${scenario.sharedSession.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            expect(
                await testGetInboxEntries(scenario.sharedSession, {space: scenario.otherSpace}),
            ).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.sharedSession,
                    post: otherPost,
                    channel: otherChannel,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${scenario.sharedSession.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);
        });

        test("account can not see mention in a different space", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post = await channel.createPost(scenario.session1);

            const otherChannel = await TestChannel.create(scenario.otherSession);

            const otherPost = await otherChannel.createPost(scenario.otherSession);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session3,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post, contentTextSnippet: expect.any(String)},
                }),
            ]);

            await expect(
                testGetInboxEntries(scenario.session3, {space: scenario.otherSpace}),
            ).rejects.toThrow(PermissionDeniedError);

            const comment1 = await post.createComment(
                scenario.session2,
                scenario.mentionAccount3MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session3,
                    post,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            await expect(
                testGetInboxEntries(scenario.session3, {space: scenario.otherSpace}),
            ).rejects.toThrow(PermissionDeniedError);

            await otherPost.createComment(
                scenario.otherSession,
                scenario.mentionAccount3MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session3,
                    post,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            await expect(
                testGetInboxEntries(scenario.session3, {space: scenario.otherSpace}),
            ).rejects.toThrow(PermissionDeniedError);
        });

        test("comment notification events processed out of order result in the same latest comment", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const channel = await TestChannel.create(scenario.session2);

            await runAllPromises([
                subscribeToChannel(scenario.session1.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post = await channel.createPost(scenario.session2);

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

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

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                    otherCommentAuthor: scenario.session1,
                }),
            ]);

            unpause1();
            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                    otherCommentAuthor: scenario.session1,
                }),
            ]);
        });

        test("comment notification events processed out of order result in the same latest comment including implicit archival states", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const channel = await TestChannel.create(scenario.session2);

            await runAllPromises([
                subscribeToChannel(scenario.session1.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post = await channel.createPost(scenario.session2);

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

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

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            unpause1();
            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);
        });

        test("loud notifications are always at the top of the inbox", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            const post1 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            const post2 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            const post3 = await channel.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            const comment1 = await post1.createComment(
                scenario.session2,
                createSimpleMessageContent("comment1"),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: "comment1",
                    },
                }),
            ]);

            const comment2 = await post2.createComment(
                scenario.session2,
                scenario.mentionAccount1MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post2,

                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: "comment1",
                    },
                }),
            ]);

            const comment3 = await post3.createComment(
                scenario.session2,
                createSimpleMessageContent("comment3"),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post2,

                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post3,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: "comment1",
                    },
                }),
            ]);

            const comment4 = await post1.createComment(
                scenario.session2,
                createSimpleMessageContent("comment4"),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post2,

                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post3,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment4,
                        contentTextSnippet: "comment4",
                    },
                }),
            ]);

            await post2.createComment(scenario.session2, createSimpleMessageContent("comment5"));

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post2,

                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post3,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment4,
                        contentTextSnippet: "comment4",
                    },
                }),
            ]);

            const comment6 = await post3.createComment(
                scenario.session2,
                scenario.mentionAccount1MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post3,
                    channel,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment6,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post2,

                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment4,
                        contentTextSnippet: "comment4",
                    },
                }),
            ]);

            await post2.createComment(scenario.session2, createSimpleMessageContent("comment7"));

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post3,
                    channel,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment6,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post2,

                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment4,
                        contentTextSnippet: "comment4",
                    },
                }),
            ]);

            const comment8 = await post2.createComment(
                scenario.session2,
                scenario.mentionAccount1MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post2,

                    loudNotificationCount: 2,
                    latestComment: {
                        comment: comment8,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post3,
                    channel,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment6,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment4,
                        contentTextSnippet: "comment4",
                    },
                }),
            ]);
        });

        test("can not observe inbox in a space you don’t have access to", async () => {
            const scenario = await createNotificationsTestScenario(context);

            await expect(
                observeInbox(context.action(scenario.session1), {spaceId: scenario.otherSpace.id}),
            ).rejects.toThrow(PermissionDeniedError);
        });

        test("observing an inbox freezes loud notifications in place", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            const post1 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            const post2 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            const post3 = await channel.createPost(scenario.session1);

            const post4 = await channel.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            const comment1 = await post1.createComment(
                scenario.session2,
                createSimpleMessageContent("comment1"),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: "comment1",
                    },
                }),
            ]);

            const comment2 = await post2.createComment(
                scenario.session2,
                scenario.mentionAccount1MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post2,

                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: "comment1",
                    },
                }),
            ]);

            const comment3 = await post3.createComment(
                scenario.session2,
                createSimpleMessageContent("comment3"),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post2,

                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post3,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: "comment1",
                    },
                }),
            ]);

            await observeInbox(context.action(scenario.session1), {spaceId: scenario.space.id});

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post2,

                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post3,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: "comment1",
                    },
                }),
            ]);

            const comment4 = await post4.createComment(
                scenario.session2,
                createSimpleMessageContent("comment4"),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post4,
                    channel,
                    latestComment: {
                        comment: comment4,
                        contentTextSnippet: "comment4",
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post2,

                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post3,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: "comment1",
                    },
                }),
            ]);

            await post2.createComment(scenario.session2, createSimpleMessageContent("comment5"));

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post4,
                    channel,
                    latestComment: {
                        comment: comment4,
                        contentTextSnippet: "comment4",
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post2,

                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post3,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: "comment1",
                    },
                }),
            ]);

            const comment6 = await post3.createComment(
                scenario.session2,
                createSimpleMessageContent("comment6"),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post4,
                    channel,
                    latestComment: {
                        comment: comment4,
                        contentTextSnippet: "comment4",
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post2,

                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post3,
                    channel,
                    latestComment: {
                        comment: comment6,
                        contentTextSnippet: "comment6",
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: "comment1",
                    },
                }),
            ]);

            const comment7 = await post3.createComment(
                scenario.session2,
                scenario.mentionAccount1MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post3,
                    channel,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment7,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post4,
                    channel,
                    latestComment: {
                        comment: comment4,
                        contentTextSnippet: "comment4",
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post2,

                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: "comment1",
                    },
                }),
            ]);
        });

        test("can archive inbox entries", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post1 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            const post2 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

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

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                    otherCommentAuthor: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post2,

                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment4,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                    otherCommentAuthor: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session3,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                }),
                expectInboxChannelPostsEntryModel({
                    session: scenario.session3,
                    channel,
                    bucketGeneration: 0,
                    posts: [post2],
                    latestPost: {post: post2, contentTextSnippet: expect.any(String)},
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session3).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post1.id},
                },
            );

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                    otherCommentAuthor: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post2,

                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment4,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                    otherCommentAuthor: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session3,
                    channel,
                    bucketGeneration: 0,
                    posts: [post2],
                    latestPost: {post: post2, contentTextSnippet: expect.any(String)},
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post2.id},
                },
            );

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                    otherCommentAuthor: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                    otherCommentAuthor: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session3,
                    channel,
                    bucketGeneration: 0,
                    posts: [post2],
                    latestPost: {post: post2, contentTextSnippet: expect.any(String)},
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post1.id},
                },
            );

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                    otherCommentAuthor: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session3,
                    channel,
                    bucketGeneration: 0,
                    posts: [post2],
                    latestPost: {post: post2, contentTextSnippet: expect.any(String)},
                }),
            ]);
        });

        test("can unarchive inbox entries", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post1 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            const post2 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            const post3 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

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

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post3,
                    channel,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment5,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post2,

                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment4,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                    otherCommentAuthor: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session3,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                }),
                expectInboxChannelPostsEntryModel({
                    session: scenario.session3,
                    channel,
                    bucketGeneration: 0,
                    posts: [post2, post3],
                    latestPost: {post: post3, contentTextSnippet: expect.any(String)},
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

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post3,
                    channel,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment5,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session3,
                    channel,
                    bucketGeneration: 0,
                    posts: [post2, post3],
                    latestPost: {post: post3, contentTextSnippet: expect.any(String)},
                }),
            ]);

            await unarchiveInboxEntry(
                context.action(scenario.session3).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post1.id},
                },
            );

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post3,
                    channel,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment5,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session3,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                }),
                expectInboxChannelPostsEntryModel({
                    session: scenario.session3,
                    channel,
                    bucketGeneration: 0,
                    posts: [post2, post3],
                    latestPost: {post: post3, contentTextSnippet: expect.any(String)},
                }),
            ]);

            await unarchiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post2.id},
                },
            );

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post2,

                    latestComment: {
                        comment: comment4,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post3,
                    channel,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment5,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session3,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                }),
                expectInboxChannelPostsEntryModel({
                    session: scenario.session3,
                    channel,
                    bucketGeneration: 0,
                    posts: [post2, post3],
                    latestPost: {post: post3, contentTextSnippet: expect.any(String)},
                }),
            ]);

            await unarchiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post1.id},
                },
            );

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                    otherCommentAuthor: scenario.session3,
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post2,

                    latestComment: {
                        comment: comment4,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post3,
                    channel,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment5,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session3,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                }),
                expectInboxChannelPostsEntryModel({
                    session: scenario.session3,
                    channel,
                    bucketGeneration: 0,
                    posts: [post2, post3],
                    latestPost: {post: post3, contentTextSnippet: expect.any(String)},
                }),
            ]);

            await unarchiveInboxEntry(
                context.action(scenario.session1).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post1.id},
                },
            );

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: "comment2",
                    },
                    otherCommentAuthor: scenario.session2,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                    otherCommentAuthor: scenario.session3,
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post2,

                    latestComment: {
                        comment: comment4,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post3,
                    channel,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment5,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session3,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                }),
                expectInboxChannelPostsEntryModel({
                    session: scenario.session3,
                    channel,
                    bucketGeneration: 0,
                    posts: [post2, post3],
                    latestPost: {post: post3, contentTextSnippet: expect.any(String)},
                }),
            ]);
        });

        test("can not archive or unarchive inbox entries in a space you don’t have access to", async () => {
            const scenario = await createNotificationsTestScenario(context);

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
            const scenario = await createNotificationsTestScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            const post = await channel.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            const comment1 = await post.createComment(
                scenario.session2,
                createSimpleMessageContent("comment1"),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: "comment1",
                    },
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session1).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post.id},
                },
            );

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            const comment2 = await post.createComment(
                scenario.session2,
                createSimpleMessageContent("comment2"),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: "comment2",
                    },
                }),
            ]);
        });

        test("notification on an archived entry revives it clearing old loud notification count", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            const post = await channel.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            const comment1 = await post.createComment(
                scenario.session2,
                scenario.mentionAccount1MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session1).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post.id},
                },
            );

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            const comment2 = await post.createComment(
                scenario.session2,
                createSimpleMessageContent("comment2"),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: "comment2",
                    },
                }),
            ]);
        });

        test("notification on an archived entry from own account does not revive it", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            const post = await channel.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            const comment1 = await post.createComment(
                scenario.session2,
                createSimpleMessageContent("comment1"),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: "comment1",
                    },
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session1).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post.id},
                },
            );

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            await post.createComment(scenario.session1, createSimpleMessageContent("comment2"));

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            await unarchiveInboxEntry(
                context.action(scenario.session1).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post.id},
                },
            );

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session1,
                    post,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: "comment1",
                    },
                }),
            ]);
        });

        test("can not get inbox in a space you don’t have access to", async () => {
            const scenario = await createNotificationsTestScenario(context);

            await expect(
                getInbox(context.action(scenario.session1), {spaceId: scenario.otherSpace.id}),
            ).rejects.toThrow(PermissionDeniedError);
        });

        test("gets an inbox model even in a fresh space", async () => {
            const scenario = await createNotificationsTestScenario(context);

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
            const scenario = await createNotificationsTestScenario(context);

            expect(
                (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                createTestInboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session2), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                createTestInboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                }),
            );

            expect(
                (await getInbox(context.action(scenario.session3), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                createTestInboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                }),
            );

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post1 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            const post2 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            const post3 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            expect(
                (await getInbox(context.action(scenario.session1), {spaceId: scenario.space.id}))
                    .model,
            ).toEqual(
                createTestInboxModel({
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
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
                    entryCount: 1,
                    lastZeroEntryCountTime: expect.any(Date),
                }),
            );
        });

        test("start sort key and end sort key work properly in inclusive/exclusive mode", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            const post1 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            const post2 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

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
                        model: expectInboxPostCommentsEntryModel({
                            session: scenario.session1,
                            channel,
                            post: post6,
                            latestComment: {
                                comment: comment6,
                                contentTextSnippet: "comment6",
                            },
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 1,
                        model: expectInboxPostCommentsEntryModel({
                            session: scenario.session1,
                            channel,
                            post: post5,
                            latestComment: {
                                comment: comment5,
                                contentTextSnippet: "comment5",
                            },
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 1,
                        model: expectInboxPostCommentsEntryModel({
                            session: scenario.session1,
                            channel,
                            post: post4,
                            latestComment: {
                                comment: comment4,
                                contentTextSnippet: "comment4",
                            },
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 1,
                        model: expectInboxPostCommentsEntryModel({
                            session: scenario.session1,
                            channel,
                            post: post3,
                            latestComment: {
                                comment: comment3,
                                contentTextSnippet: "comment3",
                            },
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 2,
                        model: expectInboxPostCommentsEntryModel({
                            isArchived: true,
                            session: scenario.session1,
                            channel,
                            post: post2,
                            latestComment: {
                                comment: comment2,
                                contentTextSnippet: "comment2",
                            },
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 2,
                        model: expectInboxPostCommentsEntryModel({
                            isArchived: true,
                            session: scenario.session1,
                            channel,
                            post: post1,
                            latestComment: {
                                comment: comment1,
                                contentTextSnippet: "comment1",
                            },
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
                        model: expectInboxPostCommentsEntryModel({
                            session: scenario.session1,
                            channel,
                            post: post4,
                            latestComment: {
                                comment: comment4,
                                contentTextSnippet: "comment4",
                            },
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 1,
                        model: expectInboxPostCommentsEntryModel({
                            session: scenario.session1,
                            channel,
                            post: post3,
                            latestComment: {
                                comment: comment3,
                                contentTextSnippet: "comment3",
                            },
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 2,
                        model: expectInboxPostCommentsEntryModel({
                            isArchived: true,
                            session: scenario.session1,
                            channel,
                            post: post2,
                            latestComment: {
                                comment: comment2,
                                contentTextSnippet: "comment2",
                            },
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 2,
                        model: expectInboxPostCommentsEntryModel({
                            isArchived: true,
                            session: scenario.session1,
                            channel,
                            post: post1,
                            latestComment: {
                                comment: comment1,
                                contentTextSnippet: "comment1",
                            },
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
                        model: expectInboxPostCommentsEntryModel({
                            session: scenario.session1,
                            channel,
                            post: post3,
                            latestComment: {
                                comment: comment3,
                                contentTextSnippet: "comment3",
                            },
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 2,
                        model: expectInboxPostCommentsEntryModel({
                            isArchived: true,
                            session: scenario.session1,
                            channel,
                            post: post2,
                            latestComment: {
                                comment: comment2,
                                contentTextSnippet: "comment2",
                            },
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 2,
                        model: expectInboxPostCommentsEntryModel({
                            isArchived: true,
                            session: scenario.session1,
                            channel,
                            post: post1,
                            latestComment: {
                                comment: comment1,
                                contentTextSnippet: "comment1",
                            },
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
                        model: expectInboxPostCommentsEntryModel({
                            session: scenario.session1,
                            channel,
                            post: post6,
                            latestComment: {
                                comment: comment6,
                                contentTextSnippet: "comment6",
                            },
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 1,
                        model: expectInboxPostCommentsEntryModel({
                            session: scenario.session1,
                            channel,
                            post: post5,
                            latestComment: {
                                comment: comment5,
                                contentTextSnippet: "comment5",
                            },
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 1,
                        model: expectInboxPostCommentsEntryModel({
                            session: scenario.session1,
                            channel,
                            post: post4,
                            latestComment: {
                                comment: comment4,
                                contentTextSnippet: "comment4",
                            },
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 1,
                        model: expectInboxPostCommentsEntryModel({
                            session: scenario.session1,
                            channel,
                            post: post3,
                            latestComment: {
                                comment: comment3,
                                contentTextSnippet: "comment3",
                            },
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 2,
                        model: expectInboxPostCommentsEntryModel({
                            isArchived: true,
                            session: scenario.session1,
                            channel,
                            post: post2,
                            latestComment: {
                                comment: comment2,
                                contentTextSnippet: "comment2",
                            },
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
                        model: expectInboxPostCommentsEntryModel({
                            session: scenario.session1,
                            channel,
                            post: post6,
                            latestComment: {
                                comment: comment6,
                                contentTextSnippet: "comment6",
                            },
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 1,
                        model: expectInboxPostCommentsEntryModel({
                            session: scenario.session1,
                            channel,
                            post: post5,
                            latestComment: {
                                comment: comment5,
                                contentTextSnippet: "comment5",
                            },
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 1,
                        model: expectInboxPostCommentsEntryModel({
                            session: scenario.session1,
                            channel,
                            post: post4,
                            latestComment: {
                                comment: comment4,
                                contentTextSnippet: "comment4",
                            },
                        }),
                    },
                    {
                        cursor: expect.any(String),
                        key: expect.any(String),
                        version: 1,
                        model: expectInboxPostCommentsEntryModel({
                            session: scenario.session1,
                            channel,
                            post: post3,
                            latestComment: {
                                comment: comment3,
                                contentTextSnippet: "comment3",
                            },
                        }),
                    },
                ],
            });
        });

        test("archiving an entry with loud notifications puts it back at the inbox generation", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post1 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            const post2 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            const comment1 = await post1.createComment(
                scenario.session1,
                scenario.mentionAccount2MessageContent,
            );

            const comment2 = await post2.createComment(
                scenario.session1,
                scenario.mentionAccount2MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post2,

                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post1,
                    channel,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post2.id},
                },
            );

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post1,
                    channel,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            const comment3 = await post2.createComment(
                scenario.session1,
                createSimpleMessageContent("comment3"),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post1,
                    channel,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post2,

                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                }),
            ]);
        });

        test("implicitly archiving an entry with loud notifications puts it back at the inbox generation", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post1 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            const post2 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            const comment1 = await post1.createComment(
                scenario.session1,
                scenario.mentionAccount2MessageContent,
            );

            const comment2 = await post2.createComment(
                scenario.session1,
                scenario.mentionAccount2MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post2,

                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post1,
                    channel,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            await post2.createComment(scenario.session2, createSimpleMessageContent("test"));

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post1,
                    channel,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            const comment3 = await post2.createComment(
                scenario.session1,
                createSimpleMessageContent("comment3"),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post1,
                    channel,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post2,

                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "comment3",
                    },
                }),
            ]);
        });

        test("archived entries are in the order they were archived", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post1 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            const post2 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            const post3 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

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

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post3,
                    channel,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post2,

                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post1,
                    channel,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2, {filter: "Archive"})).toEqual([]);

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post3.id},
                },
            );

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post2,

                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post1,
                    channel,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2, {filter: "Archive"})).toEqual([
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: scenario.session2,
                    post: post3,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post1.id},
                },
            );

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post2,

                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2, {filter: "Archive"})).toEqual([
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: scenario.session2,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: scenario.session2,
                    post: post3,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post2.id},
                },
            );

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2, {filter: "Archive"})).toEqual([
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: scenario.session2,
                    post: post2,

                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: scenario.session2,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: scenario.session2,
                    post: post3,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                }),
            ]);
        });

        test("implicitly archived entries are in the order they were archived", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post1 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            const post2 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            const post3 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

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

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post3,
                    channel,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post2,

                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post1,
                    channel,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2, {filter: "Archive"})).toEqual([]);

            await post3.createComment(scenario.session2, createSimpleMessageContent("test"));

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post2,

                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post1,
                    channel,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2, {filter: "Archive"})).toEqual([
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: scenario.session2,
                    post: post3,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                }),
            ]);

            await post1.createComment(scenario.session2, createSimpleMessageContent("test"));

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post2,

                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2, {filter: "Archive"})).toEqual([
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: scenario.session2,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: scenario.session2,
                    post: post3,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                }),
            ]);

            await post2.createComment(scenario.session2, createSimpleMessageContent("test"));

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2, {filter: "Archive"})).toEqual([
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: scenario.session2,
                    post: post2,

                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: scenario.session2,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: scenario.session2,
                    post: post3,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                }),
            ]);
        });

        test("archive entry order does not change when it updates", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            const post1 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

            const post2 = await channel.createPost(scenario.session1);
            await ProcessContextModule.waitForTestTasks();

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

            expect(await testGetInboxEntries(scenario.session2, {filter: "Archive"})).toEqual([
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: scenario.session2,
                    post: post2,

                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: scenario.session2,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: scenario.session2,
                    post: post3,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                }),
            ]);

            await post3.createComment(scenario.session2, createSimpleMessageContent("comment4"));

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session2, {filter: "Archive"})).toEqual([
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: scenario.session2,
                    post: post2,

                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: scenario.session2,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: scenario.session2,
                    post: post3,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                }),
            ]);

            await post2.createComment(scenario.session2, createSimpleMessageContent("comment5"));

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session2, {filter: "Archive"})).toEqual([
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: scenario.session2,
                    post: post2,

                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: scenario.session2,
                    post: post1,
                    channel,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: scenario.session2,
                    post: post3,
                    channel,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                }),
            ]);
        });

        test("mentioning in a post creates an entry for the mentioned account", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const channel = await TestChannel.create(scenario.session1);

            await runAllPromises([
                subscribeToChannel(scenario.session2.action(), channel.id),
                subscribeToChannel(scenario.session3.action(), channel.id),
            ]);

            const post1 = await channel.createPost(
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

            await ProcessContextModule.waitForTestTasks();

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

            await ProcessContextModule.waitForTestTasks();

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

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post: post2,

                    loudNotificationCount: 1,
                    postContentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    isForPostContentMention: true,
                }),
                expectInboxChannelPostsEntryModel({
                    session: scenario.session2,
                    channel,
                    bucketGeneration: 0,
                    posts: [post1, post3],
                    latestPost: {post: post3, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session3,
                    post: post3,
                    channel,
                    loudNotificationCount: 1,
                    postContentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                    isForPostContentMention: true,
                }),
                expectInboxChannelPostsEntryModel({
                    session: scenario.session3,
                    channel,
                    bucketGeneration: 0,
                    posts: [post1, post2],
                    latestPost: {post: post2, contentTextSnippet: expect.any(String)},
                }),
            ]);
        });

        test("commenting on a post someone was mentioned on updates an entry for the mentioned account", async () => {
            const scenario = await createNotificationsTestScenario(context);

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

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post,
                    loudNotificationCount: 1,
                    postContentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    isForPostContentMention: true,
                }),
            ]);

            const comment1 = await post.createComment(
                scenario.session3,
                createSimpleMessageContent("comment1"),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post,
                    loudNotificationCount: 1,
                    postContentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    isForPostContentMention: true,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: "comment1",
                    },
                }),
            ]);
        });

        test("commenting on a post revives an archived entry someone was mentioned on", async () => {
            const scenario = await createNotificationsTestScenario(context);

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

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post,
                    loudNotificationCount: 1,
                    postContentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    isForPostContentMention: true,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2, {filter: "Archive"})).toEqual([]);

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post.id},
                },
            );

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2, {filter: "Archive"})).toEqual([
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: scenario.session2,
                    post,
                    postContentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    isForPostContentMention: true,
                }),
            ]);

            const comment1 = await post.createComment(
                scenario.session3,
                createSimpleMessageContent("comment1"),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: "comment1",
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2, {filter: "Archive"})).toEqual([]);
        });

        test("post with mention create event processed after comment event", async () => {
            const scenario = await createNotificationsTestScenario(context);

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

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            unpause1();
            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post,
                    loudNotificationCount: 2,
                    postContentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    isForPostContentMention: true,
                    latestComment: {
                        comment,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);
        });

        test("post with mention create event processed after comment event and after entry was archived", async () => {
            const scenario = await createNotificationsTestScenario(context);

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

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: scenario.session2,
                    post,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2, {filter: "Archive"})).toEqual([]);

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "PostComments", postId: post.id},
                },
            );

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2, {filter: "Archive"})).toEqual([
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: scenario.session2,
                    post,
                    latestComment: {
                        comment,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                }),
            ]);

            unpause1();
            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2, {filter: "Archive"})).toEqual([
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: scenario.session2,
                    post,
                    latestComment: {
                        comment,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                }),
            ]);
        });

        test("creating posts updates an entry for every subscriber", async () => {
            const scenario = await createNotificationsTestScenario(context);

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

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([]);

            expect(await testGetInboxEntries(session4)).toEqual([]);

            expect(await testGetInboxEntries(session5)).toEqual([]);

            expect(await testGetInboxEntries(scenario.sharedSession)).toEqual([]);

            expect(await testGetInboxEntries(scenario.otherSession)).toEqual([]);

            const post1 = await channel1.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session2,
                    channel: channel1,
                    bucketGeneration: 0,
                    latestPost: {post: post1, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session3,
                    channel: channel1,
                    bucketGeneration: 0,
                    latestPost: {post: post1, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(session4)).toEqual([]);

            expect(await testGetInboxEntries(session5)).toEqual([]);

            expect(await testGetInboxEntries(scenario.sharedSession)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.sharedSession,
                    channel: channel1,
                    bucketGeneration: 0,
                    latestPost: {post: post1, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(scenario.otherSession)).toEqual([]);

            const post2 = await channel1.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session2,
                    channel: channel1,
                    bucketGeneration: 0,
                    posts: [post1, post2],
                    latestPost: {post: post2, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session3,
                    channel: channel1,
                    bucketGeneration: 0,
                    posts: [post1, post2],
                    latestPost: {post: post2, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(session4)).toEqual([]);

            expect(await testGetInboxEntries(session5)).toEqual([]);

            expect(await testGetInboxEntries(scenario.sharedSession)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.sharedSession,
                    channel: channel1,
                    bucketGeneration: 0,
                    posts: [post1, post2],
                    latestPost: {post: post2, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(scenario.otherSession)).toEqual([]);

            const post3 = await channel1.createPost(scenario.session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session1,
                    channel: channel1,
                    bucketGeneration: 0,
                    latestPost: {post: post3, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session2,
                    channel: channel1,
                    bucketGeneration: 0,
                    posts: [post1, post2],
                    latestPost: {post: post2, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session3,
                    channel: channel1,
                    bucketGeneration: 0,
                    posts: [post1, post2, post3],
                    latestPost: {post: post3, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(session4)).toEqual([]);

            expect(await testGetInboxEntries(session5)).toEqual([]);

            expect(await testGetInboxEntries(scenario.sharedSession)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.sharedSession,
                    channel: channel1,
                    bucketGeneration: 0,
                    posts: [post1, post2, post3],
                    latestPost: {post: post3, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(scenario.otherSession)).toEqual([]);

            const post4 = await channel2.createPost(scenario.session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session1,
                    channel: channel2,
                    bucketGeneration: 0,
                    latestPost: {post: post4, contentTextSnippet: expect.any(String)},
                }),
                expectInboxChannelPostsEntryModel({
                    session: scenario.session1,
                    channel: channel1,
                    bucketGeneration: 0,
                    latestPost: {post: post3, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session2,
                    channel: channel1,
                    bucketGeneration: 0,
                    posts: [post1, post2],
                    latestPost: {post: post2, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session3,
                    channel: channel2,
                    bucketGeneration: 0,
                    latestPost: {post: post4, contentTextSnippet: expect.any(String)},
                }),
                expectInboxChannelPostsEntryModel({
                    session: scenario.session3,
                    channel: channel1,
                    bucketGeneration: 0,
                    posts: [post1, post2, post3],
                    latestPost: {post: post3, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(session4)).toEqual([]);

            expect(await testGetInboxEntries(session5)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: session5,
                    channel: channel2,
                    bucketGeneration: 0,
                    latestPost: {post: post4, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(scenario.sharedSession)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.sharedSession,
                    channel: channel2,
                    bucketGeneration: 0,
                    latestPost: {post: post4, contentTextSnippet: expect.any(String)},
                }),
                expectInboxChannelPostsEntryModel({
                    session: scenario.sharedSession,
                    channel: channel1,
                    bucketGeneration: 0,
                    posts: [post1, post2, post3],
                    latestPost: {post: post3, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(scenario.otherSession)).toEqual([]);
        });

        test("creating posts updates an entry for every subscriber unless the subscriber lost channel access", async () => {
            const scenario = await createNotificationsTestScenario(context);

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

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([]);

            expect(await testGetInboxEntries(session4)).toEqual([]);

            expect(await testGetInboxEntries(scenario.sharedSession)).toEqual([]);

            const post1 = await channel.createPost(session4);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session2,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post: post1, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session3,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post: post1, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(session4)).toEqual([]);

            expect(await testGetInboxEntries(scenario.sharedSession)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.sharedSession,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post: post1, contentTextSnippet: expect.any(String)},
                }),
            ]);

            await channel.access.revoke(scenario.session2, scenario.sharedSession);

            const post2 = await channel.createPost(scenario.session3);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session2,
                    channel,
                    bucketGeneration: 0,
                    posts: [post1, post2],
                    latestPost: {post: post2, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session3,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post: post1, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(session4)).toEqual([]);

            expect(await testGetInboxEntries(scenario.sharedSession)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.sharedSession,
                    channel: {isPrivate: true, channelId: channel.id},
                    bucketGeneration: 0,
                    latestPost: {post: post1, contentTextSnippet: ""},
                }),
            ]);

            await channel.access.grant(scenario.session2, scenario.session1);

            const post3 = await channel.createPost(scenario.session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session1,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post: post3, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session2,
                    channel,
                    bucketGeneration: 0,
                    posts: [post1, post2],
                    latestPost: {post: post2, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session3,
                    channel,
                    bucketGeneration: 0,
                    posts: [post1, post3],
                    latestPost: {post: post3, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(await testGetInboxEntries(session4)).toEqual([]);

            expect(await testGetInboxEntries(scenario.sharedSession)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.sharedSession,
                    channel: {isPrivate: true, channelId: channel.id},
                    bucketGeneration: 0,
                    latestPost: {post: post1, contentTextSnippet: ""},
                }),
            ]);
        });

        test("can not get inbox entry posts for a space you don’t have access to", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const channel = await TestChannel.create(scenario.session2);

            await channel.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            await expect(
                testGetInboxChannelPostsEntryPosts(context.action(scenario.otherSession), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 0,
                    commentLimit: 100,
                }),
            ).rejects.toThrow(PermissionDeniedError);
        });

        test("getting inbox entry posts freezes the inbox entry", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const channel = await TestChannel.create(scenario.session2);

            const post1 = await channel.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            const post2 = await channel.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session2,
                    channel,
                    bucketGeneration: 0,
                    posts: [post1, post2],
                    latestPost: {post: post2, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(
                await testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 0,
                    commentLimit: 100,
                }),
            ).toEqual(await runAllPromises([post2.get(), post1.get()]));

            await expect(
                testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 4,
                    commentLimit: 100,
                }),
            ).rejects.toThrow(NotFoundError);

            const post3 = await channel.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session2,
                    channel,
                    bucketGeneration: 2,
                    latestPost: {post: post3, contentTextSnippet: expect.any(String)},
                }),
                expectInboxChannelPostsEntryModel({
                    session: scenario.session2,
                    channel,
                    bucketGeneration: 0,
                    posts: [post1, post2],
                    latestPost: {post: post2, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(
                await testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 0,
                    commentLimit: 100,
                }),
            ).toEqual(await runAllPromises([post2.get(), post1.get()]));

            expect(
                await testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 2,
                    commentLimit: 100,
                }),
            ).toEqual(await runAllPromises([post3.get()]));

            const post4 = await channel.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session2,
                    channel,
                    bucketGeneration: 4,
                    latestPost: {post: post4, contentTextSnippet: expect.any(String)},
                }),
                expectInboxChannelPostsEntryModel({
                    session: scenario.session2,
                    channel,
                    bucketGeneration: 2,
                    latestPost: {post: post3, contentTextSnippet: expect.any(String)},
                }),
                expectInboxChannelPostsEntryModel({
                    session: scenario.session2,
                    channel,
                    bucketGeneration: 0,
                    posts: [post1, post2],
                    latestPost: {post: post2, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(
                await testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 0,
                    commentLimit: 100,
                }),
            ).toEqual(await runAllPromises([post2.get(), post1.get()]));

            expect(
                await testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 2,
                    commentLimit: 100,
                }),
            ).toEqual(await runAllPromises([post3.get()]));

            expect(
                await testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 4,
                    commentLimit: 100,
                }),
            ).toEqual(await runAllPromises([post4.get()]));
        });

        test("getting inbox entry posts does not observe if inbox was already observed", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const channel = await TestChannel.create(scenario.session2);

            const post1 = await channel.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            const post2 = await channel.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session2,
                    channel,
                    bucketGeneration: 0,
                    posts: [post1, post2],
                    latestPost: {post: post2, contentTextSnippet: expect.any(String)},
                }),
            ]);

            await observeInbox(context.action(scenario.session2), {spaceId: scenario.space.id});

            const post3 = await channel.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session2,
                    channel,
                    bucketGeneration: 2,
                    latestPost: {post: post3, contentTextSnippet: expect.any(String)},
                }),
                expectInboxChannelPostsEntryModel({
                    session: scenario.session2,
                    channel,
                    bucketGeneration: 0,
                    posts: [post1, post2],
                    latestPost: {post: post2, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(
                await testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 0,
                    commentLimit: 100,
                }),
            ).toEqual(await runAllPromises([post2.get(), post1.get()]));

            const post4 = await channel.createPost(scenario.session1);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session2,
                    channel,
                    bucketGeneration: 2,
                    posts: [post3, post4],
                    latestPost: {post: post4, contentTextSnippet: expect.any(String)},
                }),
                expectInboxChannelPostsEntryModel({
                    session: scenario.session2,
                    channel,
                    bucketGeneration: 0,
                    posts: [post1, post2],
                    latestPost: {post: post2, contentTextSnippet: expect.any(String)},
                }),
            ]);

            expect(
                await testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 0,
                    commentLimit: 100,
                }),
            ).toEqual(await runAllPromises([post2.get(), post1.get()]));

            expect(
                await testGetInboxChannelPostsEntryPosts(context.action(scenario.session2), {
                    spaceId: scenario.space.id,
                    channelId: channel.id,
                    bucketGeneration: 2,
                    commentLimit: 100,
                }),
            ).toEqual(await runAllPromises([post4.get(), post3.get()]));
        });

        test("account can’t backfill in a space it can’t access", async () => {
            const scenario = await createNotificationsTestScenario(context);

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
                            model: expectInboxChannelPostsEntryModel({
                                session: scenario.session3,
                                channel,
                                bucketGeneration: 0,
                                latestPost: {post, contentTextSnippet: expect.any(String)},
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
            const scenario = await createNotificationsTestScenario(context);

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
                            model: expectInboxChannelPostsEntryModel({
                                session: scenario.session3,
                                channel,
                                bucketGeneration: 0,
                                latestPost: {post, contentTextSnippet: expect.any(String)},
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

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: session2,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post, contentTextSnippet: expect.any(String)},
                }),
            ]);

            await post.createComment(session2, "Test comment 1");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            const comment2 = await post.createComment(session1, "Test comment 2");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: session2,
                    post,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: "Test comment 2",
                    },
                }),
            ]);

            const comment3 = await post.createComment(session1, "Test comment 3");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: session2,
                    post,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "Test comment 3",
                    },
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

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: session2,
                    post,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment4,
                        contentTextSnippet: `Test comment 4 ${session2.account.initialName}`,
                        isStickyMention: true,
                    },
                }),
            ]);

            await post.createComment(session1, "Test comment 5");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: session2,
                    post,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment4,
                        contentTextSnippet: `Test comment 4 ${session2.account.initialName}`,
                        isStickyMention: true,
                    },
                }),
            ]);

            await post.createComment(session1, "Test comment 6");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: session2,
                    post,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment4,
                        contentTextSnippet: `Test comment 4 ${session2.account.initialName}`,
                        isStickyMention: true,
                    },
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

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: session2,
                    post,
                    loudNotificationCount: 2,
                    latestComment: {
                        comment: comment7,
                        contentTextSnippet: `Test comment 7 ${session2.account.initialName}`,
                        isStickyMention: true,
                    },
                }),
            ]);

            await post.createComment(session1, "Test comment 8");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: session2,
                    post,
                    loudNotificationCount: 2,
                    latestComment: {
                        comment: comment7,
                        contentTextSnippet: `Test comment 7 ${session2.account.initialName}`,
                        isStickyMention: true,
                    },
                }),
            ]);

            await archiveInboxEntry(session2.action().clone({apns: new TestApnsContextModule()}), {
                spaceId: space.id,
                key: {type: "PostComments", postId: post.id},
            });

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            const comment9 = await post.createComment(session1, "Test comment 9");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: session2,
                    post,
                    latestComment: {
                        comment: comment9,
                        contentTextSnippet: "Test comment 9",
                    },
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
                withoutInviteForTest: true,
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

            expect(await testGetInboxEntries(session1)).toEqual([]);

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: session2,
                    post,
                    loudNotificationCount: 1,
                    postContentTextSnippet: `Hello ${session2.account.initialName}`,
                    isForPostContentMention: true,
                }),
            ]);

            expect(await testGetInboxEntries(session3)).toEqual([]);

            expect(await testGetInboxEntries(session4)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: session4,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post, contentTextSnippet: `Hello ${session2.account.initialName}`},
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

            expect(await testGetInboxEntries(session1)).toEqual([]);

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session3)).toEqual([]);

            expect(await testGetInboxEntries(session4)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: session4,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post, contentTextSnippet: `Hello ${session2.account.initialName}`},
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

            expect(await testGetInboxEntries(session1)).toEqual([]);

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: session2,
                    post,
                    loudNotificationCount: 1,
                    postContentTextSnippet: `Hello ${session2.account.initialName}`,
                    isForPostContentMention: true,
                }),
            ]);

            await channel.access.revoke(session1, session2);

            expect(await testGetInboxEntries(session1)).toEqual([]);

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: session2,
                    post,
                    channel: {isPrivate: true},
                    loudNotificationCount: 1,
                    isForPostContentMention: true,
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
            await ProcessContextModule.waitForTestTasks();

            const comment2 = await post.createComment(session1, "comment2");
            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session1)).toEqual([]);

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: session2,
                    post,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: "comment2",
                    },
                }),
            ]);

            await channel.access.revoke(session1, session2);

            expect(await testGetInboxEntries(session1)).toEqual([]);

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: session2,
                    post,
                    channel: {isPrivate: true},
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: "",
                    },
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

            expect(await testGetInboxEntries(session1)).toEqual([]);

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: session2,
                    post,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${session2.account.initialName}`,
                        isStickyMention: true,
                    },
                }),
            ]);

            await channel.access.revoke(session1, session2);

            expect(await testGetInboxEntries(session1)).toEqual([]);

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: session2,
                    post,
                    channel: {isPrivate: true},
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: "",
                        isStickyMention: true,
                    },
                }),
            ]);
        });

        test("multiline post content is printed in the text snippet", async () => {
            const scenario = await createNotificationsTestScenario(context);

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

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: scenario.session2,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {
                        post,
                        contentTextSnippet:
                            "Yes. But actually this other thing. And one final thing!",
                    },
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

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: session2,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post, contentTextSnippet: "Can you see this? TOP SECRET"},
                }),
            ]);

            expect(await testGetInboxEntries(session3)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: session3,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post, contentTextSnippet: "Can you see this? Private document"},
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
                                        model: expectInboxChannelPostsEntryModel({
                                            session: session2,
                                            channel,
                                            bucketGeneration: 0,
                                            latestPost: {
                                                post,
                                                contentTextSnippet: "Can you see this? TOP SECRET",
                                            },
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
                                        model: expectInboxChannelPostsEntryModel({
                                            session: session3,
                                            channel,
                                            bucketGeneration: 0,
                                            latestPost: {
                                                post,
                                                contentTextSnippet:
                                                    "Can you see this? Private document",
                                            },
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

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: session2,
                    post,
                    latestComment: {
                        comment,
                        contentTextSnippet: "Can you see this? TOP SECRET",
                    },
                    otherCommentAuthor: expect.any(AccountModel),
                }),
            ]);

            expect(await testGetInboxEntries(session3)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: session3,
                    post,
                    latestComment: {
                        comment,
                        contentTextSnippet: "Can you see this? Private document",
                    },
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
                                        model: expectInboxPostCommentsEntryModel({
                                            session: session2,
                                            post,
                                            channel,
                                            latestComment: {
                                                comment,
                                                contentTextSnippet: "Can you see this? TOP SECRET",
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
                                        model: expectInboxPostCommentsEntryModel({
                                            session: session3,
                                            post,
                                            channel,
                                            latestComment: {
                                                comment,
                                                contentTextSnippet:
                                                    "Can you see this? Private document",
                                            },
                                        }),
                                    },
                                },
                            ],
                        },
                    ],
                ]),
            );
        });

        test("creating a post also creates a `PostInChannelPostsEntry` item", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            const post = await channel.createPost(session1, "test");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: session2,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post, contentTextSnippet: "test"},
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);

            expect(
                await NotificationsTable.getItem(context, {
                    partitionType: "Inbox",
                    sortRangeType: "PostInChannelPostsEntry",
                    spaceId: space.id,
                    accountId: session2.account.id,
                    postId: post.id,
                }),
            ).toEqual(
                expect.objectContaining({
                    channelPostsEntry: {
                        channelId: channel.id,
                        bucketGeneration: 0,
                    },
                }),
            );
        });

        test("creating a post also creates a `PostInChannelPostsEntry` item at later inbox generation", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            await observeInbox(session2.action(), {spaceId: space.id});
            await observeInbox(session2.action(), {spaceId: space.id});
            await observeInbox(session2.action(), {spaceId: space.id});

            const post = await channel.createPost(session1, "test");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: session2,
                    channel,
                    bucketGeneration: 6,
                    latestPost: {post, contentTextSnippet: "test"},
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);

            expect(
                await NotificationsTable.getItem(context, {
                    partitionType: "Inbox",
                    sortRangeType: "PostInChannelPostsEntry",
                    spaceId: space.id,
                    accountId: session2.account.id,
                    postId: post.id,
                }),
            ).toEqual(
                expect.objectContaining({
                    channelPostsEntry: {
                        channelId: channel.id,
                        bucketGeneration: 6,
                    },
                }),
            );
        });

        test("creating multiple posts in a channel posts entry also creates multiple `PostInChannelPostsEntry` items", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            const post1 = await channel.createPost(session1, "test1");
            const post2 = await channel.createPost(session1, "test2");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: session2,
                    channel,
                    bucketGeneration: 0,
                    posts: [post1, post2],
                    latestPost: {post: post2, contentTextSnippet: "test2"},
                }),
            ]);

            expect(
                await NotificationsTable.getItem(context, {
                    partitionType: "Inbox",
                    sortRangeType: "PostInChannelPostsEntry",
                    spaceId: space.id,
                    accountId: session2.account.id,
                    postId: post1.id,
                }),
            ).toEqual(
                expect.objectContaining({
                    channelPostsEntry: {
                        channelId: channel.id,
                        bucketGeneration: 0,
                    },
                }),
            );

            expect(
                await NotificationsTable.getItem(context, {
                    partitionType: "Inbox",
                    sortRangeType: "PostInChannelPostsEntry",
                    spaceId: space.id,
                    accountId: session2.account.id,
                    postId: post2.id,
                }),
            ).toEqual(
                expect.objectContaining({
                    channelPostsEntry: {
                        channelId: channel.id,
                        bucketGeneration: 0,
                    },
                }),
            );

            const post3 = await channel.createPost(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: session2,
                    channel,
                    bucketGeneration: 0,
                    posts: [post1, post2, post3],
                    latestPost: {post: post3, contentTextSnippet: "test3"},
                }),
            ]);

            expect(
                await NotificationsTable.getItem(context, {
                    partitionType: "Inbox",
                    sortRangeType: "PostInChannelPostsEntry",
                    spaceId: space.id,
                    accountId: session2.account.id,
                    postId: post3.id,
                }),
            ).toEqual(
                expect.objectContaining({
                    channelPostsEntry: {
                        channelId: channel.id,
                        bucketGeneration: 0,
                    },
                }),
            );
        });

        test("responding to a comment on a post in a channel posts entry archives the channel posts entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            const post = await channel.createPost(session1, "test1");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: session2,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post, contentTextSnippet: "test1"},
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);

            const comment = await post.createComment(session2, "test2");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: session2,
                    post,
                    latestComment: {comment, contentTextSnippet: "test2"},
                }),
            ]);
        });

        test("responding to every post in a channel posts entry archives the channel posts entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            const post1 = await channel.createPost(session1, "test1");
            await ProcessContextModule.waitForTestTasks();

            const post2 = await channel.createPost(session1, "test2");
            await ProcessContextModule.waitForTestTasks();

            const post3 = await channel.createPost(session1, "test3");
            await ProcessContextModule.waitForTestTasks();

            const comment1 = await post1.createComment(session2, "test4");
            const comment2 = await post3.createComment(session2, "test5");

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
                    post: post3,
                    channel,
                    latestComment: {comment: comment2, contentTextSnippet: "test5"},
                }),
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: session2,
                    post: post1,
                    channel,
                    latestComment: {comment: comment1, contentTextSnippet: "test4"},
                }),
            ]);

            const comment3 = await post2.createComment(session2, "test6");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: session2,
                    post: post2,

                    latestComment: {comment: comment3, contentTextSnippet: "test6"},
                }),
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: session2,
                    post: post3,
                    channel,
                    latestComment: {comment: comment2, contentTextSnippet: "test5"},
                }),
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: session2,
                    post: post1,
                    channel,
                    latestComment: {comment: comment1, contentTextSnippet: "test4"},
                }),
            ]);
        });

        test("being mentioned in a post in a channel posts entry archives the channel posts entry", async () => {
            const schema = MessageContentProsemirrorSchema;

            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            const post = await channel.createPost(session1, "test1");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: session2,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post, contentTextSnippet: "test1"},
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);

            const comment = await post.createComment(
                session1,
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
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: session2,
                    post,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment,
                        contentTextSnippet: `Hello ${session2.account.initialName}`,
                        isStickyMention: true,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);
        });

        test("being mentioned in every post in a channel posts entry archives the channel posts entry", async () => {
            const schema = MessageContentProsemirrorSchema;

            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            const post1 = await channel.createPost(session1, "test1");
            await ProcessContextModule.waitForTestTasks();

            const post2 = await channel.createPost(session1, "test2");
            await ProcessContextModule.waitForTestTasks();

            const post3 = await channel.createPost(session1, "test3");
            await ProcessContextModule.waitForTestTasks();

            const comment1 = await post1.createComment(
                session1,
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
                        schema.text(" (1)"),
                    ]),
                ]),
            );

            await ProcessContextModule.waitForTestTasks();

            const comment2 = await post3.createComment(
                session1,
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
                        schema.text(" (2)"),
                    ]),
                ]),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: session2,
                    post: post3,
                    channel,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${session2.account.initialName} (2)`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: session2,
                    post: post1,
                    channel,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${session2.account.initialName} (1)`,
                        isStickyMention: true,
                    },
                }),
                expectInboxChannelPostsEntryModel({
                    session: session2,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post: post2, contentTextSnippet: "test2"},
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);

            const comment3 = await post2.createComment(
                session1,
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
                        schema.text(" (3)"),
                    ]),
                ]),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: session2,
                    post: post2,

                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: `Hello ${session2.account.initialName} (3)`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: session2,
                    post: post3,
                    channel,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment2,
                        contentTextSnippet: `Hello ${session2.account.initialName} (2)`,
                        isStickyMention: true,
                    },
                }),
                expectInboxPostCommentsEntryModel({
                    session: session2,
                    post: post1,
                    channel,
                    loudNotificationCount: 1,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello ${session2.account.initialName} (1)`,
                        isStickyMention: true,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);
        });

        test("post comment notification event is processed before create post notification event", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3] = await space.createSessions(3);

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            await ProcessContextModule.waitForTestTasks();

            const pauseBeforeCreatePostPromise =
                notificationEventBeforeProcessingTestCheckpoint.pauseForTest(session1.account.id);

            const pauseAfterFirstCommentPromise =
                notificationEventAfterProcessingTestCheckpoint.pauseForTest(session2.account.id);

            const pauseAfterSecondCommentPromise =
                notificationEventAfterProcessingTestCheckpoint.pauseForTest(session3.account.id);

            const post = await channel.createPost(session1, "test1");

            await post.createComment(session2, "test2");
            const secondComment = await post.createComment(session3, "test3");

            const {unpause: unpauseBeforeCreatePost} = await pauseBeforeCreatePostPromise;

            const {unpause: unpauseAfterFirstComment} = await pauseAfterFirstCommentPromise;
            unpauseAfterFirstComment();

            const {unpause: unpauseAfterSecondComment} = await pauseAfterSecondCommentPromise;
            unpauseAfterSecondComment();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: session2,
                    post,
                    latestComment: {comment: secondComment, contentTextSnippet: "test3"},
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);

            unpauseBeforeCreatePost();

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: session2,
                    post,
                    latestComment: {comment: secondComment, contentTextSnippet: "test3"},
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);
        });

        test("post comment notification event is processed before create post notification event when there’s an existing channel posts entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3] = await space.createSessions(3);

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            const post1 = await channel.createPost(session1, "test1");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: session2,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post: post1, contentTextSnippet: "test1"},
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);

            const pauseBeforeCreatePostPromise =
                notificationEventBeforeProcessingTestCheckpoint.pauseForTest(session1.account.id);

            const pauseAfterFirstCommentPromise =
                notificationEventAfterProcessingTestCheckpoint.pauseForTest(session2.account.id);

            const pauseAfterSecondCommentPromise =
                notificationEventAfterProcessingTestCheckpoint.pauseForTest(session3.account.id);

            const post2 = await channel.createPost(session1, "test2");

            await post2.createComment(session2, "test3");
            const secondComment = await post2.createComment(session3, "test4");

            const {unpause: unpauseBeforeCreatePost} = await pauseBeforeCreatePostPromise;

            const {unpause: unpauseAfterFirstComment} = await pauseAfterFirstCommentPromise;
            unpauseAfterFirstComment();

            const {unpause: unpauseAfterSecondComment} = await pauseAfterSecondCommentPromise;
            unpauseAfterSecondComment();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: session2,
                    post: post2,

                    latestComment: {comment: secondComment, contentTextSnippet: "test4"},
                }),
                expectInboxChannelPostsEntryModel({
                    session: session2,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post: post1, contentTextSnippet: "test1"},
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);

            unpauseBeforeCreatePost();

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: session2,
                    post: post2,

                    latestComment: {comment: secondComment, contentTextSnippet: "test4"},
                }),
                expectInboxChannelPostsEntryModel({
                    session: session2,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post: post1, contentTextSnippet: "test1"},
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);
        });

        test("post comment notification event processing starts before post event processing is finished", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3] = await space.createSessions(3);

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            await ProcessContextModule.waitForTestTasks();

            const pauseBeforeCreatePostPromise =
                notificationEventBeforeProcessingTestCheckpoint.pauseForTest(session1.account.id);

            const pauseAfterCreatePostPromise =
                notificationEventAfterProcessingTestCheckpoint.pauseForTest(session1.account.id);

            const pauseAfterCreateFirstCommentPromise =
                notificationEventAfterProcessingTestCheckpoint.pauseForTest(session2.account.id);

            const pauseBeforeCreateSecondCommentPromise =
                updateInboxEntryBeforeExecuteTransactionTestCheckpoint.pauseForTest(
                    session3.account.id,
                );

            const post = await channel.createPost(session1, "test1");

            await post.createComment(session2, "test2");
            const secondComment = await post.createComment(session3, "test3");

            const {unpause: unpauseBeforeCreatePost} = await pauseBeforeCreatePostPromise;

            const {unpause: unpauseAfterCreateFirstComment} =
                await pauseAfterCreateFirstCommentPromise;
            unpauseAfterCreateFirstComment();

            const {unpause: unpauseBeforeCreateSecondComment} =
                await pauseBeforeCreateSecondCommentPromise;

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);

            unpauseBeforeCreatePost();

            const {unpause: unpauseAfterCreatePost} = await pauseAfterCreatePostPromise;
            unpauseAfterCreatePost();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);

            unpauseBeforeCreateSecondComment();

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: session2,
                    post,
                    latestComment: {comment: secondComment, contentTextSnippet: "test3"},
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);
        });

        test("post comment notification event processing starts before post event processing is finished (when there are multiple posts in a channel posts notification)", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3, session4, session5] = await space.createSessions(
                5,
            );

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            await ProcessContextModule.waitForTestTasks();

            const pauseBeforeCreatePostPromise =
                notificationEventBeforeProcessingTestCheckpoint.pauseForTest(session1.account.id);

            const pauseAfterCreatePostPromise =
                notificationEventAfterProcessingTestCheckpoint.pauseForTest(session1.account.id);

            const pauseAfterCreateFirstCommentPromise =
                notificationEventAfterProcessingTestCheckpoint.pauseForTest(session2.account.id);

            const pauseBeforeCreateSecondCommentPromise =
                updateInboxEntryBeforeExecuteTransactionTestCheckpoint.pauseForTest(
                    session3.account.id,
                );

            const pauseAfterCreateOtherPost1Promise =
                notificationEventAfterProcessingTestCheckpoint.pauseForTest(session4.account.id);

            const pauseAfterCreateOtherPost2Promise =
                notificationEventAfterProcessingTestCheckpoint.pauseForTest(session5.account.id);

            const otherPost1 = await channel.createPost(session4, "test1");
            const otherPost2 = await channel.createPost(session5, "test2");
            const post = await channel.createPost(session1, "test3");

            await post.createComment(session2, "test4");
            const secondComment = await post.createComment(session3, "test5");

            const {unpause: unpauseBeforeCreatePost} = await pauseBeforeCreatePostPromise;

            const {unpause: unpauseAfterCreateFirstComment} =
                await pauseAfterCreateFirstCommentPromise;
            unpauseAfterCreateFirstComment();

            const {unpause: unpauseBeforeCreateSecondComment} =
                await pauseBeforeCreateSecondCommentPromise;

            const {unpause: unpauseAfterCreateOtherPost1} = await pauseAfterCreateOtherPost1Promise;
            unpauseAfterCreateOtherPost1();

            const {unpause: unpauseAfterCreateOtherPost2} = await pauseAfterCreateOtherPost2Promise;
            unpauseAfterCreateOtherPost2();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: session2,
                    channel,
                    bucketGeneration: 0,
                    posts: [otherPost1, otherPost2],
                    latestPost: {post: otherPost2, contentTextSnippet: "test2"},
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);

            unpauseBeforeCreatePost();

            const {unpause: unpauseAfterCreatePost} = await pauseAfterCreatePostPromise;
            unpauseAfterCreatePost();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: session2,
                    channel,
                    bucketGeneration: 0,
                    posts: [otherPost1, otherPost2],
                    latestPost: {post: otherPost2, contentTextSnippet: "test2"},
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);

            unpauseBeforeCreateSecondComment();

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    session: session2,
                    post,
                    latestComment: {comment: secondComment, contentTextSnippet: "test5"},
                }),
                expectInboxChannelPostsEntryModel({
                    session: session2,
                    channel,
                    bucketGeneration: 0,
                    posts: [otherPost1, otherPost2],
                    latestPost: {post: otherPost2, contentTextSnippet: "test2"},
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);
        });

        test("archiving a channel posts entry with one post archives that one post as well", async () => {
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

        test("archiving a channel posts entry with multiple posts archives all the posts", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            const post1 = await channel.createPost(session1, "test1");
            await ProcessContextModule.waitForTestTasks();

            const post2 = await channel.createPost(session1, "test2");
            await ProcessContextModule.waitForTestTasks();

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

        test("unarchiving a channel posts entry with one post unarchives that one post as well", async () => {
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

            await unarchiveInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {
                    type: "ChannelPosts",
                    channelId: channel.id,
                    bucketGeneration: 0,
                },
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

        test("unarchiving a channel posts entry with multiple posts unarchives all the posts as well", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            const post1 = await channel.createPost(session1, "test1");
            await ProcessContextModule.waitForTestTasks();

            const post2 = await channel.createPost(session1, "test2");
            await ProcessContextModule.waitForTestTasks();

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

            await unarchiveInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {
                    type: "ChannelPosts",
                    channelId: channel.id,
                    bucketGeneration: 0,
                },
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

        test("setting a reaction on a post comment archives the post comment inbox entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            const post = await channel.createPost(
                session1,
                schema.node("doc", null, [
                    schema.node("paragraph", null, [
                        schema.text("Hello, "),
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

            await ProcessContextModule.waitForTestTasks();

            const comment1 = await post.createComment(session1, "test1");

            await ProcessContextModule.waitForTestTasks();

            await comment1.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: session2,
                    post,
                    postContentTextSnippet: `Hello, ${session2.account.initialName}!`,
                    isForPostContentMention: true,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: "test1",
                    },
                }),
            ]);
        });

        test("setting a reaction on a post comment that’s not the latest comment archives the post comment inbox entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            const post = await channel.createPost(
                session1,
                schema.node("doc", null, [
                    schema.node("paragraph", null, [
                        schema.text("Hello, "),
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

            await ProcessContextModule.waitForTestTasks();

            const comment1 = await post.createComment(session1, "test1");
            await post.createComment(session1, "test2");
            const comment3 = await post.createComment(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            await comment1.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: session2,
                    post,
                    postContentTextSnippet: `Hello, ${session2.account.initialName}!`,
                    isForPostContentMention: true,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "test3",
                    },
                }),
            ]);
        });

        test("setting a reaction on the latest post comment archives the post comment inbox entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            const post = await channel.createPost(
                session1,
                schema.node("doc", null, [
                    schema.node("paragraph", null, [
                        schema.text("Hello, "),
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

            await ProcessContextModule.waitForTestTasks();

            await post.createComment(session1, "test1");
            await post.createComment(session1, "test2");
            const comment3 = await post.createComment(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            await comment3.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: session2,
                    post,
                    postContentTextSnippet: `Hello, ${session2.account.initialName}!`,
                    isForPostContentMention: true,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "test3",
                    },
                }),
            ]);
        });

        test("setting a reaction on a post archives the post comment inbox entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            const post = await channel.createPost(
                session1,
                schema.node("doc", null, [
                    schema.node("paragraph", null, [
                        schema.text("Hello, "),
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

            await ProcessContextModule.waitForTestTasks();

            await post.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: session2,
                    post,
                    postContentTextSnippet: `Hello, ${session2.account.initialName}!`,
                    isForPostContentMention: true,
                }),
            ]);
        });

        test("setting a reaction on a post with comments archives the post comment inbox entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            const post = await channel.createPost(
                session1,
                schema.node("doc", null, [
                    schema.node("paragraph", null, [
                        schema.text("Hello, "),
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

            await ProcessContextModule.waitForTestTasks();

            await post.createComment(session1, "test1");
            await post.createComment(session1, "test2");
            const comment3 = await post.createComment(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            await post.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: session2,
                    post,
                    postContentTextSnippet: `Hello, ${session2.account.initialName}!`,
                    isForPostContentMention: true,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "test3",
                    },
                }),
            ]);
        });

        test("setting a reaction on the latest post comment, explicitly unarchiving, then setting a reaction on a different post comment archives the post comment inbox entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            const post = await channel.createPost(
                session1,
                schema.node("doc", null, [
                    schema.node("paragraph", null, [
                        schema.text("Hello, "),
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

            await ProcessContextModule.waitForTestTasks();

            const comment1 = await post.createComment(session1, "test1");
            await post.createComment(session1, "test2");
            const comment3 = await post.createComment(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            await comment3.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            await unarchiveInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {
                    type: "PostComments",
                    postId: post.id,
                },
            });

            await comment1.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: session2,
                    post,
                    postContentTextSnippet: `Hello, ${session2.account.initialName}!`,
                    isForPostContentMention: true,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "test3",
                    },
                }),
            ]);
        });

        test("setting a reaction on the latest post comment, implicitly unarchiving, then setting a reaction on a different post comment archives the post comment inbox entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            const post = await channel.createPost(
                session1,
                schema.node("doc", null, [
                    schema.node("paragraph", null, [
                        schema.text("Hello, "),
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

            await ProcessContextModule.waitForTestTasks();

            const comment1 = await post.createComment(session1, "test1");
            await post.createComment(session1, "test2");
            const comment3 = await post.createComment(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            await comment3.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            const comment4 = await post.createComment(session1, "test4");

            await ProcessContextModule.waitForTestTasks();

            await comment1.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: session2,
                    post,
                    latestComment: {
                        comment: comment4,
                        contentTextSnippet: "test4",
                    },
                }),
            ]);
        });

        test("setting a reaction on the latest post comment, implicitly unarchiving, then setting a reaction on the latest post comment archives the post comment inbox entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            const post = await channel.createPost(
                session1,
                schema.node("doc", null, [
                    schema.node("paragraph", null, [
                        schema.text("Hello, "),
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

            await ProcessContextModule.waitForTestTasks();

            await post.createComment(session1, "test1");
            await post.createComment(session1, "test2");
            const comment3 = await post.createComment(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            await comment3.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            const comment4 = await post.createComment(session1, "test4");

            await ProcessContextModule.waitForTestTasks();

            await comment4.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: session2,
                    post,
                    latestComment: {
                        comment: comment4,
                        contentTextSnippet: "test4",
                    },
                }),
            ]);
        });

        test("setting a reaction on the latest post comment, explicitly unarchiving, then setting a reaction on the post archives the post comment inbox entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            const post = await channel.createPost(
                session1,
                schema.node("doc", null, [
                    schema.node("paragraph", null, [
                        schema.text("Hello, "),
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

            await ProcessContextModule.waitForTestTasks();

            await post.createComment(session1, "test1");
            await post.createComment(session1, "test2");
            const comment3 = await post.createComment(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            await comment3.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            await unarchiveInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {
                    type: "PostComments",
                    postId: post.id,
                },
            });

            await post.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: session2,
                    post,
                    postContentTextSnippet: `Hello, ${session2.account.initialName}!`,
                    isForPostContentMention: true,
                    latestComment: {
                        comment: comment3,
                        contentTextSnippet: "test3",
                    },
                }),
            ]);
        });

        test("setting a reaction on the latest post comment, implicitly unarchiving, then setting a reaction on the post archives the post comment inbox entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            const post = await channel.createPost(
                session1,
                schema.node("doc", null, [
                    schema.node("paragraph", null, [
                        schema.text("Hello, "),
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

            await ProcessContextModule.waitForTestTasks();

            await post.createComment(session1, "test1");
            await post.createComment(session1, "test2");
            const comment3 = await post.createComment(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            await comment3.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            const comment4 = await post.createComment(session1, "test4");

            await ProcessContextModule.waitForTestTasks();

            await post.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: session2,
                    post,
                    latestComment: {
                        comment: comment4,
                        contentTextSnippet: "test4",
                    },
                }),
            ]);
        });

        test("clears `isStickyMention` when archiving by reacting to a post comment", async () => {
            const schema = MessageContentProsemirrorSchema;

            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1);

            const post = await channel.createPost(session1, "test1");

            await ProcessContextModule.waitForTestTasks();

            const comment1 = await post.createComment(
                session1,
                schema.node("doc", null, [
                    schema.node("paragraph", null, [
                        schema.text("Hello, "),
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
            await post.createComment(session1, "test2");
            const comment3 = await post.createComment(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    loudNotificationCount: 1,
                    session: session2,
                    post,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello, ${session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);

            await comment3.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: session2,
                    post,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello, ${session2.account.initialName}!`,
                    },
                }),
            ]);
        });

        test("clears `isStickyMention` when archiving by reacting to a post", async () => {
            const schema = MessageContentProsemirrorSchema;

            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1);

            const post = await channel.createPost(session1, "test1");

            await ProcessContextModule.waitForTestTasks();

            const comment1 = await post.createComment(
                session1,
                schema.node("doc", null, [
                    schema.node("paragraph", null, [
                        schema.text("Hello, "),
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
            await post.createComment(session1, "test2");
            await post.createComment(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    loudNotificationCount: 1,
                    session: session2,
                    post,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello, ${session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);

            await post.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: session2,
                    post,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello, ${session2.account.initialName}!`,
                    },
                }),
            ]);
        });

        test("process setting post comment reaction before post comment notification event", async () => {
            const schema = MessageContentProsemirrorSchema;

            const space = await TestSpace.create(context);
            const [session1, session2, session3] = await space.createSessions(3);

            const channel = await TestChannel.create(session1);

            const post = await channel.createPost(session1, "test1");

            await ProcessContextModule.waitForTestTasks();

            const comment1 = await post.createComment(
                session1,
                schema.node("doc", null, [
                    schema.node("paragraph", null, [
                        schema.text("Hello, "),
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

            await ProcessContextModule.waitForTestTasks();

            const pause1Promise = notificationEventBeforeProcessingTestCheckpoint.pauseForTest(
                session3.account.id,
            );

            const pause2Promise =
                updateInboxEntryAfterExecuteTransactionTestCheckpoint.pauseForTest(
                    session2.account.id,
                );

            const comment2 = await post.createComment(session3, "test2");

            const {unpause: unpause1} = await pause1Promise;

            await comment2.setReaction(session2);

            const {unpause: unpause2} = await pause2Promise;
            unpause2();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: session2,
                    post,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello, ${session2.account.initialName}!`,
                    },
                }),
            ]);

            unpause1();

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxPostCommentsEntryModel({
                    isArchived: true,
                    session: session2,
                    post,
                    latestComment: {
                        comment: comment1,
                        contentTextSnippet: `Hello, ${session2.account.initialName}!`,
                    },
                }),
            ]);
        });

        test("reacting to a post comment archives the associated channel posts entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            const post = await channel.createPost(session1, "test1");

            await post.createComment(session1, "test2");
            await post.createComment(session1, "test3");
            const comment3 = await post.createComment(session1, "test4");

            await ProcessContextModule.waitForTestTasks();

            await comment3.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

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

        test("reacting to a post archives the associated channel posts entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            const post = await channel.createPost(session1, "test1");

            await post.createComment(session1, "test2");
            await post.createComment(session1, "test3");
            await post.createComment(session1, "test4");

            await ProcessContextModule.waitForTestTasks();

            await post.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

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

        test("reacting to a post comment archives the post in a channel posts entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            const post1 = await channel.createPost(session1, "test1");
            const post2 = await channel.createPost(session1, "test2");
            const post3 = await channel.createPost(session1, "test3");

            const comment = await post2.createComment(session1, "test4");

            await ProcessContextModule.waitForTestTasks();

            await comment.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

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
        });

        test("reacting to a post archives the post in a channel posts entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            const post1 = await channel.createPost(session1, "test1");
            const post2 = await channel.createPost(session1, "test2");
            const post3 = await channel.createPost(session1, "test3");

            await post2.createComment(session1, "test4");

            await ProcessContextModule.waitForTestTasks();

            await post2.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

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
        });

        test("reacting to a post comment archives the associated channel posts entry even if the reaction is processed before the create post notification event", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3] = await space.createSessions(3);

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            const pause1Promise = notificationEventBeforeProcessingTestCheckpoint.pauseForTest(
                session3.account.id,
            );

            const pause2Promise =
                updateInboxEntryAfterExecuteTransactionTestCheckpoint.pauseForTest(
                    session2.account.id,
                );

            const post = await channel.createPost(session3, "test1");

            await post.createComment(session1, "test2");
            await post.createComment(session1, "test3");
            const comment3 = await post.createComment(session1, "test4");

            const {unpause: unpause1} = await pause1Promise;

            await comment3.setReaction(session2);

            const {unpause: unpause2} = await pause2Promise;
            unpause2();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);

            unpause1();

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);
        });

        test("reacting to a post comment archives the associated post in a channel posts entry even if the reaction is processed before the create post notification event", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3] = await space.createSessions(3);

            const channel = await TestChannel.create(session1);
            await channel.subscribe(session2);

            const pause1Promise = notificationEventBeforeProcessingTestCheckpoint.pauseForTest(
                session3.account.id,
            );

            const pause2Promise =
                updateInboxEntryAfterExecuteTransactionTestCheckpoint.pauseForTest(
                    session2.account.id,
                );

            const post1 = await channel.createPost(session1, "test1");
            const post2 = await channel.createPost(session3, "test2");
            const post3 = await channel.createPost(session1, "test3");

            await post2.createComment(session1, "test4");
            await post2.createComment(session1, "test5");
            const comment3 = await post2.createComment(session1, "test6");

            const {unpause: unpause1} = await pause1Promise;

            await comment3.setReaction(session2);

            const {unpause: unpause2} = await pause2Promise;
            unpause2();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: session2,
                    channel,
                    bucketGeneration: 0,
                    posts: [post1, post3],
                    latestPost: {post: post3, contentTextSnippet: "test3"},
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);

            unpause1();

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChannelPostsEntryModel({
                    session: session2,
                    channel,
                    bucketGeneration: 0,
                    posts: [post1, post3],
                    latestPost: {post: post3, contentTextSnippet: "test3"},
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);
        });

        test("commenting on a post in a channel posts entry with a single post deletes the channel posts entry", async () => {
            const schema = MessageContentProsemirrorSchema;

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

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxChannelPostsEntryModel({
                    isArchived: true,
                    session: session2,
                    channel,
                    bucketGeneration: 0,
                    latestPost: {post: post, contentTextSnippet: "test1"},
                }),
            ]);

            const comment = await post.createComment(
                session1,
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

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxPostCommentsEntryModel({
                    loudNotificationCount: 1,
                    session: session2,
                    post,
                    latestComment: {
                        comment,
                        contentTextSnippet: `Hello ${session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);
        });
    });
}
