import {TestApnsContextModule} from "~/server/apns/apns_context_module.js";
import {processSendShareNotificationJob} from "~/server/chat/data/chat_table.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {isServerActionContext} from "~/server/context/is_server_action_context.js";
import {getDocumentPreviewIfPossible} from "~/server/documents/data/documents_table.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestLocalEdgeServiceContextModule} from "~/server/dynamo/test_helpers/test_local_edge_service_context_module.js";
import {
    archiveInboxEntry,
    getInboxEntries,
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
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {PermissionDeniedError, UnimplementedError} from "~/shared/error/error.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {generateId} from "~/shared/id/id.js";
import {
    assertMessageContent,
    createSimpleMessageContent,
    emptyMessageContent,
    MessageContentProsemirrorSchema as schema,
} from "~/shared/messaging/message_content_schema.js";
import {InboxChatEntryModel, InboxModel} from "~/shared/notifications/inbox_model.js";
import {MyAccountBroadcastInboxRealtimeEventTransactionSchema} from "~/shared/notifications/my_account_protocol.js";
import {parseSearchDynamicEntityId} from "~/shared/search/search_entity_id.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

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

// Exercise idempotency by running the test suite again with jobs
// processed twice.
for (const [currentProcessingType, processingMultiple] of [
    ["Once", 1],
    ["TwiceSerially", 2],
    ["ThriceConcurrently", 3],
] as const) {
    describe(`processing: ${currentProcessingType}`, () => {
        if (currentProcessingType !== "Once") return;

        beforeEach(() => {
            processingType = currentProcessingType;
        });

        test("messaging creates an inbox entry for all subscribers", async () => {
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

            const chat = await TestChat.get(
                scenario.session1,
                scenario.session2,
                scenario.session3,
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
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const message1 = await chat.sendMessage(scenario.session2, "message1");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message1",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
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

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message1",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session1.get(),
                }),
            ]);

            const message2 = await chat.sendMessage(scenario.session3, "message2");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: "message2",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session2.get(),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: "message2",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session1.get(),
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

            const message3 = await chat.sendMessage(scenario.session1, "message3");

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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session2.get(),
                }),
            ]);

            // Make sure multiple processing is working.
            expect(getCount1()).toEqual(1 * processingMultiple);
            expect(getCount2()).toEqual(1 * processingMultiple);
            expect(getCount3()).toEqual(1 * processingMultiple);
        });

        test("mentioning someone in a creates a second loud notification for them", async () => {
            const scenario = await createNotificationsScenario(context);

            const chat = await TestChat.get(
                scenario.session1,
                scenario.session2,
                scenario.session3,
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
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const message1 = await chat.sendMessage(scenario.session2, "message1");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message1",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
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

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message1",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session1.get(),
                }),
            ]);

            const message2 = await chat.sendMessage(
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
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

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 2,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: await scenario.session1.get(),
                }),
            ]);

            const message3 = await chat.sendMessage(
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 2,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: await scenario.session3.get(),
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

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 2,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: await scenario.session1.get(),
                }),
            ]);

            const message4 = await chat.sendMessage(
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 3,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: await scenario.session2.get(),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session1.get(),
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
        });

        test("mentioning yourself does not create an extra loud notification for yourself", async () => {
            const scenario = await createNotificationsScenario(context);

            const chat = await TestChat.get(
                scenario.session1,
                scenario.session2,
                scenario.session3,
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
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const message1 = await chat.sendMessage(scenario.session1, "message1");

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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "message1",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "message1",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session2.get(),
                }),
            ]);

            const message2 = await chat.sendMessage(
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
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

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session1.get(),
                }),
            ]);

            const message3 = await chat.sendMessage(scenario.session1, "message3");

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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session2.get(),
                }),
            ]);

            const message4 = await chat.sendMessage(
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
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

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session1.get(),
                }),
            ]);
        });

        test("accounts have separate inboxes for each space", async () => {
            const scenario = await createNotificationsScenario(context);

            const chat = await TestChat.get(scenario.session1, scenario.sharedSession);

            const otherChat = await TestChat.get(scenario.otherSession, scenario.sharedSession);

            expect(
                await getInboxEntries(context.action(scenario.sharedSession), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.sharedSession), {
                    spaceId: scenario.otherSpace.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const message1 = await chat.sendMessage(scenario.session1, "message1");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.sharedSession), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.sharedSession.account.id,
                    chatId: chat.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "message1",
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            expect(
                await getInboxEntries(context.action(scenario.sharedSession), {
                    spaceId: scenario.otherSpace.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const message2 = await otherChat.sendMessage(scenario.otherSession, "message2");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.sharedSession), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.sharedSession.account.id,
                    chatId: chat.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "message1",
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.otherSpace.id,
                    accountId: scenario.sharedSession.account.id,
                    chatId: otherChat.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.otherSession.get(),
                        contentTextSnippet: "message2",
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);
        });

        test("account can not see mention in chat they don’t have access to", async () => {
            const scenario = await createNotificationsScenario(context);

            const chat1 = await TestChat.get(
                scenario.session1,
                scenario.session2,
                scenario.session3,
            );

            const chat2 = await TestChat.get(scenario.session1, scenario.session2);

            const otherChat = await TestChat.get(scenario.otherSession, scenario.sharedSession);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            await expect(
                getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.otherSpace.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).rejects.toThrow(PermissionDeniedError);

            const message1 = await chat1.sendMessage(
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: await scenario.session1.get(),
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

            await chat2.sendMessage(scenario.session2, scenario.mentionAccount3MessageContent);

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: await scenario.session1.get(),
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

            await otherChat.sendMessage(
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session3.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: await scenario.session1.get(),
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

        test("message notification events processed out of order result in the same latest message", async () => {
            const scenario = await createNotificationsScenario(context);

            const chat = await TestChat.get(
                scenario.session1,
                scenario.session2,
                scenario.session3,
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
            ).toEqual([]);

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

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session2.get(),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session1.get(),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session2.get(),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 2,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session1.get(),
                }),
            ]);
        });

        test("message notification events processed out of order result in the same latest message including implicit archival states", async () => {
            const scenario = await createNotificationsScenario(context);

            const chat = await TestChat.get(scenario.session1, scenario.session2);

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

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
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

            const chat1 = await TestChat.get(scenario.session1, scenario.session2);

            const chat2 = await TestChat.get(scenario.session1, scenario.session3);

            const chat3 = await TestChat.get(
                scenario.session1,
                scenario.session2,
                scenario.session3,
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

            const message1 = await chat1.sendMessage(scenario.session2, "message1");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message1",
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message2 = await chat2.sendMessage(
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message1",
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message3 = await chat3.sendMessage(scenario.session2, "message3");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat3.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message1",
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message4 = await chat1.sendMessage(scenario.session2, "message4");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat3.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message4",
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            await chat2.sendMessage(scenario.session3, "message5");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat3.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message4",
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message6 = await chat1.sendMessage(
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 2,
                    latestMessage: {
                        createdTime: message6.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat3.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
            ]);

            await chat2.sendMessage(scenario.session3, "message7");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 2,
                    latestMessage: {
                        createdTime: message6.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat3.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session3.get(),
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

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 2,
                    latestMessage: {
                        createdTime: message8.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 2,
                    latestMessage: {
                        createdTime: message6.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat3.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
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

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const message1 = await chat1.sendMessage(scenario.session2, "message1");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message1",
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message2 = await chat2.sendMessage(
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message1",
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message3 = await chat3.sendMessage(scenario.session2, "message3");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat3.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message1",
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat3.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message1",
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message4 = await chat4.sendMessage(scenario.session2, "message4");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat4.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message4",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.sharedSession.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat3.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message1",
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            await chat2.sendMessage(scenario.session3, "message5");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat4.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message4",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.sharedSession.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat3.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message1",
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message6 = await chat3.sendMessage(scenario.session2, "message6");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat4.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message4",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.sharedSession.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat3.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message6.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message6",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message1",
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message8 = await chat3.sendMessage(
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat3.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 2,
                    latestMessage: {
                        createdTime: message8.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: await scenario.session3.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat4.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message4",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.sharedSession.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: `Hello ${scenario.session1.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message1",
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);
        });

        test("sends a loud notification on any message after some period of time", async () => {
            const scenario = await createNotificationsScenario(context);

            const chat = await TestChat.get(
                scenario.session1,
                scenario.session2,
                scenario.session3,
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
            ).toEqual([]);

            const message1 = await chat.sendMessage(scenario.session1, "message1");

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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "message1",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
                }),
            ]);

            const message2 = await chat.sendMessage(scenario.session3, "message2");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: "message2",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session2.get(),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: "message2",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session1.get(),
                }),
            ]);

            const message3 = await chat.sendMessage(scenario.session3, "message3");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session2.get(),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session1.get(),
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

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 2,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: "message4",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session2.get(),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 2,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: "message4",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session1.get(),
                }),
            ]);
        });

        test("can archive inbox entries", async () => {
            const scenario = await createNotificationsScenario(context);

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

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            await chat1.sendMessage(scenario.session2, "message1");

            await chat1.sendMessage(scenario.session3, "message2");

            const message3 = await chat1.sendMessage(scenario.session1, "message3");

            const message4 = await chat2.sendMessage(
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session2.get(),
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session3).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "Chat", chatId: chat1.id},
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "Chat", chatId: chat2.id},
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "Chat", chatId: chat1.id},
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
            ).toEqual([]);

            expect(
                await getInboxEntries(context.action(scenario.session3), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
            ]);
        });

        test("can unarchive inbox entries", async () => {
            const scenario = await createNotificationsScenario(context);

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

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat3.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message5.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session2.get(),
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session3).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "Chat", chatId: chat1.id},
                },
            );

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "Chat", chatId: chat2.id},
                },
            );

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "Chat", chatId: chat1.id},
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat3.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message5.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
            ]);

            await unarchiveInboxEntry(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                key: {type: "Chat", chatId: chat1.id},
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat3.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message5.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 0,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session2.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
            ]);

            await unarchiveInboxEntry(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                key: {type: "Chat", chatId: chat2.id},
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 4,
                    loudNotificationCount: 0,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat3.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message5.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 0,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session2.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
            ]);

            await unarchiveInboxEntry(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                key: {type: "Chat", chatId: chat1.id},
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 0,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 4,
                    loudNotificationCount: 0,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat3.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message5.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 0,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session2.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
            ]);

            await unarchiveInboxEntry(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                key: {type: "Chat", chatId: chat1.id},
            });

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 0,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: "message2",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session2.get(),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 0,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 4,
                    loudNotificationCount: 0,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat3.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message5.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat1.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 0,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session2.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat2.id,
                    chatAccountCount: 4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: `Hello ${scenario.session2.account.initialName}!`,
                        isStickyMention: false,
                    },
                    otherChatAccount: expect.any(AccountModel),
                }),
            ]);
        });

        test("notification on an archived entry revives it", async () => {
            const scenario = await createNotificationsScenario(context);

            const chat = await TestChat.get(scenario.session1, scenario.session2);

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const message1 = await chat.sendMessage(scenario.session2, "message1");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message1",
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session1).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "Chat", chatId: chat.id},
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

            const message2 = await chat.sendMessage(scenario.session2, "message2");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message2",
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);
        });

        test("notification on an archived entry from own account does not revive it", async () => {
            const scenario = await createNotificationsScenario(context);

            const chat = await TestChat.get(scenario.session1, scenario.session2);

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const message1 = await chat.sendMessage(scenario.session2, "message1");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message1",
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session1).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "Chat", chatId: chat.id},
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

            await chat.sendMessage(scenario.session1, "message2");

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
                key: {type: "Chat", chatId: chat.id},
            });

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 0,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "message1",
                        isStickyMention: false,
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

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const message1 = await chat.sendMessage(
                session1,
                createSimpleMessageContent("Test comment 2"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session2.account.id,
                    chatId: chat.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await session1.get(),
                        contentTextSnippet: "Test comment 2",
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message3 = await chat.sendMessage(
                session1,
                createSimpleMessageContent("Test comment 3"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session2.account.id,
                    chatId: chat.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await session1.get(),
                        contentTextSnippet: "Test comment 3",
                        isStickyMention: false,
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

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session2.account.id,
                    chatId: chat.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 2,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await session1.get(),
                        contentTextSnippet: `Test comment 4 ${session2.account.initialName}`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
            ]);

            await chat.sendMessage(session1, createSimpleMessageContent("Test comment 5"));

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session2.account.id,
                    chatId: chat.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 2,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await session1.get(),
                        contentTextSnippet: `Test comment 4 ${session2.account.initialName}`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
            ]);

            await chat.sendMessage(session1, createSimpleMessageContent("Test comment 6"));

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session2.account.id,
                    chatId: chat.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 2,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await session1.get(),
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

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session2.account.id,
                    chatId: chat.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 3,
                    latestMessage: {
                        createdTime: message7.createdTime,
                        author: await session1.get(),
                        contentTextSnippet: `Test comment 7 ${session2.account.initialName}`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
            ]);

            await chat.sendMessage(session1, createSimpleMessageContent("Test comment 8"));

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session2.account.id,
                    chatId: chat.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 3,
                    latestMessage: {
                        createdTime: message7.createdTime,
                        author: await session1.get(),
                        contentTextSnippet: `Test comment 7 ${session2.account.initialName}`,
                        isStickyMention: true,
                    },
                    otherChatAccount: null,
                }),
            ]);

            await archiveInboxEntry(session2.action().clone({apns: new TestApnsContextModule()}), {
                spaceId: space.id,
                key: {type: "Chat", chatId: chat.id},
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

            const message9 = await chat.sendMessage(
                session1,
                createSimpleMessageContent("Test comment 9"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session2.account.id,
                    chatId: chat.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message9.createdTime,
                        author: await session1.get(),
                        contentTextSnippet: "Test comment 9",
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);
        });

        test("clerical message with empty content doesn’t increment loud notification count", async () => {
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
                },
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session2.account.id,
                    chatId: chat.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 0,
                    latestMessage: {
                        createdTime: expect.any(Date),
                        author: await session1.get(),
                        contentTextSnippet: "",
                        isStickyMention: false,
                        clerical: {
                            type: "ShareNotification",
                            entityType: "Document",
                        },
                    },
                    otherChatAccount: null,
                }),
            ]);
        });

        test("clerical message with content doesn’t increment loud notification count", async () => {
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
                },
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session2.account.id,
                    chatId: chat.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 0,
                    latestMessage: {
                        createdTime: expect.any(Date),
                        author: await session1.get(),
                        contentTextSnippet: "foobar",
                        isStickyMention: false,
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
                },
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session2.account.id,
                    chatId: chat.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: expect.any(Date),
                        author: await session1.get(),
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

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([]);

            const message1 = await chat.sendMessage(session1, "message1");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session2.account.id,
                    chatId: chat.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await session1.get(),
                        contentTextSnippet: "message1",
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message2 = await chat.sendMessage(session1, "message2");

            await ProcessContextModule.waitForTestTasks();

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session2.account.id,
                    chatId: chat.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await session1.get(),
                        contentTextSnippet: "message2",
                        isStickyMention: false,
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
                    },
                });

                await ProcessContextModule.waitForTestTasks();
            } finally {
                Date.now = originalDateNow;
            }

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session2.account.id,
                    chatId: chat.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: new Date(mockTime1),
                        author: await session1.get(),
                        contentTextSnippet: "message3",
                        isStickyMention: false,
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

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session2.account.id,
                    chatId: chat.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 2,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await session1.get(),
                        contentTextSnippet: "message4",
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);
        });

        test("multiline message content is printed in the text snippet", async () => {
            const scenario = await createNotificationsScenario(context);

            const chat = await TestChat.get(scenario.session1, scenario.session2);

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

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet:
                            "Yes. But actually this other thing. And one final thing!",
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
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

            expect(
                await getInboxEntries(context.action(scenario.session1), {
                    spaceId: scenario.space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat.id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: "Yes. But actually this other thing",
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
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

        test("private entity in mention isn’t included in chat notification", async () => {
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

            expect(
                await getInboxEntries(session2.action(), {
                    spaceId: space.id,
                    filter: "New",
                    limit: 100,
                    afterCursor: null,
                }).then(massageInboxEntriesQuery),
            ).toEqual([
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session2.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        author: await session1.get(),
                        createdTime: message.createdTime,
                        contentTextSnippet: "Can you see this? TOP SECRET",
                        isStickyMention: false,
                    },
                    otherChatAccount: expect.any(AccountModel),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: space.id,
                    accountId: session3.account.id,
                    chatId: chat.id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        author: await session1.get(),
                        createdTime: message.createdTime,
                        contentTextSnippet: "Can you see this? Private document",
                        isStickyMention: false,
                    },
                    otherChatAccount: expect.any(AccountModel),
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

                            // Ignore any realtime updates `session1` received.
                            if (match[1] === session1.account.id) return;

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
                            readTime: expect.any(Date),
                            eventTransaction: [
                                {
                                    type: "PutItem",
                                    indexes: expect.any(Map),
                                    item: {
                                        key: expect.any(String),
                                        version: expect.any(Number),
                                        model: new InboxModel({
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
                                        model: new InboxChatEntryModel({
                                            isArchived: false,
                                            spaceId: space.id,
                                            accountId: session2.account.id,
                                            chatId: chat.id,
                                            chatAccountCount: 3,
                                            loudNotificationCount: 1,
                                            latestMessage: {
                                                author: await session1.get(),
                                                createdTime: message.createdTime,
                                                contentTextSnippet: "Can you see this? TOP SECRET",
                                                isStickyMention: false,
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
                            readTime: expect.any(Date),
                            eventTransaction: [
                                {
                                    type: "PutItem",
                                    indexes: expect.any(Map),
                                    item: {
                                        key: expect.any(String),
                                        version: expect.any(Number),
                                        model: new InboxModel({
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
                                        model: new InboxChatEntryModel({
                                            isArchived: false,
                                            spaceId: space.id,
                                            accountId: session3.account.id,
                                            chatId: chat.id,
                                            chatAccountCount: 3,
                                            loudNotificationCount: 1,
                                            latestMessage: {
                                                author: await session1.get(),
                                                createdTime: message.createdTime,
                                                contentTextSnippet:
                                                    "Can you see this? Private document",
                                                isStickyMention: false,
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
    });
}
