import {TestApnsContextModule} from "~/server/apns/apns_context_module.js";
import {getOrCreateChatForAccounts, sendChatMessage} from "~/server/chat/data/chat_table.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
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
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {printContentSingleLineTextSnippet} from "~/shared/content/print_content_single_line_text_snippet.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
    createSimpleMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {InboxChatEntryModel} from "~/shared/notifications/inbox_model.js";
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

            const chatId = await getOrCreateChatForAccounts(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                otherAccountIds: [scenario.session2.account.id, scenario.session3.account.id],
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

            const message1 = await sendChatMessage(context.action(scenario.session2), {
                chatId,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message1"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message1"),
                            references: emptyContentReferences,
                        }),
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
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session1.get(),
                }),
            ]);

            const message2 = await sendChatMessage(context.action(scenario.session3), {
                chatId,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message2"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message2"),
                            references: emptyContentReferences,
                        }),
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
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message2"),
                            references: emptyContentReferences,
                        }),
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

            const message3 = await sendChatMessage(context.action(scenario.session1), {
                chatId,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message3"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
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
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
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

            const chatId = await getOrCreateChatForAccounts(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                otherAccountIds: [scenario.session2.account.id, scenario.session3.account.id],
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

            const message1 = await sendChatMessage(context.action(scenario.session2), {
                chatId,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message1"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message1"),
                            references: emptyContentReferences,
                        }),
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
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session1.get(),
                }),
            ]);

            const message2 = await sendChatMessage(context.action(scenario.session2), {
                chatId,
                parentMessageIndex: null,
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
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
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 2,
                    latestMessage: {
                        createdTime: message2.createdTime,
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
                    otherChatAccount: await scenario.session1.get(),
                }),
            ]);

            const message3 = await sendChatMessage(context.action(scenario.session2), {
                chatId,
                parentMessageIndex: null,
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 2,
                    latestMessage: {
                        createdTime: message3.createdTime,
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
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 2,
                    latestMessage: {
                        createdTime: message2.createdTime,
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
                    otherChatAccount: await scenario.session1.get(),
                }),
            ]);

            const message4 = await sendChatMessage(context.action(scenario.session3), {
                chatId,
                parentMessageIndex: null,
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 3,
                    latestMessage: {
                        createdTime: message4.createdTime,
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
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
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

            const chatId = await getOrCreateChatForAccounts(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                otherAccountIds: [scenario.session2.account.id, scenario.session3.account.id],
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

            const message1 = await sendChatMessage(context.action(scenario.session1), {
                chatId,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message1"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message1"),
                            references: emptyContentReferences,
                        }),
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
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session2.get(),
                }),
            ]);

            const message2 = await sendChatMessage(context.action(scenario.session2), {
                chatId,
                parentMessageIndex: null,
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
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
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
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
                    otherChatAccount: await scenario.session1.get(),
                }),
            ]);

            const message3 = await sendChatMessage(context.action(scenario.session1), {
                chatId,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message3"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
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
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session2.get(),
                }),
            ]);

            const message4 = await sendChatMessage(context.action(scenario.session2), {
                chatId,
                parentMessageIndex: null,
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
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
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
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
                    otherChatAccount: await scenario.session1.get(),
                }),
            ]);
        });

        test("accounts have separate inboxes for each space", async () => {
            const scenario = await createNotificationsScenario(context);

            const chatId = await getOrCreateChatForAccounts(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                otherAccountIds: [scenario.sharedSession.account.id],
            });

            const otherChatId = await getOrCreateChatForAccounts(
                context.action(scenario.otherSession),
                {
                    spaceId: scenario.otherSpace.id,
                    otherAccountIds: [scenario.sharedSession.account.id],
                },
            );

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

            const message1 = await sendChatMessage(context.action(scenario.session1), {
                chatId,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message1"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.sharedSession.account.id,
                    chatId,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message1"),
                            references: emptyContentReferences,
                        }),
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

            const message2 = await sendChatMessage(context.action(scenario.otherSession), {
                chatId: otherChatId,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message2"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.sharedSession.account.id,
                    chatId,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message1"),
                            references: emptyContentReferences,
                        }),
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
                    chatId: otherChatId,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.otherSession.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message2"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);
        });

        test("account can not see mention in chat they don't have access to", async () => {
            const scenario = await createNotificationsScenario(context);

            const chat1Id = await getOrCreateChatForAccounts(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                otherAccountIds: [scenario.session2.account.id, scenario.session3.account.id],
            });

            const chat2Id = await getOrCreateChatForAccounts(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                otherAccountIds: [scenario.session2.account.id],
            });

            const otherChatId = await getOrCreateChatForAccounts(
                context.action(scenario.otherSession),
                {
                    spaceId: scenario.otherSpace.id,
                    otherAccountIds: [scenario.sharedSession.account.id],
                },
            );

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

            const message1 = await sendChatMessage(context.action(scenario.session2), {
                chatId: chat1Id,
                parentMessageIndex: null,
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat1Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
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

            await sendChatMessage(context.action(scenario.session2), {
                chatId: chat2Id,
                parentMessageIndex: null,
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat1Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
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

            await sendChatMessage(context.action(scenario.otherSession), {
                chatId: otherChatId,
                parentMessageIndex: null,
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat1Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
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

            const chatId = await getOrCreateChatForAccounts(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                otherAccountIds: [scenario.session2.account.id, scenario.session3.account.id],
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

            await sendChatMessage(context.action(scenario.session1), {
                chatId,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message1"),
            });

            await ProcessContextModule.waitForTestTasks();

            const pause1Promise = notificationEventBeforeProcessingTestCheckpoint.pauseForTest(
                scenario.session1.account.id,
            );
            const pause2Promise = notificationEventAfterProcessingTestCheckpoint.pauseForTest(
                scenario.session3.account.id,
            );

            await sendChatMessage(context.action(scenario.session1), {
                chatId,
                parentMessageIndex: null,
                content: scenario.mentionAccount2MessageContent,
            });

            const message3 = await sendChatMessage(context.action(scenario.session3), {
                chatId,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message3"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
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
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
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
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
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
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 2,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session1.get(),
                }),
            ]);
        });

        test("message notification events processed out of order result in the same latest message including implicit archival states", async () => {
            const scenario = await createNotificationsScenario(context);

            const chatId = await getOrCreateChatForAccounts(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                otherAccountIds: [scenario.session2.account.id],
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

            await sendChatMessage(context.action(scenario.session1), {
                chatId,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message1"),
            });

            await ProcessContextModule.waitForTestTasks();

            const pause1Promise = notificationEventBeforeProcessingTestCheckpoint.pauseForTest(
                scenario.session1.account.id,
            );
            const pause2Promise = notificationEventAfterProcessingTestCheckpoint.pauseForTest(
                scenario.session2.account.id,
            );

            await sendChatMessage(context.action(scenario.session1), {
                chatId,
                parentMessageIndex: null,
                content: scenario.mentionAccount2MessageContent,
            });

            const message3 = await sendChatMessage(context.action(scenario.session2), {
                chatId,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message3"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
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
                    chatId,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
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

            const chat1Id = await getOrCreateChatForAccounts(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                otherAccountIds: [scenario.session2.account.id],
            });

            const chat2Id = await getOrCreateChatForAccounts(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                otherAccountIds: [scenario.session3.account.id],
            });

            const chat3Id = await getOrCreateChatForAccounts(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                otherAccountIds: [scenario.session2.account.id, scenario.session3.account.id],
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

            const message1 = await sendChatMessage(context.action(scenario.session2), {
                chatId: chat1Id,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message1"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message2 = await sendChatMessage(context.action(scenario.session3), {
                chatId: chat2Id,
                parentMessageIndex: null,
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat2Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
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
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message3 = await sendChatMessage(context.action(scenario.session2), {
                chatId: chat3Id,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message3"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat3Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat2Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
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
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message4 = await sendChatMessage(context.action(scenario.session2), {
                chatId: chat1Id,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message4"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat3Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat2Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
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
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message4"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            await sendChatMessage(context.action(scenario.session3), {
                chatId: chat2Id,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message5"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat3Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat2Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
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
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message4"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message6 = await sendChatMessage(context.action(scenario.session2), {
                chatId: chat1Id,
                parentMessageIndex: null,
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 2,
                    latestMessage: {
                        createdTime: message6.createdTime,
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
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat3Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat2Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
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
                    otherChatAccount: null,
                }),
            ]);

            await sendChatMessage(context.action(scenario.session3), {
                chatId: chat2Id,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message7"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 2,
                    latestMessage: {
                        createdTime: message6.createdTime,
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
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat3Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat2Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
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
                    otherChatAccount: null,
                }),
            ]);

            const message8 = await sendChatMessage(context.action(scenario.session3), {
                chatId: chat2Id,
                parentMessageIndex: null,
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat2Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 2,
                    latestMessage: {
                        createdTime: message8.createdTime,
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
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 2,
                    latestMessage: {
                        createdTime: message6.createdTime,
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
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat3Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
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

            const chat1Id = await getOrCreateChatForAccounts(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                otherAccountIds: [scenario.session2.account.id],
            });

            const chat2Id = await getOrCreateChatForAccounts(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                otherAccountIds: [scenario.session3.account.id],
            });

            const chat3Id = await getOrCreateChatForAccounts(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                otherAccountIds: [scenario.session2.account.id, scenario.session3.account.id],
            });

            const chat4Id = await getOrCreateChatForAccounts(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                otherAccountIds: [scenario.session2.account.id, scenario.sharedSession.account.id],
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

            const message1 = await sendChatMessage(context.action(scenario.session2), {
                chatId: chat1Id,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message1"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message2 = await sendChatMessage(context.action(scenario.session3), {
                chatId: chat2Id,
                parentMessageIndex: null,
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat2Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
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
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message3 = await sendChatMessage(context.action(scenario.session2), {
                chatId: chat3Id,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message3"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat3Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat2Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
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
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message1"),
                            references: emptyContentReferences,
                        }),
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
                    chatId: chat3Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat2Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
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
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message4 = await sendChatMessage(context.action(scenario.session2), {
                chatId: chat4Id,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message4"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat4Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message4"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.sharedSession.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat3Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat2Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
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
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            await sendChatMessage(context.action(scenario.session3), {
                chatId: chat2Id,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message5"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat4Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message4"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.sharedSession.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat3Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat2Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
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
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message6 = await sendChatMessage(context.action(scenario.session2), {
                chatId: chat3Id,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message6"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat4Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message4"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.sharedSession.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat3Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message6.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message6"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat2Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
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
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            const message8 = await sendChatMessage(context.action(scenario.session2), {
                chatId: chat3Id,
                parentMessageIndex: null,
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat3Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 2,
                    latestMessage: {
                        createdTime: message8.createdTime,
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
                    otherChatAccount: await scenario.session3.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat4Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message4"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.sharedSession.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat2Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
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
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId: chat1Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);
        });

        test("sends a loud notification on any message after some period of time", async () => {
            const scenario = await createNotificationsScenario(context);

            const chatId = await getOrCreateChatForAccounts(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                otherAccountIds: [scenario.session2.account.id, scenario.session3.account.id],
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

            const message1 = await sendChatMessage(context.action(scenario.session1), {
                chatId,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message1"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
                }),
            ]);

            const message2 = await sendChatMessage(context.action(scenario.session3), {
                chatId,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message2"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message2"),
                            references: emptyContentReferences,
                        }),
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
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message2"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session1.get(),
                }),
            ]);

            const message3 = await sendChatMessage(context.action(scenario.session3), {
                chatId,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message3"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
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
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
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

                message4 = await sendChatMessage(context.action(scenario.session3), {
                    chatId,
                    parentMessageIndex: null,
                    content: createSimpleMessageContent("message4"),
                });
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
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 2,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message4"),
                            references: emptyContentReferences,
                        }),
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
                    chatId,
                    chatAccountCount: 3,
                    loudNotificationCount: 2,
                    latestMessage: {
                        createdTime: message4.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message4"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session1.get(),
                }),
            ]);
        });

        test("can archive inbox entries", async () => {
            const scenario = await createNotificationsScenario(context);

            const chat1Id = await getOrCreateChatForAccounts(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                otherAccountIds: [scenario.session2.account.id, scenario.session3.account.id],
            });

            const chat2Id = await getOrCreateChatForAccounts(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                otherAccountIds: [
                    scenario.session2.account.id,
                    scenario.session3.account.id,
                    scenario.sharedSession.account.id,
                ],
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

            await sendChatMessage(context.action(scenario.session2), {
                chatId: chat1Id,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message1"),
            });

            await sendChatMessage(context.action(scenario.session3), {
                chatId: chat1Id,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message2"),
            });

            const message3 = await sendChatMessage(context.action(scenario.session1), {
                chatId: chat1Id,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message3"),
            });

            const message4 = await sendChatMessage(context.action(scenario.session1), {
                chatId: chat2Id,
                parentMessageIndex: null,
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat2Id,
                    chatAccountCount: 4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
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
                    otherChatAccount: expect.any(AccountModel),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat1Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
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
                    chatId: chat2Id,
                    chatAccountCount: 4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
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
                    otherChatAccount: expect.any(AccountModel),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat1Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session2.get(),
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session3).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "Chat", chatId: chat1Id},
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
                    chatId: chat2Id,
                    chatAccountCount: 4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
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
                    otherChatAccount: expect.any(AccountModel),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat1Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
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
                    chatId: chat2Id,
                    chatAccountCount: 4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
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
                    otherChatAccount: expect.any(AccountModel),
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "Chat", chatId: chat2Id},
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
                    chatId: chat1Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
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
                    chatId: chat2Id,
                    chatAccountCount: 4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
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
                    otherChatAccount: expect.any(AccountModel),
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "Chat", chatId: chat1Id},
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
                    chatId: chat2Id,
                    chatAccountCount: 4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
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
                    otherChatAccount: expect.any(AccountModel),
                }),
            ]);
        });

        test("can unarchive inbox entries", async () => {
            const scenario = await createNotificationsScenario(context);

            const chat1Id = await getOrCreateChatForAccounts(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                otherAccountIds: [scenario.session2.account.id, scenario.session3.account.id],
            });

            const chat2Id = await getOrCreateChatForAccounts(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                otherAccountIds: [
                    scenario.session2.account.id,
                    scenario.session3.account.id,
                    scenario.sharedSession.account.id,
                ],
            });

            const chat3Id = await getOrCreateChatForAccounts(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                otherAccountIds: [scenario.session2.account.id],
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

            await ProcessContextModule.waitForTestTasks();

            await sendChatMessage(context.action(scenario.session2), {
                chatId: chat1Id,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message1"),
            });

            await ProcessContextModule.waitForTestTasks();

            const message2 = await sendChatMessage(context.action(scenario.session3), {
                chatId: chat1Id,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message2"),
            });

            await ProcessContextModule.waitForTestTasks();

            const message3 = await sendChatMessage(context.action(scenario.session1), {
                chatId: chat1Id,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message3"),
            });

            await ProcessContextModule.waitForTestTasks();

            const message4 = await sendChatMessage(context.action(scenario.session1), {
                chatId: chat2Id,
                parentMessageIndex: null,
                content: scenario.mentionAccount2MessageContent,
            });

            await ProcessContextModule.waitForTestTasks();

            const message5 = await sendChatMessage(context.action(scenario.session1), {
                chatId: chat3Id,
                parentMessageIndex: null,
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat3Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message5.createdTime,
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
                    otherChatAccount: null,
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat2Id,
                    chatAccountCount: 4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
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
                    otherChatAccount: expect.any(AccountModel),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat1Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
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
                    chatId: chat2Id,
                    chatAccountCount: 4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
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
                    otherChatAccount: expect.any(AccountModel),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat1Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session2.get(),
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session3).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "Chat", chatId: chat1Id},
                },
            );

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "Chat", chatId: chat2Id},
                },
            );

            await archiveInboxEntry(
                context.action(scenario.session2).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "Chat", chatId: chat1Id},
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
                    chatId: chat3Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message5.createdTime,
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
                    chatId: chat2Id,
                    chatAccountCount: 4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
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
                    otherChatAccount: expect.any(AccountModel),
                }),
            ]);

            await unarchiveInboxEntry(context.action(scenario.session3), {
                spaceId: scenario.space.id,
                key: {type: "Chat", chatId: chat1Id},
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
                    chatId: chat3Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message5.createdTime,
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
                    chatId: chat1Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 0,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session2.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat2Id,
                    chatAccountCount: 4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
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
                    otherChatAccount: expect.any(AccountModel),
                }),
            ]);

            await unarchiveInboxEntry(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                key: {type: "Chat", chatId: chat2Id},
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
                    chatId: chat2Id,
                    chatAccountCount: 4,
                    loudNotificationCount: 0,
                    latestMessage: {
                        createdTime: message4.createdTime,
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
                    otherChatAccount: expect.any(AccountModel),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat3Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message5.createdTime,
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
                    chatId: chat1Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 0,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session2.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat2Id,
                    chatAccountCount: 4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
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
                    otherChatAccount: expect.any(AccountModel),
                }),
            ]);

            await unarchiveInboxEntry(context.action(scenario.session2), {
                spaceId: scenario.space.id,
                key: {type: "Chat", chatId: chat1Id},
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
                    chatId: chat1Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 0,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat2Id,
                    chatAccountCount: 4,
                    loudNotificationCount: 0,
                    latestMessage: {
                        createdTime: message4.createdTime,
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
                    otherChatAccount: expect.any(AccountModel),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat3Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message5.createdTime,
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
                    chatId: chat1Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 0,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session2.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat2Id,
                    chatAccountCount: 4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
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
                    otherChatAccount: expect.any(AccountModel),
                }),
            ]);

            await unarchiveInboxEntry(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                key: {type: "Chat", chatId: chat1Id},
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
                    chatId: chat1Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 0,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session3.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message2"),
                            references: emptyContentReferences,
                        }),
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
                    chatId: chat1Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 0,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session3.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat2Id,
                    chatAccountCount: 4,
                    loudNotificationCount: 0,
                    latestMessage: {
                        createdTime: message4.createdTime,
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
                    otherChatAccount: expect.any(AccountModel),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session2.account.id,
                    chatId: chat3Id,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message5.createdTime,
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
                    chatId: chat1Id,
                    chatAccountCount: 3,
                    loudNotificationCount: 0,
                    latestMessage: {
                        createdTime: message3.createdTime,
                        author: await scenario.session1.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message3"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: await scenario.session2.get(),
                }),
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session3.account.id,
                    chatId: chat2Id,
                    chatAccountCount: 4,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message4.createdTime,
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
                    otherChatAccount: expect.any(AccountModel),
                }),
            ]);
        });

        test("notification on an archived entry revives it", async () => {
            const scenario = await createNotificationsScenario(context);

            const chatId = await getOrCreateChatForAccounts(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                otherAccountIds: [scenario.session2.account.id],
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

            const message1 = await sendChatMessage(context.action(scenario.session2), {
                chatId,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message1"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session1).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "Chat", chatId},
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

            const message2 = await sendChatMessage(context.action(scenario.session2), {
                chatId,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message2"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message2.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message2"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);
        });

        test("notification on an archived entry from own account does not revive it", async () => {
            const scenario = await createNotificationsScenario(context);

            const chatId = await getOrCreateChatForAccounts(context.action(scenario.session1), {
                spaceId: scenario.space.id,
                otherAccountIds: [scenario.session2.account.id],
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

            const message1 = await sendChatMessage(context.action(scenario.session2), {
                chatId,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message1"),
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
                new InboxChatEntryModel({
                    isArchived: false,
                    spaceId: scenario.space.id,
                    accountId: scenario.session1.account.id,
                    chatId,
                    chatAccountCount: 2,
                    loudNotificationCount: 1,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);

            await archiveInboxEntry(
                context.action(scenario.session1).clone({apns: new TestApnsContextModule()}),
                {
                    spaceId: scenario.space.id,
                    key: {type: "Chat", chatId},
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

            await sendChatMessage(context.action(scenario.session1), {
                chatId,
                parentMessageIndex: null,
                content: createSimpleMessageContent("message2"),
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
                key: {type: "Chat", chatId},
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
                    chatId,
                    chatAccountCount: 2,
                    loudNotificationCount: 0,
                    latestMessage: {
                        createdTime: message1.createdTime,
                        author: await scenario.session2.get(),
                        contentTextSnippet: printContentSingleLineTextSnippet({
                            doc: createSimpleMessageContent("message1"),
                            references: emptyContentReferences,
                        }),
                        isStickyMention: false,
                    },
                    otherChatAccount: null,
                }),
            ]);
        });
    });

    test("if an account is mentioned then the mentioned message sticks around until archival", async () => {
        const space = await TestSpace.create(context);

        const session1 = await space.createSession();
        const session2 = await space.createSession();

        const chatId = await getOrCreateChatForAccounts(context.action(session1), {
            spaceId: space.id,
            otherAccountIds: [session2.account.id],
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

        const message1 = await sendChatMessage(session1.action(), {
            chatId,
            parentMessageIndex: null,
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
            new InboxChatEntryModel({
                isArchived: false,
                spaceId: space.id,
                accountId: session2.account.id,
                chatId,
                chatAccountCount: 2,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message1.createdTime,
                    author: await session1.get(),
                    contentTextSnippet: printContentSingleLineTextSnippet({
                        doc: createSimpleMessageContent("Test comment 2"),
                        references: emptyContentReferences,
                    }),
                    isStickyMention: false,
                },
                otherChatAccount: null,
            }),
        ]);

        const message3 = await sendChatMessage(session1.action(), {
            chatId,
            parentMessageIndex: null,
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
            new InboxChatEntryModel({
                isArchived: false,
                spaceId: space.id,
                accountId: session2.account.id,
                chatId,
                chatAccountCount: 2,
                loudNotificationCount: 1,
                latestMessage: {
                    createdTime: message3.createdTime,
                    author: await session1.get(),
                    contentTextSnippet: printContentSingleLineTextSnippet({
                        doc: createSimpleMessageContent("Test comment 3"),
                        references: emptyContentReferences,
                    }),
                    isStickyMention: false,
                },
                otherChatAccount: null,
            }),
        ]);

        const message4 = await sendChatMessage(session1.action(), {
            chatId,
            parentMessageIndex: null,
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
            new InboxChatEntryModel({
                isArchived: false,
                spaceId: space.id,
                accountId: session2.account.id,
                chatId,
                chatAccountCount: 2,
                loudNotificationCount: 2,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: await session1.get(),
                    contentTextSnippet: `Test comment 4 @${session2.account.initialName}`,
                    isStickyMention: true,
                },
                otherChatAccount: null,
            }),
        ]);

        await sendChatMessage(session1.action(), {
            chatId,
            parentMessageIndex: null,
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
            new InboxChatEntryModel({
                isArchived: false,
                spaceId: space.id,
                accountId: session2.account.id,
                chatId,
                chatAccountCount: 2,
                loudNotificationCount: 2,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: await session1.get(),
                    contentTextSnippet: `Test comment 4 @${session2.account.initialName}`,
                    isStickyMention: true,
                },
                otherChatAccount: null,
            }),
        ]);

        await sendChatMessage(session1.action(), {
            chatId,
            parentMessageIndex: null,
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
            new InboxChatEntryModel({
                isArchived: false,
                spaceId: space.id,
                accountId: session2.account.id,
                chatId,
                chatAccountCount: 2,
                loudNotificationCount: 2,
                latestMessage: {
                    createdTime: message4.createdTime,
                    author: await session1.get(),
                    contentTextSnippet: `Test comment 4 @${session2.account.initialName}`,
                    isStickyMention: true,
                },
                otherChatAccount: null,
            }),
        ]);

        const message7 = await sendChatMessage(session1.action(), {
            chatId,
            parentMessageIndex: null,
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
            new InboxChatEntryModel({
                isArchived: false,
                spaceId: space.id,
                accountId: session2.account.id,
                chatId,
                chatAccountCount: 2,
                loudNotificationCount: 3,
                latestMessage: {
                    createdTime: message7.createdTime,
                    author: await session1.get(),
                    contentTextSnippet: `Test comment 7 @${session2.account.initialName}`,
                    isStickyMention: true,
                },
                otherChatAccount: null,
            }),
        ]);

        await sendChatMessage(session1.action(), {
            chatId,
            parentMessageIndex: null,
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
            new InboxChatEntryModel({
                isArchived: false,
                spaceId: space.id,
                accountId: session2.account.id,
                chatId,
                chatAccountCount: 2,
                loudNotificationCount: 3,
                latestMessage: {
                    createdTime: message7.createdTime,
                    author: await session1.get(),
                    contentTextSnippet: `Test comment 7 @${session2.account.initialName}`,
                    isStickyMention: true,
                },
                otherChatAccount: null,
            }),
        ]);

        await archiveInboxEntry(session2.action().clone({apns: new TestApnsContextModule()}), {
            spaceId: space.id,
            key: {type: "Chat", chatId},
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

        const message9 = await sendChatMessage(session1.action(), {
            chatId,
            parentMessageIndex: null,
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
            new InboxChatEntryModel({
                isArchived: false,
                spaceId: space.id,
                accountId: session2.account.id,
                chatId,
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
}
