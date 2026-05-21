import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {processSendShareNotificationJob} from "~/server/chat/data/chat_messaging.js";
import {subscribeToRoomChat} from "~/server/chat/data/subscribe_to_room_chat.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestApnsContextModule} from "~/server/context/apns_context_module_base.js";
import {isServerActionContext} from "~/server/context/is_server_action_context.js";
import {TestWebPushContextModule} from "~/server/context/web_push_context_module.js";
import {getDocumentPreviewIfPossible} from "~/server/documents/data/documents_actions.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestPushContextModules} from "~/server/dynamo/test_helpers/create_test_push_context_modules.js";
import {CallBotWebhookJobDescription} from "~/server/jobs/core/job_description.js";
import {archiveInboxEntry} from "~/server/notifications/data/archive_inbox_entry.js";
import {getInbox} from "~/server/notifications/data/get_inbox.js";
import {
    updateInboxEntryAfterExecuteTransactionTestCheckpoint,
    updateInboxEntryAfterGetAttributesItemTestCheckpoint,
    updateInboxEntryBeforeExecuteTransactionTestCheckpoint,
    updateInboxEntryBeforeGetEntryItemTestCheckpoint,
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
import {expectInboxChatEntryModel} from "~/server/notifications/data/test_helpers/expect_inbox_chat_entry_model.js";
import {testGetInboxEntries} from "~/server/notifications/data/test_helpers/test_get_inbox_entries.js";
import {unarchiveInboxEntry} from "~/server/notifications/data/unarchive_inbox_entry.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {
    assertMessageContent,
    createSimpleMessageContent,
    emptyMessageContent,
    MessageContentProsemirrorSchema as schema,
} from "~/shared/content/message_content_schema.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {PermissionDeniedError, UnimplementedError} from "~/shared/error/error.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";
import {generateId} from "~/shared/id/id.js";
import {MyAccountBroadcastInboxRealtimeEventsSchema} from "~/shared/notifications/my_account_protocol.js";
import {parseSearchDynamicEntityId} from "~/shared/search/search_entity_id.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

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

let callBotWebhookJobs: Array<CallBotWebhookJobDescription> = [];

afterEach(() => {
    callBotWebhookJobs = [];
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
        } else if (job.type === "CallBotWebhook") {
            callBotWebhookJobs.push(job);
        } else {
            // Noop for other jobs...
        }
    },
    notificationsInjection,
    chatInjection,
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
                    type: "Document",
                    title: documentResult.value.getTitle(),
                    document: {
                        id: entityIdObject.documentId,
                        version: documentResult.value.version,
                    },
                }),
            };
        },
    },
});

// Exercise idempotency by running the test suite again with jobs processed twice.
for (const {type: currentProcessingType, processingMultiple} of testSuites) {
    // If another suite has `only` set then skip this suite so we only run the suite
    // with `only` set.
    if (
        testSuites.some(testSuite => !!testSuite.only && testSuite.type !== currentProcessingType)
    ) {
        continue;
    }

    describe(`processing: ${currentProcessingType}`, () => {
        beforeEach(() => {
            processingType = currentProcessingType;
        });

        test("messaging creates an inbox entry for all subscribers", async () => {
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

            const chat = await TestChat.get(
                scenario.session1,
                scenario.session2,
                scenario.session3,
            );

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([]);

            const message1 = await chat.sendMessage(scenario.session2, "message1");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: "message1",
                    },
                    otherChatAccount: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: "message1",
                    },
                    otherChatAccount: scenario.session1,
                }),
            ]);

            const message2 = await chat.sendMessage(scenario.session3, "message2");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message2,
                        contentTextSnippet: "message2",
                    },
                    otherChatAccount: scenario.session2,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message2,
                        contentTextSnippet: "message2",
                    },
                    otherChatAccount: scenario.session1,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([]);

            const message3 = await chat.sendMessage(scenario.session1, "message3");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session2,
                }),
            ]);

            // Make sure multiple processing is working.
            expect(getCount1()).toEqual(1 * processingMultiple);
            expect(getCount2()).toEqual(1 * processingMultiple);
            expect(getCount3()).toEqual(1 * processingMultiple);
        });

        test("mentioning someone in a creates a second loud notification for them", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const chat = await TestChat.get(
                scenario.session1,
                scenario.session2,
                scenario.session3,
            );

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([]);

            const message1 = await chat.sendMessage(scenario.session2, "message1");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: "message1",
                    },
                    otherChatAccount: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: "message1",
                    },
                    otherChatAccount: scenario.session1,
                }),
            ]);

            const message2 = await chat.sendMessage(
                scenario.session2,
                scenario.mentionAccount3MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message2,
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                    },
                    otherChatAccount: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat,
                    loudNotificationCount: 2,
                    latestMessage: {
                        message: message2,
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: scenario.session1,
                }),
            ]);

            const message3 = await chat.sendMessage(
                scenario.session2,
                scenario.mentionAccount1MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat,
                    loudNotificationCount: 2,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat,
                    loudNotificationCount: 2,
                    latestMessage: {
                        message: message2,
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: scenario.session1,
                }),
            ]);

            const message4 = await chat.sendMessage(
                scenario.session3,
                scenario.mentionAccount1MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat,
                    loudNotificationCount: 3,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: scenario.session2,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                    },
                    otherChatAccount: scenario.session1,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([]);
        });

        test("mentioning yourself does not create an extra loud notification for yourself", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const chat = await TestChat.get(
                scenario.session1,
                scenario.session2,
                scenario.session3,
            );

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([]);

            const message1 = await chat.sendMessage(scenario.session1, "message1");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: "message1",
                    },
                    otherChatAccount: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: "message1",
                    },
                    otherChatAccount: scenario.session2,
                }),
            ]);

            const message2 = await chat.sendMessage(
                scenario.session2,
                scenario.mentionAccount2MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message2,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                    otherChatAccount: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message2,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                    otherChatAccount: scenario.session1,
                }),
            ]);

            const message3 = await chat.sendMessage(scenario.session1, "message3");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session2,
                }),
            ]);

            const message4 = await chat.sendMessage(
                scenario.session2,
                scenario.mentionAccount2MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                    otherChatAccount: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                    otherChatAccount: scenario.session1,
                }),
            ]);
        });

        test("accounts have separate inboxes for each space", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const chat = await TestChat.get(scenario.session1, scenario.sharedSession);

            const otherChat = await TestChat.get(scenario.otherSession, scenario.sharedSession);

            expect(await testGetInboxEntries(scenario.sharedSession)).toEqual([]);

            expect(await testGetInboxEntries(scenario.sharedSession)).toEqual([]);

            const message1 = await chat.sendMessage(scenario.session1, "message1");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.sharedSession)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.sharedSession,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: "message1",
                    },
                    otherChatAccount: null,
                }),
            ]);

            expect(
                await testGetInboxEntries(scenario.sharedSession, {space: scenario.otherSpace}),
            ).toEqual([]);

            const message2 = await otherChat.sendMessage(scenario.otherSession, "message2");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.sharedSession)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.sharedSession,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: "message1",
                    },
                    otherChatAccount: null,
                }),
            ]);

            expect(
                await testGetInboxEntries(scenario.sharedSession, {space: scenario.otherSpace}),
            ).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.sharedSession,
                    chat: otherChat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message2,
                        contentTextSnippet: "message2",
                    },
                    otherChatAccount: null,
                }),
            ]);
        });

        test("account can not see mention in chat they don\u2019t have access to", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const chat1 = await TestChat.get(
                scenario.session1,
                scenario.session2,
                scenario.session3,
            );

            const chat2 = await TestChat.get(scenario.session1, scenario.session2);

            const otherChat = await TestChat.get(scenario.otherSession, scenario.sharedSession);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([]);

            await expect(
                testGetInboxEntries(scenario.session3, {space: scenario.otherSpace}),
            ).rejects.toThrow(PermissionDeniedError);

            const message1 = await chat1.sendMessage(
                scenario.session2,
                scenario.mentionAccount3MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat: chat1,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: scenario.session1,
                }),
            ]);

            await expect(
                testGetInboxEntries(scenario.session3, {space: scenario.otherSpace}),
            ).rejects.toThrow(PermissionDeniedError);

            await chat2.sendMessage(scenario.session2, scenario.mentionAccount3MessageContent);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat: chat1,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: scenario.session1,
                }),
            ]);

            await expect(
                testGetInboxEntries(scenario.session3, {space: scenario.otherSpace}),
            ).rejects.toThrow(PermissionDeniedError);

            await otherChat.sendMessage(
                scenario.otherSession,
                scenario.mentionAccount3MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat: chat1,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: scenario.session1,
                }),
            ]);

            await expect(
                testGetInboxEntries(scenario.session3, {space: scenario.otherSpace}),
            ).rejects.toThrow(PermissionDeniedError);
        });

        test("message notification events processed out of order result in the same latest message", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const chat = await TestChat.get(
                scenario.session1,
                scenario.session2,
                scenario.session3,
            );

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            await chat.sendMessage(scenario.session1, "message1");

            await ProcessContextModule.waitForTestTasks();

            const pause1Promise = notificationEventBeforeProcessingTestCheckpoint.pauseForTest(
                scenario.session1.account.id,
            );
            const pause2Promise = notificationEventAfterProcessingTestCheckpoint.pauseForTest(
                scenario.session3.account.id,
            );

            await chat.sendMessage(scenario.session1, scenario.mentionAccount2MessageContent);

            const message3 = await chat.sendMessage(scenario.session3, "message3");

            const {unpause: unpause1} = await pause1Promise;
            const {unpause: unpause2} = await pause2Promise;
            unpause2();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session2,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session1,
                }),
            ]);

            unpause1();
            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session2,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat,
                    loudNotificationCount: 2,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session1,
                }),
            ]);
        });

        test("message notification events processed out of order result in the same latest message including implicit archival states", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const chat = await TestChat.get(scenario.session1, scenario.session2);

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            await chat.sendMessage(scenario.session1, "message1");

            await ProcessContextModule.waitForTestTasks();

            const pause1Promise = notificationEventBeforeProcessingTestCheckpoint.pauseForTest(
                scenario.session1.account.id,
            );
            const pause2Promise = notificationEventAfterProcessingTestCheckpoint.pauseForTest(
                scenario.session2.account.id,
            );

            await chat.sendMessage(scenario.session1, scenario.mentionAccount2MessageContent);

            const message3 = await chat.sendMessage(scenario.session2, "message3");

            const {unpause: unpause1} = await pause1Promise;
            const {unpause: unpause2} = await pause2Promise;
            unpause2();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: null,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            unpause1();
            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: null,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);
        });

        test("loud notifications are always at the top of the inbox", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const chat1 = await TestChat.get(scenario.session1, scenario.session2);

            const chat2 = await TestChat.get(scenario.session1, scenario.session3);

            const chat3 = await TestChat.get(
                scenario.session1,
                scenario.session2,
                scenario.session3,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            const message1 = await chat1.sendMessage(scenario.session2, "message1");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat1,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: "message1",
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message2 = await chat2.sendMessage(
                scenario.session3,
                scenario.mentionAccount1MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message2,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat1,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: "message1",
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message3 = await chat3.sendMessage(scenario.session2, "message3");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session3,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message2,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat1,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: "message1",
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message4 = await chat1.sendMessage(scenario.session2, "message4");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session3,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message2,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat1,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: "message4",
                    },
                    otherChatAccount: null,
                }),
            ]);

            await chat2.sendMessage(scenario.session3, "message5");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session3,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message2,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat1,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: "message4",
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message6 = await chat1.sendMessage(
                scenario.session2,
                scenario.mentionAccount1MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat1,
                    loudNotificationCount: 2,
                    latestMessage: {
                        message: message6,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session3,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message2,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
            ]);

            await chat2.sendMessage(scenario.session3, "message7");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat1,
                    loudNotificationCount: 2,
                    latestMessage: {
                        message: message6,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session3,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message2,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message8 = await chat2.sendMessage(
                scenario.session3,
                scenario.mentionAccount1MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat2,
                    loudNotificationCount: 2,
                    latestMessage: {
                        message: message8,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat1,
                    loudNotificationCount: 2,
                    latestMessage: {
                        message: message6,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session3,
                }),
            ]);
        });

        test("can not observe inbox in a space you don\u2019t have access to", async () => {
            const scenario = await createNotificationsTestScenario(context);

            await expect(
                observeInbox(context.action(scenario.session1), {spaceId: scenario.otherSpace.id}),
            ).rejects.toThrow(PermissionDeniedError);
        });

        test("observing an inbox freezes loud notifications in place", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const chat1 = await TestChat.get(scenario.session1, scenario.session2);

            const chat2 = await TestChat.get(scenario.session1, scenario.session3);

            const chat3 = await TestChat.get(
                scenario.session1,
                scenario.session2,
                scenario.session3,
            );

            const chat4 = await TestChat.get(
                scenario.session1,
                scenario.session2,
                scenario.sharedSession,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            const message1 = await chat1.sendMessage(scenario.session2, "message1");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat1,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: "message1",
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message2 = await chat2.sendMessage(
                scenario.session3,
                scenario.mentionAccount1MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message2,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat1,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: "message1",
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message3 = await chat3.sendMessage(scenario.session2, "message3");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session3,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message2,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat1,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: "message1",
                    },
                    otherChatAccount: null,
                }),
            ]);

            await observeInbox(context.action(scenario.session1), {spaceId: scenario.space.id});

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session3,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message2,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat1,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: "message1",
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message4 = await chat4.sendMessage(scenario.session2, "message4");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: "message4",
                    },
                    otherChatAccount: scenario.sharedSession,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session3,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message2,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat1,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: "message1",
                    },
                    otherChatAccount: null,
                }),
            ]);

            await chat2.sendMessage(scenario.session3, "message5");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: "message4",
                    },
                    otherChatAccount: scenario.sharedSession,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session3,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message2,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat1,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: "message1",
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message6 = await chat3.sendMessage(scenario.session2, "message6");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: "message4",
                    },
                    otherChatAccount: scenario.sharedSession,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message6,
                        contentTextSnippet: "message6",
                    },
                    otherChatAccount: scenario.session3,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message2,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat1,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: "message1",
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message8 = await chat3.sendMessage(
                scenario.session2,
                scenario.mentionAccount1MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat3,
                    loudNotificationCount: 2,
                    latestMessage: {
                        message: message8,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: scenario.session3,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: "message4",
                    },
                    otherChatAccount: scenario.sharedSession,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message2,
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat1,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: "message1",
                    },
                    otherChatAccount: null,
                }),
            ]);
        });

        test("sends a loud notification on any message after some period of time", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const chat = await TestChat.get(
                scenario.session1,
                scenario.session2,
                scenario.session3,
            );

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            const message1 = await chat.sendMessage(scenario.session1, "message1");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: "message1",
                    },
                    otherChatAccount: scenario.session3,
                }),
            ]);

            const message2 = await chat.sendMessage(scenario.session3, "message2");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message2,
                        contentTextSnippet: "message2",
                    },
                    otherChatAccount: scenario.session2,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message2,
                        contentTextSnippet: "message2",
                    },
                    otherChatAccount: scenario.session1,
                }),
            ]);

            const message3 = await chat.sendMessage(scenario.session3, "message3");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session2,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session1,
                }),
            ]);

            const originalDateNow = Date.now;
            const mockTime = Date.now() + 1000 * 60 * 60 * 2;

            let message4;
            try {
                Date.now = () => mockTime;

                message4 = await chat.sendMessage(scenario.session3, "message4");
            } finally {
                Date.now = originalDateNow;
            }

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat,
                    loudNotificationCount: 2,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: "message4",
                    },
                    otherChatAccount: scenario.session2,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat,
                    loudNotificationCount: 2,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: "message4",
                    },
                    otherChatAccount: scenario.session1,
                }),
            ]);
        });

        test("can archive inbox entries", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const chat1 = await TestChat.get(
                scenario.session1,
                scenario.session2,
                scenario.session3,
            );

            const chat2 = await TestChat.get(
                scenario.session1,
                scenario.session2,
                scenario.session3,
                scenario.sharedSession,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            await chat1.sendMessage(scenario.session2, "message1");

            await chat1.sendMessage(scenario.session3, "message2");

            const message3 = await chat1.sendMessage(scenario.session1, "message3");

            const message4 = await chat2.sendMessage(
                scenario.session1,
                scenario.mentionAccount2MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat: chat2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat: chat1,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat: chat2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat: chat1,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session2,
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session3).clone(createTestPushContextModules()),
                {
                    spaceId: scenario.space.id,
                    key: {type: "Chat", chatId: chat1.id},
                },
            );

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat: chat2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat: chat1,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat: chat2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session2).clone(createTestPushContextModules()),
                {
                    spaceId: scenario.space.id,
                    key: {type: "Chat", chatId: chat2.id},
                },
            );

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat: chat1,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat: chat2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session2).clone(createTestPushContextModules()),
                {
                    spaceId: scenario.space.id,
                    key: {type: "Chat", chatId: chat1.id},
                },
            );

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat: chat2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
            ]);
        });

        test("can\u2019t archive inbox entries in space account lost access to", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const chat1 = await TestChat.get(
                scenario.session1,
                scenario.session2,
                scenario.session3,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            await chat1.sendMessage(scenario.session2, "message1");

            await chat1.sendMessage(scenario.session3, "message2");

            const message3 = await chat1.sendMessage(scenario.session1, "message3");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat: chat1,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session2,
                }),
            ]);

            await scenario.space.removeAccount(scenario.session3);

            await expect(
                archiveInboxEntry(
                    context.action(scenario.session3).clone({
                        apns: new TestApnsContextModule(),
                        webPush: new TestWebPushContextModule(),
                    }),
                    {
                        spaceId: scenario.space.id,
                        key: {type: "Chat", chatId: chat1.id},
                    },
                ),
            ).rejects.toThrow("Account doesn\u2019t have access to space");
        });

        test("can\u2019t archive inbox entries that don\u2019t exist", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const chat1 = await TestChat.get(
                scenario.session1,
                scenario.session2,
                scenario.session3,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            await chat1.sendMessage(scenario.session2, "message1");

            await chat1.sendMessage(scenario.session3, "message2");

            const message3 = await chat1.sendMessage(scenario.session1, "message3");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat: chat1,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session2,
                }),
            ]);

            await expect(
                archiveInboxEntry(
                    context.action(scenario.session3).clone({
                        apns: new TestApnsContextModule(),
                        webPush: new TestWebPushContextModule(),
                    }),
                    {
                        spaceId: scenario.space.id,
                        key: {type: "Chat", chatId: generateId()},
                    },
                ),
            ).rejects.toThrow("Inbox entry not found");
        });

        test("can unarchive inbox entries", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const chat1 = await TestChat.get(
                scenario.session1,
                scenario.session2,
                scenario.session3,
            );

            const chat2 = await TestChat.get(
                scenario.session1,
                scenario.session2,
                scenario.session3,
                scenario.sharedSession,
            );

            const chat3 = await TestChat.get(scenario.session1, scenario.session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            await ProcessContextModule.waitForTestTasks();

            await chat1.sendMessage(scenario.session2, "message1");

            await ProcessContextModule.waitForTestTasks();

            const message2 = await chat1.sendMessage(scenario.session3, "message2");

            await ProcessContextModule.waitForTestTasks();

            const message3 = await chat1.sendMessage(scenario.session1, "message3");

            await ProcessContextModule.waitForTestTasks();

            const message4 = await chat2.sendMessage(
                scenario.session1,
                scenario.mentionAccount2MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            const message5 = await chat3.sendMessage(
                scenario.session1,
                scenario.mentionAccount2MessageContent,
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat: chat3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message5,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat: chat2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat: chat1,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session3,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat: chat2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat: chat1,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session2,
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session3).clone(createTestPushContextModules()),
                {
                    spaceId: scenario.space.id,
                    key: {type: "Chat", chatId: chat1.id},
                },
            );

            await archiveInboxEntry(
                context.action(scenario.session2).clone(createTestPushContextModules()),
                {
                    spaceId: scenario.space.id,
                    key: {type: "Chat", chatId: chat2.id},
                },
            );

            await archiveInboxEntry(
                context.action(scenario.session2).clone(createTestPushContextModules()),
                {
                    spaceId: scenario.space.id,
                    key: {type: "Chat", chatId: chat1.id},
                },
            );

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat: chat3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message5,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat: chat2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
            ]);

            await unarchiveInboxEntry(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                key: {type: "Chat", chatId: chat1.id},
            });

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat: chat3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message5,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat: chat1,
                    loudNotificationCount: 0,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session2,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat: chat2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
            ]);

            await unarchiveInboxEntry(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                key: {type: "Chat", chatId: chat2.id},
            });

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat: chat2,
                    loudNotificationCount: 0,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat: chat3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message5,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat: chat1,
                    loudNotificationCount: 0,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session2,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat: chat2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
            ]);

            await unarchiveInboxEntry(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                key: {type: "Chat", chatId: chat1.id},
            });

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat: chat1,
                    loudNotificationCount: 0,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session3,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat: chat2,
                    loudNotificationCount: 0,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat: chat3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message5,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat: chat1,
                    loudNotificationCount: 0,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session2,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat: chat2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
            ]);

            await unarchiveInboxEntry(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                key: {type: "Chat", chatId: chat1.id},
            });

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat: chat1,
                    loudNotificationCount: 0,
                    latestMessage: {
                        message: message2,
                        contentTextSnippet: "message2",
                    },
                    otherChatAccount: scenario.session2,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat: chat1,
                    loudNotificationCount: 0,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session3,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat: chat2,
                    loudNotificationCount: 0,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
                expectInboxChatEntryModel({
                    session: scenario.session2,
                    chat: chat3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message5,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session3)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat: chat1,
                    loudNotificationCount: 0,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "message3",
                    },
                    otherChatAccount: scenario.session2,
                }),
                expectInboxChatEntryModel({
                    session: scenario.session3,
                    chat: chat2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
            ]);
        });

        test("notification on an archived entry revives it", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const chat = await TestChat.get(scenario.session1, scenario.session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            const message1 = await chat.sendMessage(scenario.session2, "message1");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: "message1",
                    },
                    otherChatAccount: null,
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session1).clone(createTestPushContextModules()),
                {
                    spaceId: scenario.space.id,
                    key: {type: "Chat", chatId: chat.id},
                },
            );

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            const message2 = await chat.sendMessage(scenario.session2, "message2");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message2,
                        contentTextSnippet: "message2",
                    },
                    otherChatAccount: null,
                }),
            ]);
        });

        test("notification on an archived entry from own account does not revive it", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const chat = await TestChat.get(scenario.session1, scenario.session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            const message1 = await chat.sendMessage(scenario.session2, "message1");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: "message1",
                    },
                    otherChatAccount: null,
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session1).clone(createTestPushContextModules()),
                {
                    spaceId: scenario.space.id,
                    key: {type: "Chat", chatId: chat.id},
                },
            );

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            await chat.sendMessage(scenario.session1, "message2");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            await unarchiveInboxEntry(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                key: {type: "Chat", chatId: chat.id},
            });

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat,
                    loudNotificationCount: 0,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: "message1",
                    },
                    otherChatAccount: null,
                }),
            ]);
        });

        test("if an account is mentioned then the mentioned message sticks around until archival", async () => {
            const space = await TestSpace.create(context);

            const session1 = await space.createSession();
            const session2 = await space.createSession();

            const chat = await TestChat.get(session1, session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            const message1 = await chat.sendMessage(
                session1,
                createSimpleMessageContent("Test comment 2"),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChatEntryModel({
                    session: session2,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message1,

                        contentTextSnippet: "Test comment 2",
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message3 = await chat.sendMessage(
                session1,
                createSimpleMessageContent("Test comment 3"),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChatEntryModel({
                    session: session2,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message3,

                        contentTextSnippet: "Test comment 3",
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message4 = await chat.sendMessage(
                session1,
                assertMessageContent(
                    schema.node("doc", {}, [
                        schema.node("paragraph", {}, [
                            schema.text("Test comment 4 "),
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

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChatEntryModel({
                    session: session2,
                    chat,
                    loudNotificationCount: 2,
                    latestMessage: {
                        message: message4,

                        contentTextSnippet: `Test comment 4 ${session2.account.initialName}`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
            ]);

            await chat.sendMessage(session1, createSimpleMessageContent("Test comment 5"));

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChatEntryModel({
                    session: session2,
                    chat,
                    loudNotificationCount: 2,
                    latestMessage: {
                        message: message4,

                        contentTextSnippet: `Test comment 4 ${session2.account.initialName}`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
            ]);

            await chat.sendMessage(session1, createSimpleMessageContent("Test comment 6"));

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChatEntryModel({
                    session: session2,
                    chat,
                    loudNotificationCount: 2,
                    latestMessage: {
                        message: message4,

                        contentTextSnippet: `Test comment 4 ${session2.account.initialName}`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message7 = await chat.sendMessage(
                session1,
                assertMessageContent(
                    schema.node("doc", {}, [
                        schema.node("paragraph", {}, [
                            schema.text("Test comment 7 "),
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

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChatEntryModel({
                    session: session2,
                    chat,
                    loudNotificationCount: 3,
                    latestMessage: {
                        message: message7,

                        contentTextSnippet: `Test comment 7 ${session2.account.initialName}`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
            ]);

            await chat.sendMessage(session1, createSimpleMessageContent("Test comment 8"));

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChatEntryModel({
                    session: session2,
                    chat,
                    loudNotificationCount: 3,
                    latestMessage: {
                        message: message7,

                        contentTextSnippet: `Test comment 7 ${session2.account.initialName}`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
            ]);

            await archiveInboxEntry(session2.action().clone(createTestPushContextModules()), {
                spaceId: space.id,
                key: {type: "Chat", chatId: chat.id},
            });

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            const message9 = await chat.sendMessage(
                session1,
                createSimpleMessageContent("Test comment 9"),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChatEntryModel({
                    session: session2,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message9,

                        contentTextSnippet: "Test comment 9",
                    },
                    otherChatAccount: null,
                }),
            ]);
        });

        test("clerical message with empty content doesn\u2019t increment loud notification count", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const chat = await TestChat.get(session1, session2);

            const document = await TestDocument.create(session1);
            await document.access.grantDefault(session1);

            await processSendShareNotificationJob(space.systemAction(), {
                jobId: generateId(),
                spaceId: space.id,
                actorAccountId: session1.account.id,
                entityId: `Document:${document.id}`,
                notification: {
                    accountIds: [session2.account.id],
                    content: emptyMessageContent,
                    createdTimeZone: defaultTimeZone,
                },
            });

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChatEntryModel({
                    session: session2,
                    chat,
                    loudNotificationCount: 0,
                    latestMessage: {
                        author: expect.objectContaining({id: session1.account.id}),
                        createdTime: expect.any(Date),
                        contentTextSnippet: "",
                        clerical: {
                            type: "ShareNotification",
                            entityType: "Document",
                        },
                    },
                    otherChatAccount: null,
                }),
            ]);
        });

        test("clerical message with content doesn\u2019t increment loud notification count", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const chat = await TestChat.get(session1, session2);

            const document = await TestDocument.create(session1);
            await document.access.grantDefault(session1);

            await processSendShareNotificationJob(space.systemAction(), {
                jobId: generateId(),
                spaceId: space.id,
                actorAccountId: session1.account.id,
                entityId: `Document:${document.id}`,
                notification: {
                    accountIds: [session2.account.id],
                    content: createSimpleMessageContent("foobar"),
                    createdTimeZone: defaultTimeZone,
                },
            });

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChatEntryModel({
                    session: session2,
                    chat,
                    loudNotificationCount: 0,
                    latestMessage: {
                        author: expect.objectContaining({id: session1.account.id}),
                        createdTime: expect.any(Date),
                        contentTextSnippet: "foobar",
                        clerical: {
                            type: "ShareNotification",
                            entityType: "Document",
                        },
                    },
                    otherChatAccount: null,
                }),
            ]);
        });

        test("clerical message with mention does increment loud notification count", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const chat = await TestChat.get(session1, session2);

            const document = await TestDocument.create(session1);
            await document.access.grantDefault(session1);

            await processSendShareNotificationJob(space.systemAction(), {
                jobId: generateId(),
                spaceId: space.id,
                actorAccountId: session1.account.id,
                entityId: `Document:${document.id}`,
                notification: {
                    accountIds: [session2.account.id],
                    content: assertMessageContent(
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
                    createdTimeZone: defaultTimeZone,
                },
            });

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChatEntryModel({
                    session: session2,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        author: expect.objectContaining({id: session1.account.id}),
                        createdTime: expect.any(Date),
                        contentTextSnippet: `Hello ${session2.account.initialName}`,
                        isStickyMention: true,
                        clerical: {
                            type: "ShareNotification",
                            entityType: "Document",
                        },
                    },
                    otherChatAccount: null,
                }),
            ]);
        });

        test("sends a loud notification on any message after some period of time even if there was a clerical message first", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const chat = await TestChat.get(session1, session2);

            const document = await TestDocument.create(session1);
            await document.access.grantDefault(session1);

            expect(await testGetInboxEntries(session2)).toEqual([]);

            const message1 = await chat.sendMessage(session1, "message1");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChatEntryModel({
                    session: session2,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message1,

                        contentTextSnippet: "message1",
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message2 = await chat.sendMessage(session1, "message2");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChatEntryModel({
                    session: session2,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message2,
                        contentTextSnippet: "message2",
                    },
                    otherChatAccount: null,
                }),
            ]);

            const originalDateNow = Date.now;
            const mockTime1 = Date.now() + 1000 * 60 * 60 * 2;
            const mockTime2 = Date.now() + 1000 * 60 * 60 * 2 + 1000;

            try {
                Date.now = () => mockTime1;

                await processSendShareNotificationJob(space.systemAction(), {
                    jobId: generateId(),
                    spaceId: space.id,
                    actorAccountId: session1.account.id,
                    entityId: `Document:${document.id}`,
                    notification: {
                        accountIds: [session2.account.id],
                        content: createSimpleMessageContent("message3"),
                        createdTimeZone: defaultTimeZone,
                    },
                });

                await ProcessContextModule.waitForTestTasks();
            } finally {
                Date.now = originalDateNow;
            }

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChatEntryModel({
                    session: session2,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        author: expect.objectContaining({id: session1.account.id}),
                        createdTime: new Date(mockTime1),
                        contentTextSnippet: "message3",
                        clerical: {
                            type: "ShareNotification",
                            entityType: "Document",
                        },
                    },
                    otherChatAccount: null,
                }),
            ]);

            let message4;
            try {
                Date.now = () => mockTime2;

                message4 = await chat.sendMessage(session1, "message4");

                await ProcessContextModule.waitForTestTasks();
            } finally {
                Date.now = originalDateNow;
            }

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChatEntryModel({
                    session: session2,
                    chat,
                    loudNotificationCount: 2,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: "message4",
                    },
                    otherChatAccount: null,
                }),
            ]);
        });

        test("multiline message content is printed in the text snippet", async () => {
            const scenario = await createNotificationsTestScenario(context);

            const chat = await TestChat.get(scenario.session1, scenario.session2);

            expect(await testGetInboxEntries(scenario.session1)).toEqual([]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            const message1 = await chat.sendMessage(
                scenario.session2,
                assertMessageContent(
                    schema.node("doc", {}, [
                        schema.node("paragraph", {}, [schema.text("Yes")]),
                        schema.node("paragraph", {}, [
                            schema.text("But actually this other thing"),
                        ]),
                        schema.node("paragraph", {}, [schema.text("And one final thing!")]),
                    ]),
                ),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet:
                            "Yes. But actually this other thing. And one final thing!",
                    },
                    otherChatAccount: null,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);

            const message2 = await chat.sendMessage(
                scenario.session2,
                assertMessageContent(
                    schema.node("doc", {}, [
                        schema.node("paragraph", {}, [schema.text("Yes")]),
                        schema.node("paragraph", {}, []),
                        schema.node("paragraph", {}, [
                            schema.text("But actually this other thing"),
                        ]),
                    ]),
                ),
            );

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(scenario.session1)).toEqual([
                expectInboxChatEntryModel({
                    session: scenario.session1,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message: message2,
                        contentTextSnippet: "Yes. But actually this other thing",
                    },
                    otherChatAccount: null,
                }),
            ]);

            expect(await testGetInboxEntries(scenario.session2)).toEqual([]);
        });

        test("private entity in mention isn\u2019t included in chat notification", async () => {
            const space = await TestSpace.create(context);

            const [session1, session2, session3] = await space.createSessions(3);

            const chat = await TestChat.get(session1, session2, session3);
            const document = await TestDocument.create(session2, {title: "TOP SECRET"});

            const message = await chat.sendMessage(
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
                expectInboxChatEntryModel({
                    session: session2,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message,
                        contentTextSnippet: "Can you see this? TOP SECRET",
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
            ]);

            expect(await testGetInboxEntries(session3)).toEqual([
                expectInboxChatEntryModel({
                    session: session3,
                    chat,
                    loudNotificationCount: 1,
                    latestMessage: {
                        message,
                        contentTextSnippet: "Can you see this? Private document",
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
            ]);

            expect(
                new Map(
                    filterMapArray(context.takeDurableObjectBroadcasts(), ({url, body = {}}) => {
                        const match = url.match(
                            /^\/api\/durable-objects\/my-account\/([^/]+)\/broadcast-inbox-realtime-event-transaction$/,
                        );
                        if (!match) return;

                        // Ignore any realtime updates `session1` received.
                        if (match[1] === session1.account.id) return;

                        return [
                            match[1],
                            MyAccountBroadcastInboxRealtimeEventsSchema.deserialize(body),
                        ];
                    }),
                ),
            ).toEqual(
                new Map([
                    [
                        session2.account.id,
                        {
                            events: [
                                {
                                    type: "PutItem",
                                    indexes: expect.any(Map),
                                    item: {
                                        key: expect.any(String),
                                        version: expect.any(Number),
                                        model: createTestInboxModel({
                                            spaceId: space.id,
                                            accountId: session2.account.id,
                                            loudNotificationCount: 1,
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
                                        model: expectInboxChatEntryModel({
                                            session: session2,
                                            chat,
                                            loudNotificationCount: 1,
                                            latestMessage: {
                                                message,
                                                contentTextSnippet: "Can you see this? TOP SECRET",
                                            },
                                            otherChatAccount: expect.any(AccountModel),
                                        }),
                                    },
                                },
                            ],
                        },
                    ],
                    [
                        session3.account.id,
                        {
                            events: [
                                {
                                    type: "PutItem",
                                    indexes: expect.any(Map),
                                    item: {
                                        key: expect.any(String),
                                        version: expect.any(Number),
                                        model: createTestInboxModel({
                                            spaceId: space.id,
                                            accountId: session3.account.id,
                                            loudNotificationCount: 1,
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
                                        model: expectInboxChatEntryModel({
                                            session: session3,
                                            chat,
                                            loudNotificationCount: 1,
                                            latestMessage: {
                                                message,
                                                contentTextSnippet:
                                                    "Can you see this? Private document",
                                            },
                                            otherChatAccount: expect.any(AccountModel),
                                        }),
                                    },
                                },
                            ],
                        },
                    ],
                ]),
            );
        });

        test("calls bot webhook when message is sent to chat bot is in", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});
            const bot = await TestBot.createAndInstantiate(session);

            const chat = await TestChat.get(session, bot);

            await ProcessContextModule.waitForTestTasks();

            expect(callBotWebhookJobs).toEqual([]);

            const message = await chat.sendMessage(session);

            await ProcessContextModule.waitForTestTasks();

            expect(callBotWebhookJobs).toEqual(
                createArrayWithLength(processingMultiple, () =>
                    expect.objectContaining({
                        botAccountId: bot.id,
                        event: expect.objectContaining({
                            type: "NewMessage",
                            room: {type: "Chat", id: chat.id},
                            index: message.index,
                        }),
                    }),
                ),
            );

            // Every job should have the same `eventId`.
            expect(new Set(callBotWebhookJobs.map(job => job.eventId))).toEqual(
                new Set([callBotWebhookJobs[0]!.eventId]),
            );
        });

        test("calls bot webhook for each bot in chat", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});
            const bot1 = await TestBot.createAndInstantiate(session);
            const bot2 = await TestBot.createAndInstantiate(session);

            const chat = await TestChat.get(session, bot1, bot2);

            await ProcessContextModule.waitForTestTasks();

            expect(callBotWebhookJobs).toEqual([]);

            const message = await chat.sendMessage(session);

            await ProcessContextModule.waitForTestTasks();

            expect(
                callBotWebhookJobs.sort((job1, job2) =>
                    defaultCompareStrings(job1.botAccountId, job2.botAccountId),
                ),
            ).toEqual([
                ...createArrayWithLength(processingMultiple, () =>
                    expect.objectContaining({
                        botAccountId: bot1.id < bot2.id ? bot1.id : bot2.id,
                        event: expect.objectContaining({
                            type: "NewMessage",
                            room: {type: "Chat", id: chat.id},
                            index: message.index,
                        }),
                    }),
                ),
                ...createArrayWithLength(processingMultiple, () =>
                    expect.objectContaining({
                        botAccountId: bot1.id < bot2.id ? bot2.id : bot1.id,
                        event: expect.objectContaining({
                            type: "NewMessage",
                            room: {type: "Chat", id: chat.id},
                            index: message.index,
                        }),
                    }),
                ),
            ]);

            const bot1EventId = assertExists(
                findMapIterable(callBotWebhookJobs, job =>
                    job.botAccountId === bot1.id ? job.eventId : undefined,
                ),
            );

            const bot2EventId = assertExists(
                findMapIterable(callBotWebhookJobs, job =>
                    job.botAccountId === bot2.id ? job.eventId : undefined,
                ),
            );

            expect(bot1EventId).not.toEqual(bot2EventId);

            // If a job for some bot account is repeated it should have the same `eventId` as
            // all other jobs for the bot account.
            expect(
                new Set(
                    filterMapArray(callBotWebhookJobs, job =>
                        job.botAccountId === bot1.id ? job.eventId : undefined,
                    ),
                ),
            ).toEqual(new Set([bot1EventId]));

            // If a job for some bot account is repeated it should have the same `eventId` as
            // all other jobs for the bot account.
            expect(
                new Set(
                    filterMapArray(callBotWebhookJobs, job =>
                        job.botAccountId === bot2.id ? job.eventId : undefined,
                    ),
                ),
            ).toEqual(new Set([bot2EventId]));
        });

        test("doesn\u2019t call bot webhook if own bot sends the message", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});
            const bot = await TestBot.createAndInstantiate(session);

            const chat = await TestChat.get(session, bot);

            await ProcessContextModule.waitForTestTasks();

            expect(callBotWebhookJobs).toEqual([]);

            await chat.sendMessage(bot.action({type: "Chat", chatId: chat.id}));

            await ProcessContextModule.waitForTestTasks();

            expect(callBotWebhookJobs).toEqual([]);
        });

        test("doesn\u2019t call bot webhook if own bot sends the message but calls webhook for other bots", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});
            const bot1 = await TestBot.createAndInstantiate(session);
            const bot2 = await TestBot.createAndInstantiate(session);

            const chat = await TestChat.get(session, bot1, bot2);

            await ProcessContextModule.waitForTestTasks();

            expect(callBotWebhookJobs).toEqual([]);

            const message = await chat.sendMessage(bot1.action({type: "Chat", chatId: chat.id}));

            await ProcessContextModule.waitForTestTasks();

            expect(callBotWebhookJobs).toEqual(
                createArrayWithLength(processingMultiple, () =>
                    expect.objectContaining({
                        botAccountId: bot2.id,
                        event: expect.objectContaining({
                            type: "NewMessage",
                            room: {type: "Chat", id: chat.id},
                            index: message.index,
                        }),
                    }),
                ),
            );

            // Every job should have the same `eventId`.
            expect(new Set(callBotWebhookJobs.map(job => job.eventId))).toEqual(
                new Set([callBotWebhookJobs[0]!.eventId]),
            );
        });

        test("setting a reaction on a chat message archives the chat message inbox entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const chat = await TestChat.get(session1, session2);

            const message1 = await chat.sendMessage(session1, "test1");

            await ProcessContextModule.waitForTestTasks();

            await message1.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxChatEntryModel({
                    isArchived: true,
                    session: session2,
                    chat,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: "test1",
                    },
                }),
            ]);
        });

        test("setting a reaction on a chat message that\u2019s not the latest comment archives the chat message inbox entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const chat = await TestChat.get(session1, session2);

            const message1 = await chat.sendMessage(session1, "test1");
            await chat.sendMessage(session1, "test2");
            const message3 = await chat.sendMessage(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            await message1.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxChatEntryModel({
                    isArchived: true,
                    session: session2,
                    chat,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "test3",
                    },
                }),
            ]);
        });

        test("setting a reaction on the latest chat message archives the chat message inbox entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const chat = await TestChat.get(session1, session2);

            await chat.sendMessage(session1, "test1");
            await chat.sendMessage(session1, "test2");
            const message3 = await chat.sendMessage(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            await message3.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxChatEntryModel({
                    isArchived: true,
                    session: session2,
                    chat,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "test3",
                    },
                }),
            ]);
        });

        test("setting a reaction on the latest chat message, explicitly unarchiving, then setting a reaction on a different chat message archives the chat message inbox entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const chat = await TestChat.get(session1, session2);

            const message1 = await chat.sendMessage(session1, "test1");
            await chat.sendMessage(session1, "test2");
            const message3 = await chat.sendMessage(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            await message3.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            await unarchiveInboxEntry(session2.action(), {
                spaceId: space.id,
                key: {
                    type: "Chat",
                    chatId: chat.id,
                },
            });

            await message1.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxChatEntryModel({
                    isArchived: true,
                    session: session2,
                    chat,
                    latestMessage: {
                        message: message3,
                        contentTextSnippet: "test3",
                    },
                }),
            ]);
        });

        test("setting a reaction on the latest chat message, implicitly unarchiving, then setting a reaction on a different chat message archives the chat message inbox entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const chat = await TestChat.get(session1, session2);

            const message1 = await chat.sendMessage(session1, "test1");
            await chat.sendMessage(session1, "test2");
            const message3 = await chat.sendMessage(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            await message3.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            const message4 = await chat.sendMessage(session1, "test4");

            await ProcessContextModule.waitForTestTasks();

            await message1.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxChatEntryModel({
                    isArchived: true,
                    session: session2,
                    chat,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: "test4",
                    },
                }),
            ]);
        });

        test("setting a reaction on the latest chat message, implicitly unarchiving, then setting a reaction on the latest chat message archives the chat message inbox entry", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const chat = await TestChat.get(session1, session2);

            await chat.sendMessage(session1, "test1");
            await chat.sendMessage(session1, "test2");
            const message3 = await chat.sendMessage(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            await message3.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            const message4 = await chat.sendMessage(session1, "test4");

            await ProcessContextModule.waitForTestTasks();

            await message4.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxChatEntryModel({
                    isArchived: true,
                    session: session2,
                    chat,
                    latestMessage: {
                        message: message4,
                        contentTextSnippet: "test4",
                    },
                }),
            ]);
        });

        test("clears `isStickyMention` when archiving by reacting to a chat message", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const chat = await TestChat.get(session1, session2);

            const message1 = await chat.sendMessage(
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
            await chat.sendMessage(session1, "test2");
            const message3 = await chat.sendMessage(session1, "test3");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChatEntryModel({
                    loudNotificationCount: 1,
                    session: session2,
                    chat,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: `Hello, ${session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                }),
            ]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([]);

            await message3.setReaction(session2);

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxChatEntryModel({
                    isArchived: true,
                    session: session2,
                    chat,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: `Hello, ${session2.account.initialName}!`,
                    },
                }),
            ]);
        });

        test("process setting chat message reaction before chat message notification event", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3] = await space.createSessions(3);

            const chat = await TestChat.get(session1, session2, session3);

            const message1 = await chat.sendMessage(
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

            const comment2 = await chat.sendMessage(session3, "test2");

            const {unpause: unpause1} = await pause1Promise;

            await comment2.setReaction(session2);

            const {unpause: unpause2} = await pause2Promise;
            unpause2();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxChatEntryModel({
                    isArchived: true,
                    session: session2,
                    chat,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: `Hello, ${session2.account.initialName}!`,
                    },
                    otherChatAccount: session3,
                }),
            ]);

            unpause1();

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([]);

            expect(await testGetInboxEntries(session2, {filter: "Archive"})).toEqual([
                expectInboxChatEntryModel({
                    isArchived: true,
                    session: session2,
                    chat,
                    latestMessage: {
                        message: message1,
                        contentTextSnippet: `Hello, ${session2.account.initialName}!`,
                    },
                    otherChatAccount: session3,
                }),
            ]);
        });

        test("hides chat when account loses access to chat room they have inbox entry for", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const chat = await TestChat.createRoom(session1, {access: "Private"});
            await chat.roomAccess.grant(session1, session2);

            await subscribeToRoomChat(session2.action(), chat.id);

            const message = await chat.sendMessage(session1, "foo");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChatEntryModel({
                    session: session2,
                    chat,
                    definition: {type: "Room"},
                    loudNotificationCount: 1,
                    latestMessage: {
                        message,
                        contentTextSnippet: "foo",
                    },
                }),
            ]);

            await chat.roomAccess.revoke(session1, session2);

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChatEntryModel({
                    session: session2,
                    chat,
                    definition: {type: "Room", isPrivate: true},
                    loudNotificationCount: 1,
                    latestMessage: {
                        message,
                        contentTextSnippet: "",
                    },
                }),
            ]);
        });

        test("hides chat when account loses access to chat room which was previously publicly shared they have inbox entry for", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);

            const chat = await TestChat.createRoom(session1);
            await chat.roomAccess.grantDefault(session1);

            await subscribeToRoomChat(session2.action(), chat.id);

            const message = await chat.sendMessage(session1, "foo");

            await ProcessContextModule.waitForTestTasks();

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChatEntryModel({
                    session: session2,
                    chat,
                    definition: {type: "Room"},
                    loudNotificationCount: 1,
                    latestMessage: {
                        message,
                        contentTextSnippet: "foo",
                    },
                }),
            ]);

            await chat.roomAccess.revokeDefault(session1);

            expect(await testGetInboxEntries(session2)).toEqual([
                expectInboxChatEntryModel({
                    session: session2,
                    chat,
                    definition: {type: "Room", isPrivate: true},
                    loudNotificationCount: 1,
                    latestMessage: {
                        message,
                        contentTextSnippet: "",
                    },
                }),
            ]);
        });

        test("race condition: stale inbox attributes item when decrementing loud notification count", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3] = await space.createSessions(3);

            const chat = await TestChat.get(session1, session2, session3);

            expect(await getInbox(session2.action(), {spaceId: space.id})).toMatchObject({
                model: {loudNotificationCount: 0},
            });

            const pause1APromise =
                updateInboxEntryBeforeExecuteTransactionTestCheckpoint.pauseForTest(
                    session1.account.id,
                );

            const pause1BPromise =
                updateInboxEntryAfterExecuteTransactionTestCheckpoint.pauseForTest(
                    session1.account.id,
                );

            const pause2APromise =
                updateInboxEntryAfterGetAttributesItemTestCheckpoint.pauseForTest(
                    session2.account.id,
                );

            const pause2BPromise = updateInboxEntryBeforeGetEntryItemTestCheckpoint.pauseForTest(
                session2.account.id,
            );

            await chat.sendMessage(session1);
            await chat.sendMessage(session2);

            const {unpause: unpause1A} = await pause1APromise;

            // `chat.sendMessage(session2)` has captured a stale inbox attributes item with
            // `loudNotificationCount` of 0 and hasn't loaded the inbox entry yet.
            const {unpause: unpause2A} = await pause2APromise;
            const {unpause: unpause2B} = await pause2BPromise;

            unpause1A();

            // `chat.sendMessage(session1)` has finished so now the inbox attributes item AND
            // inbox entry item has a `loudNotificationCount` of 1.
            const {unpause: unpause1B} = await pause1BPromise;
            unpause1B();

            expect(await getInbox(session2.action(), {spaceId: space.id})).toMatchObject({
                model: {loudNotificationCount: 1},
            });

            // Now run `chat.sendMessage(session2)` with a stale inbox attributes item with
            // `loudNotificationCount` of 0 and a new inbox entry item with
            // `loudNotificationCount` of 1. This will try to set the inbox attributes item to
            // `loudNotificationCount` of -1 which fails our schema validation.
            unpause2A();
            unpause2B();

            await ProcessContextModule.waitForTestTasks();

            expect(await getInbox(session2.action(), {spaceId: space.id})).toMatchObject({
                model: {loudNotificationCount: 0},
            });
        });
    });
}
