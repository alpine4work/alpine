import {getOrCreateChatForAccounts, sendChatMessage} from "~/server/dynamo/chat_table";
import {
    archiveInboxEntry,
    getInboxEntries,
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
import {createSimpleMessageContent} from "~/shared/content/message_content_schema";
import {ProcessContextModule} from "~/shared/context/process_context_module";
import {PermissionDeniedError} from "~/shared/error/error";
import {AccountModel} from "~/shared/models/account_model";
import {emptyContentReferences} from "~/shared/models/content_references";
import {InboxChatEntryModel} from "~/shared/models/inbox_model";

const context = createTestContext();

test("messaging creates an inbox entry for all subscribers", async () => {
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message1"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session3.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message1"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session1.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message2.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message2"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session2.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message2.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message2"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session1.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session3.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session2.account,
        }),
    ]);
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message1"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session3.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message1"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session1.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message2.createdTime,
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
            otherChatAccount: scenario.session3.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 2,
            latestMessage: {
                createdTime: message2.createdTime,
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
            otherChatAccount: scenario.session1.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 2,
            latestMessage: {
                createdTime: message3.createdTime,
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
            otherChatAccount: scenario.session3.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 2,
            latestMessage: {
                createdTime: message3.createdTime,
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
            otherChatAccount: scenario.session1.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 3,
            latestMessage: {
                createdTime: message4.createdTime,
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
            otherChatAccount: scenario.session2.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message4.createdTime,
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
            otherChatAccount: scenario.session1.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message1.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message1"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session3.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message1.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message1"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session2.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message2.createdTime,
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
            otherChatAccount: scenario.session3.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message2.createdTime,
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
            otherChatAccount: scenario.session1.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session1.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session2.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message4.createdTime,
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
            otherChatAccount: scenario.session2.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message4.createdTime,
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
            otherChatAccount: scenario.session1.account,
        }),
    ]);
});

test("accounts have separate inboxes for each space", async () => {
    const scenario = await createNotificationsScenario(context);

    const chatId = await getOrCreateChatForAccounts(context.action(scenario.session1), {
        spaceId: scenario.space.id,
        otherAccountIds: [scenario.sharedSession.account.id],
    });

    const otherChatId = await getOrCreateChatForAccounts(context.action(scenario.otherSession), {
        spaceId: scenario.otherSpace.id,
        otherAccountIds: [scenario.sharedSession.account.id],
    });

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
            spaceId: scenario.space.id,
            accountId: scenario.sharedSession.account.id,
            chatId,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message1.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message1"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.sharedSession.account.id,
            chatId,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message1.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message1"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.otherSpace.id,
            accountId: scenario.sharedSession.account.id,
            chatId: otherChatId,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message2.createdTime,
                author: scenario.otherSession.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message2"),
                    references: emptyContentReferences,
                },
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

    const otherChatId = await getOrCreateChatForAccounts(context.action(scenario.otherSession), {
        spaceId: scenario.otherSpace.id,
        otherAccountIds: [scenario.sharedSession.account.id],
    });

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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            chatId: chat1Id,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message1.createdTime,
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
            otherChatAccount: scenario.session1.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            chatId: chat1Id,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message1.createdTime,
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
            otherChatAccount: scenario.session1.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            chatId: chat1Id,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message1.createdTime,
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
            otherChatAccount: scenario.session1.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session2.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session1.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session2.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 2,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session1.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat1Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message1"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat2Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message2.createdTime,
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
            otherChatAccount: null,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat1Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message1"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat3Id,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session3.account,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat2Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message2.createdTime,
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
            otherChatAccount: null,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat1Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message1"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat3Id,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session3.account,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat2Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message2.createdTime,
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
            otherChatAccount: null,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat1Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message4.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message4"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: null,
        }),
    ]);

    const message5 = await sendChatMessage(context.action(scenario.session3), {
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat3Id,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session3.account,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat2Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message5.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message5"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: null,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat1Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message4.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message4"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat1Id,
            chatAccountCount: 2,
            loudNotificationCount: 2,
            latestMessage: {
                createdTime: message6.createdTime,
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
            otherChatAccount: null,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat3Id,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session3.account,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat2Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message5.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message5"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: null,
        }),
    ]);

    const message7 = await sendChatMessage(context.action(scenario.session3), {
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat1Id,
            chatAccountCount: 2,
            loudNotificationCount: 2,
            latestMessage: {
                createdTime: message6.createdTime,
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
            otherChatAccount: null,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat3Id,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session3.account,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat2Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message7.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message7"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat2Id,
            chatAccountCount: 2,
            loudNotificationCount: 2,
            latestMessage: {
                createdTime: message8.createdTime,
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
            otherChatAccount: null,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat1Id,
            chatAccountCount: 2,
            loudNotificationCount: 2,
            latestMessage: {
                createdTime: message6.createdTime,
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
            otherChatAccount: null,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat3Id,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session3.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat1Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message1"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat2Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message2.createdTime,
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
            otherChatAccount: null,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat1Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message1"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat3Id,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session3.account,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat2Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message2.createdTime,
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
            otherChatAccount: null,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat1Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message1"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat3Id,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session3.account,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat2Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message2.createdTime,
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
            otherChatAccount: null,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat1Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message1"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat4Id,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message4.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message4"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.sharedSession.account,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat3Id,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session3.account,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat2Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message2.createdTime,
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
            otherChatAccount: null,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat1Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message1"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: null,
        }),
    ]);

    const message5 = await sendChatMessage(context.action(scenario.session3), {
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat4Id,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message4.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message4"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.sharedSession.account,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat3Id,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session3.account,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat2Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message5.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message5"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: null,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat1Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message1"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat4Id,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message4.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message4"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.sharedSession.account,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat3Id,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message6.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message6"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session3.account,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat2Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message5.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message5"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: null,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat1Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message1"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat3Id,
            chatAccountCount: 3,
            loudNotificationCount: 2,
            latestMessage: {
                createdTime: message8.createdTime,
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
            otherChatAccount: scenario.session3.account,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat4Id,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message4.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message4"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.sharedSession.account,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat2Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message5.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message5"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: null,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat1Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message1"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message1.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message1"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session3.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message2.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message2"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session2.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message2.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message2"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session1.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session2.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session1.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 2,
            latestMessage: {
                createdTime: message4.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message4"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session2.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId,
            chatAccountCount: 3,
            loudNotificationCount: 2,
            latestMessage: {
                createdTime: message4.createdTime,
                author: scenario.session3.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message4"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session1.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId: chat2Id,
            chatAccountCount: 4,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message4.createdTime,
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
            otherChatAccount: expect.any(AccountModel),
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId: chat1Id,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session3.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            chatId: chat2Id,
            chatAccountCount: 4,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message4.createdTime,
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
            otherChatAccount: expect.any(AccountModel),
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            chatId: chat1Id,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session2.account,
        }),
    ]);

    await archiveInboxEntry(context.action(scenario.session3), {
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId: chat2Id,
            chatAccountCount: 4,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message4.createdTime,
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
            otherChatAccount: expect.any(AccountModel),
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId: chat1Id,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session3.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            chatId: chat2Id,
            chatAccountCount: 4,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message4.createdTime,
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
            otherChatAccount: expect.any(AccountModel),
        }),
    ]);

    await archiveInboxEntry(context.action(scenario.session2), {
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId: chat1Id,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session3.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            chatId: chat2Id,
            chatAccountCount: 4,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message4.createdTime,
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
            otherChatAccount: expect.any(AccountModel),
        }),
    ]);

    await archiveInboxEntry(context.action(scenario.session2), {
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            chatId: chat2Id,
            chatAccountCount: 4,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message4.createdTime,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId: chat3Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message5.createdTime,
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
            otherChatAccount: null,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId: chat2Id,
            chatAccountCount: 4,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message4.createdTime,
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
            otherChatAccount: expect.any(AccountModel),
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId: chat1Id,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session3.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            chatId: chat2Id,
            chatAccountCount: 4,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message4.createdTime,
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
            otherChatAccount: expect.any(AccountModel),
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            chatId: chat1Id,
            chatAccountCount: 3,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session2.account,
        }),
    ]);

    await archiveInboxEntry(context.action(scenario.session3), {
        spaceId: scenario.space.id,
        key: {type: "Chat", chatId: chat1Id},
    });

    await archiveInboxEntry(context.action(scenario.session2), {
        spaceId: scenario.space.id,
        key: {type: "Chat", chatId: chat2Id},
    });

    await archiveInboxEntry(context.action(scenario.session2), {
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId: chat3Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message5.createdTime,
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            chatId: chat2Id,
            chatAccountCount: 4,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message4.createdTime,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId: chat3Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message5.createdTime,
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            chatId: chat1Id,
            chatAccountCount: 3,
            loudNotificationCount: 0,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session2.account,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            chatId: chat2Id,
            chatAccountCount: 4,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message4.createdTime,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId: chat2Id,
            chatAccountCount: 4,
            loudNotificationCount: 0,
            latestMessage: {
                createdTime: message4.createdTime,
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
            otherChatAccount: expect.any(AccountModel),
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId: chat3Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message5.createdTime,
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            chatId: chat1Id,
            chatAccountCount: 3,
            loudNotificationCount: 0,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session2.account,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            chatId: chat2Id,
            chatAccountCount: 4,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message4.createdTime,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId: chat1Id,
            chatAccountCount: 3,
            loudNotificationCount: 0,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session3.account,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId: chat2Id,
            chatAccountCount: 4,
            loudNotificationCount: 0,
            latestMessage: {
                createdTime: message4.createdTime,
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
            otherChatAccount: expect.any(AccountModel),
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId: chat3Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message5.createdTime,
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            chatId: chat1Id,
            chatAccountCount: 3,
            loudNotificationCount: 0,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session2.account,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            chatId: chat2Id,
            chatAccountCount: 4,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message4.createdTime,
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId: chat1Id,
            chatAccountCount: 3,
            loudNotificationCount: 0,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session3.account,
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
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId: chat1Id,
            chatAccountCount: 3,
            loudNotificationCount: 0,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session3.account,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId: chat2Id,
            chatAccountCount: 4,
            loudNotificationCount: 0,
            latestMessage: {
                createdTime: message4.createdTime,
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
            otherChatAccount: expect.any(AccountModel),
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session2.account.id,
            chatId: chat3Id,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message5.createdTime,
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
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            chatId: chat1Id,
            chatAccountCount: 3,
            loudNotificationCount: 0,
            latestMessage: {
                createdTime: message3.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message3"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session2.account,
        }),
        new InboxChatEntryModel({
            spaceId: scenario.space.id,
            accountId: scenario.session3.account.id,
            chatId: chat2Id,
            chatAccountCount: 4,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message4.createdTime,
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message1"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: null,
        }),
    ]);

    await archiveInboxEntry(context.action(scenario.session1), {
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message2.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message2"),
                    references: emptyContentReferences,
                },
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId,
            chatAccountCount: 2,
            loudNotificationCount: 1,
            latestMessage: {
                createdTime: message1.createdTime,
                author: scenario.session2.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message1"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: null,
        }),
    ]);

    await archiveInboxEntry(context.action(scenario.session1), {
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
    ).toEqual([]);

    const message2 = await sendChatMessage(context.action(scenario.session1), {
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
            spaceId: scenario.space.id,
            accountId: scenario.session1.account.id,
            chatId,
            chatAccountCount: 2,
            loudNotificationCount: 0,
            latestMessage: {
                createdTime: message2.createdTime,
                author: scenario.session1.account,
                contentSnippet: {
                    doc: createSimpleMessageContent("message2"),
                    references: emptyContentReferences,
                },
            },
            otherChatAccount: scenario.session2.account,
        }),
    ]);
});
