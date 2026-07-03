import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestWebPushContextModule} from "~/server/context/web_push_context_module.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {InboxEntryItem, InboxTable} from "~/server/notifications/data/internal/inbox_table.js";
import {NotificationsTable} from "~/server/notifications/data/internal/notifications_table.js";
import {createOrUpdateAccountWebPushSubscriptionWithoutAuthorization} from "~/server/notifications/data/internal/push/create_or_update_web_push_subscription_without_authorization.js";
import {getInitialWebPushSubscriptionItem} from "~/server/notifications/data/internal/push/get_initial_web_push_subscription_item.js";
import {PendingSubtleNotificationStub} from "~/server/notifications/data/internal/push/pending_subtle_notification_stub.js";
import {queuePendingSubtleNotification} from "~/server/notifications/data/internal/push/queue_pending_subtle_notification.js";
import {
    getPendingSubtleNotificationSummaryContent,
    sendPendingSubtleNotificationsForInbox,
} from "~/server/notifications/data/internal/push/send_pending_subtle_notifications_for_inbox.js";
import {notificationsInjection} from "~/server/notifications/data/notifications_injection.js";
import {processNotificationEvent} from "~/server/notifications/data/process/process_notification_event.js";
import {createTestWebPushSubscription} from "~/server/notifications/data/push/test_helpers/create_test_web_push_subscription.js";
import {addSearchAffinityEntityPointsForTest} from "~/server/search/data/table/search_entity_actions.js";
import {getAccountWithoutAvatar} from "~/server/spaces/get_account.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BrowserId, ChatId, NotificationEventId} from "~/shared/id/types/id_types.js";
import {SearchAffinityEntityId} from "~/shared/search/search_entity_id.js";

const sendWebPushNotificationMock = import.meta.jest.fn();

const context = createTestContext({
    processJob: async (context, job, _jobStartTime, span) => {
        if (job.type === "NotificationEvent") {
            await processNotificationEvent(context, job.event, span);
        }
        if (job.type === "SendWebPushNotification") {
            sendWebPushNotificationMock();
        }
    },
    notificationsInjection,
    chatInjection,
});

async function createWebPushSubscriptionForAccount(
    session: TestSpaceSession,
    browserId: BrowserId,
) {
    const subscription = createTestWebPushSubscription(
        `https://push.cyberworlds.dev/endpoint-${browserId}`,
    );

    await NotificationsTable.createItem(session.action(), {
        ...getInitialWebPushSubscriptionItem(browserId, session.account.id, new Date()),
        subscription,
    });

    return subscription;
}

async function createAffinityForAccount(
    session: TestSpaceSession,
    space: TestSpace,
    targetAccountId: AccountId,
    points: number,
) {
    await addSearchAffinityEntityPointsForTest(space.systemAction(), {
        spaceId: space.id,
        accountId: session.account.id,
        entityId: `Account:${targetAccountId}` as SearchAffinityEntityId,
        points,
    });
}

async function getChatInboxEntry(
    session: TestSpaceSession,
    space: TestSpace,
    chatId: ChatId,
): Promise<InboxEntryItem> {
    return await InboxTable.getItem(space.systemAction(), {
        partitionType: "Inbox",
        sortRangeType: "ChatEntry",
        spaceId: space.id,
        accountId: session.account.id,
        chatId,
    });
}

function createChatMessageNotificationEvent(
    space: TestSpace,
    chat: TestChat,
    authorId: AccountId,
    messageIndex: number,
    createdTime: Date,
) {
    return {
        type: "CreateChatMessage" as const,
        id: generateChronologicalId<NotificationEventId>(),
        spaceId: space.id,
        chatId: chat.id,
        messageIndex,
        createdTime,
        createdTimeZone: defaultTimeZone,
        authorId,
        mentionedAccountIds: new Set<AccountId>(),
        parent: null,
        isContentSnippetComplete: true,
        contentSnippet: createSimpleMessageContent("Hello"),
    };
}

describe("sendPendingSubtleNotificationsForInbox", () => {
    beforeEach(() => {
        sendWebPushNotificationMock.mockClear();
    });

    test("returns early when account has no web push subscriptions", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const otherSession = await space.createSession();

        // Create a chat and message
        const chat = await TestChat.get(session, otherSession);
        const message = await chat.sendMessage(otherSession, "Hello");
        await ProcessContextModule.waitForTestTasks();

        const inboxEntry = await getChatInboxEntry(session, space, chat.id);
        const notificationEvent = createChatMessageNotificationEvent(
            space,
            chat,
            otherSession.account.id,
            message.index,
            message.createdTime,
        );
        await queuePendingSubtleNotification(space.systemAction(), {
            accountId: session.account.id,
            spaceId: space.id,
            notificationEvent,
            inboxEntry,
        });

        // Should not throw and should return early (no web push subscription)
        await sendPendingSubtleNotificationsForInbox(
            space.systemAction().clone({webPush: new TestWebPushContextModule()}),
            {
                accountId: session.account.id,
                spaceId: space.id,
            },
        );
        expect(sendWebPushNotificationMock).not.toHaveBeenCalled();
    });

    test("clears pending notifications and returns when account has no push subscriptions", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const otherSession = await space.createSession();

        // Create a chat and message
        const chat = await TestChat.get(session, otherSession);
        const message = await chat.sendMessage(otherSession, "Hello");
        await ProcessContextModule.waitForTestTasks();

        const inboxEntry = await getChatInboxEntry(session, space, chat.id);
        const notificationEvent = createChatMessageNotificationEvent(
            space,
            chat,
            otherSession.account.id,
            message.index,
            message.createdTime,
        );
        await queuePendingSubtleNotification(space.systemAction(), {
            accountId: session.account.id,
            spaceId: space.id,
            notificationEvent,
            inboxEntry,
        });

        // Should not throw and should return early (no web push subscription)
        await sendPendingSubtleNotificationsForInbox(
            space.systemAction().clone({webPush: new TestWebPushContextModule()}),
            {
                accountId: session.account.id,
                spaceId: space.id,
            },
        );

        // Verify pending notifications were not cleared (since we returned early)
        const subtleNotificationsItem = await NotificationsTable.getItemIfExists(
            space.systemAction(),
            {
                partitionType: "Inbox",
                sortRangeType: "PendingSubtleNotifications",
                spaceId: space.id,
                accountId: session.account.id,
            },
        );
        expect(subtleNotificationsItem?.pendingSubtleNotifications.size).toBe(0);
    });

    test("returns early when there are no pending quiet notifications", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();
        await createWebPushSubscriptionForAccount(session, browserId);

        await sendPendingSubtleNotificationsForInbox(
            space.systemAction().clone({webPush: new TestWebPushContextModule()}),
            {
                accountId: session.account.id,
                spaceId: space.id,
            },
        );
        expect(sendWebPushNotificationMock).not.toHaveBeenCalled();
    });

    test("clears pending notifications and returns when there is no content to send", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();
        await createWebPushSubscriptionForAccount(session, browserId);

        // Manually create a pending quiet notification without an associated inbox entry
        await NotificationsTable.updateItem(
            space.systemAction(),
            {
                partitionType: "Inbox",
                sortRangeType: "PendingSubtleNotifications",
                spaceId: space.id,
                accountId: session.account.id,
            },
            () => ({
                partitionType: "Inbox" as const,
                sortRangeType: "PendingSubtleNotifications" as const,
                spaceId: space.id,
                accountId: session.account.id,
                hasPendingSubtleNotifications: true,
                lastUpdatedTime: new Date(),
                pendingSubtleNotifications: new Map([
                    [
                        "fake-entry-id",
                        {
                            eventAuthorId: generateId<AccountId>(),
                            eventTime: new Date(),
                            inboxEntryKey: {type: "Chat" as const, chatId: generateId()},
                        },
                    ],
                ]),
            }),
        );

        await sendPendingSubtleNotificationsForInbox(
            space.systemAction().clone({webPush: new TestWebPushContextModule()}),
            {
                accountId: session.account.id,
                spaceId: space.id,
            },
        );

        // Pending notifications should be cleared
        const subtleNotificationsItem = await NotificationsTable.getItemIfExists(
            space.systemAction(),
            {
                partitionType: "Inbox",
                sortRangeType: "PendingSubtleNotifications",
                spaceId: space.id,
                accountId: session.account.id,
            },
        );
        expect(subtleNotificationsItem?.pendingSubtleNotifications.size).toBe(0);
        expect(sendWebPushNotificationMock).not.toHaveBeenCalled();
    });
    test("sends web push notification when there is content to send and a web push subscription exists", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const otherSession = await space.createSession();

        // Create a chat and message
        const chat = await TestChat.get(session, otherSession);
        const message = await chat.sendMessage(otherSession, "Hello");
        await ProcessContextModule.waitForTestTasks();

        const inboxEntry = await getChatInboxEntry(session, space, chat.id);
        const notificationEvent = createChatMessageNotificationEvent(
            space,
            chat,
            otherSession.account.id,
            message.index,
            message.createdTime,
        );

        await createOrUpdateAccountWebPushSubscriptionWithoutAuthorization(session.action(), {
            accountId: session.account.id,
            browserId: generateId<BrowserId>(),
            subscription: createTestWebPushSubscription(
                `https://push.cyberworlds.dev/endpoint-${generateId<BrowserId>()}}`,
            ),
        });

        await queuePendingSubtleNotification(space.systemAction(), {
            accountId: session.account.id,
            spaceId: space.id,
            notificationEvent,
            inboxEntry,
        });

        // Should not throw and should return early (no web push subscription)
        await sendPendingSubtleNotificationsForInbox(
            space.systemAction().clone({webPush: new TestWebPushContextModule()}),
            {
                accountId: session.account.id,
                spaceId: space.id,
            },
        );

        // Verify pending notifications were not cleared (since we returned early)
        const subtleNotificationsItem = await NotificationsTable.getItemIfExists(
            space.systemAction(),
            {
                partitionType: "Inbox",
                sortRangeType: "PendingSubtleNotifications",
                spaceId: space.id,
                accountId: session.account.id,
            },
        );
        expect(subtleNotificationsItem?.pendingSubtleNotifications.size).toBe(0);
    });
});

describe("getPendingSubtleNotificationSummaryContent", () => {
    test("returns null when there are no pending quiet notifications", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const currentAccount = await getAccountWithoutAvatar(
            space.systemAction(),
            space.id,
            session.account.id,
        );

        const result = await getPendingSubtleNotificationSummaryContent({
            context: space.systemAction().clone({webPush: new TestWebPushContextModule()}),
            spaceId: space.id,
            currentAccount,
            pendingSubtleNotifications: new Map(),
        });

        expect(result).toBeNull();
    });

    test("returns null when inbox entry does not exist for top affinity author and no other inbox entries exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const currentAccount = await getAccountWithoutAvatar(
            space.systemAction(),
            space.id,
            session.account.id,
        );

        const fakeAuthorId = generateId<AccountId>();

        // Create affinity for the fake author so we go down the top author path
        await createAffinityForAccount(session, space, fakeAuthorId, 100);

        const pendingSubtleNotifications = new Map<string, PendingSubtleNotificationStub>([
            [
                "notification-1",
                {
                    eventAuthorId: fakeAuthorId,
                    eventTime: new Date(),
                    // Reference a non-existent chat
                    inboxEntryKey: {type: "Chat", chatId: generateId()},
                },
            ],
        ]);

        const result = await getPendingSubtleNotificationSummaryContent({
            context: space.systemAction().clone({webPush: new TestWebPushContextModule()}),
            spaceId: space.id,
            currentAccount,
            pendingSubtleNotifications,
        });

        expect(result).toBeNull();
    });

    test("uses the inbox entry title and message snippet for a single inbox entry", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const otherSession = await space.createSession();
        const currentAccount = await getAccountWithoutAvatar(
            space.systemAction(),
            space.id,
            session.account.id,
        );

        const chat = await TestChat.get(session, otherSession);
        const message = await chat.sendMessage(otherSession, "Hello");
        await ProcessContextModule.waitForTestTasks();

        await createAffinityForAccount(session, space, otherSession.account.id, 100);

        const pendingSubtleNotifications = new Map<string, PendingSubtleNotificationStub>([
            [
                "notification-1",
                {
                    eventAuthorId: otherSession.account.id,
                    eventTime: message.createdTime,
                    inboxEntryKey: {type: "Chat", chatId: chat.id},
                },
            ],
        ]);

        const result = await getPendingSubtleNotificationSummaryContent({
            context: space.systemAction().clone({webPush: new TestWebPushContextModule()}),
            spaceId: space.id,
            currentAccount,
            pendingSubtleNotifications,
        });

        // A single inbox entry uses the inbox entry's own title instead of the generic
        // "Update from 1 person" summary, with the message snippet as body.
        const authorFirstName = otherSession.account.initialName.split(" ")[0];
        expect(result).toEqual({
            title: `${authorFirstName} sent you a message`,
            body: "Hello",
        });
    });

    test("returns title with multiple updates from single author", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const otherSession = await space.createSession();
        const currentAccount = await getAccountWithoutAvatar(
            space.systemAction(),
            space.id,
            session.account.id,
        );

        const chat = await TestChat.get(session, otherSession);
        const message1 = await chat.sendMessage(otherSession, "Hello");
        await ProcessContextModule.waitForTestTasks();

        await createAffinityForAccount(session, space, otherSession.account.id, 100);

        // Use two distinct inbox entries so the title counts 2 updates.
        const pendingSubtleNotifications = new Map<string, PendingSubtleNotificationStub>([
            [
                "notification-1",
                {
                    eventAuthorId: otherSession.account.id,
                    eventTime: message1.createdTime,
                    inboxEntryKey: {type: "Chat", chatId: chat.id},
                },
            ],
            [
                "notification-2",
                {
                    eventAuthorId: otherSession.account.id,
                    eventTime: new Date(message1.createdTime.getTime() - 1),
                    inboxEntryKey: {type: "Chat", chatId: generateId<ChatId>()},
                },
            ],
        ]);

        const result = await getPendingSubtleNotificationSummaryContent({
            context: space.systemAction().clone({webPush: new TestWebPushContextModule()}),
            spaceId: space.id,
            currentAccount,
            pendingSubtleNotifications,
        });

        expect(result).not.toBeNull();
        expect(result!.title).toBe(
            `2 updates from ${otherSession.account.initialName.split(" ")[0]}`,
        );
    });

    test("collapses multiple notifications for the same inbox entry into one update", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const otherSession = await space.createSession();
        const currentAccount = await getAccountWithoutAvatar(
            space.systemAction(),
            space.id,
            session.account.id,
        );

        const chat = await TestChat.get(session, otherSession);
        const message1 = await chat.sendMessage(otherSession, "Hello");
        const message2 = await chat.sendMessage(otherSession, "Hello again");
        await ProcessContextModule.waitForTestTasks();

        await createAffinityForAccount(session, space, otherSession.account.id, 100);

        const pendingSubtleNotifications = new Map<string, PendingSubtleNotificationStub>([
            [
                "notification-1",
                {
                    eventAuthorId: otherSession.account.id,
                    eventTime: message1.createdTime,
                    inboxEntryKey: {type: "Chat", chatId: chat.id},
                },
            ],
            [
                "notification-2",
                {
                    eventAuthorId: otherSession.account.id,
                    eventTime: message2.createdTime,
                    inboxEntryKey: {type: "Chat", chatId: chat.id},
                },
            ],
        ]);

        const result = await getPendingSubtleNotificationSummaryContent({
            context: space.systemAction().clone({webPush: new TestWebPushContextModule()}),
            spaceId: space.id,
            currentAccount,
            pendingSubtleNotifications,
        });

        // Both notifications collapse into a single inbox entry, so the inbox entry's own
        // title is used with the latest message snippet as the body.
        const authorFirstName = otherSession.account.initialName.split(" ")[0];
        expect(result).toEqual({
            title: `${authorFirstName} sent you a message`,
            body: "Hello again",
        });
    });

    test("returns title with updates from two authors", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const author1 = await space.createSession();
        const author2 = await space.createSession();
        const currentAccount = await getAccountWithoutAvatar(
            space.systemAction(),
            space.id,
            session.account.id,
        );

        const chat1 = await TestChat.get(session, author1);
        const chat2 = await TestChat.get(session, author2);

        const message1 = await chat1.sendMessage(author1, "Hello from author 1");
        const message2 = await chat2.sendMessage(author2, "Hello from author 2");
        await ProcessContextModule.waitForTestTasks();

        // Create affinity with author1 having higher affinity
        await createAffinityForAccount(session, space, author1.account.id, 200);
        await createAffinityForAccount(session, space, author2.account.id, 100);

        const pendingSubtleNotifications = new Map<string, PendingSubtleNotificationStub>([
            [
                "notification-1",
                {
                    eventAuthorId: author2.account.id,
                    eventTime: message2.createdTime,
                    inboxEntryKey: {type: "Chat", chatId: chat2.id},
                },
            ],
            [
                "notification-2",
                {
                    eventAuthorId: author1.account.id,
                    eventTime: message1.createdTime,
                    inboxEntryKey: {type: "Chat", chatId: chat1.id},
                },
            ],
        ]);

        const result = await getPendingSubtleNotificationSummaryContent({
            context: space.systemAction().clone({webPush: new TestWebPushContextModule()}),
            spaceId: space.id,
            currentAccount,
            pendingSubtleNotifications,
        });

        expect(result).not.toBeNull();
        // Title should include both author names with "and" conjunction
        const author1FirstName = author1.account.initialName.split(" ")[0];
        const author2FirstName = author2.account.initialName.split(" ")[0];
        expect(result!.title).toBe(`2 updates from ${author1FirstName} and ${author2FirstName}`);
    });

    test("includes both authors in the title when they have the same affinity points sorted alphabetically", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const author1 = await space.createSession();
        const author2 = await space.createSession();
        const currentAccount = await getAccountWithoutAvatar(
            space.systemAction(),
            space.id,
            session.account.id,
        );

        const chat1 = await TestChat.get(session, author1);
        const chat2 = await TestChat.get(session, author2);

        const message1 = await chat1.sendMessage(author1, "Hello from author 1");
        const message2 = await chat2.sendMessage(author2, "Hello from author 2");
        await ProcessContextModule.waitForTestTasks();

        // Both authors have identical affinity points, so neither outranks the other.
        await createAffinityForAccount(session, space, author1.account.id, 100);
        await createAffinityForAccount(session, space, author2.account.id, 100);

        const pendingSubtleNotifications = new Map<string, PendingSubtleNotificationStub>([
            [
                "notification-1",
                {
                    eventAuthorId: author1.account.id,
                    eventTime: message1.createdTime,
                    inboxEntryKey: {type: "Chat", chatId: chat1.id},
                },
            ],
            [
                "notification-2",
                {
                    eventAuthorId: author2.account.id,
                    eventTime: message2.createdTime,
                    inboxEntryKey: {type: "Chat", chatId: chat2.id},
                },
            ],
        ]);

        const result = await getPendingSubtleNotificationSummaryContent({
            context: space.systemAction().clone({webPush: new TestWebPushContextModule()}),
            spaceId: space.id,
            currentAccount,
            pendingSubtleNotifications,
        });

        const [firstAuthor, secondAuthor] = [
            {
                id: author1.account.id,
                firstName: author1.account.initialName.split(" ")[0],
            },
            {
                id: author2.account.id,
                firstName: author2.account.initialName.split(" ")[0],
            },
        ].toSorted((a, b) => a.id.localeCompare(b.id));
        expect(result!.title).toBe(
            `2 updates from ${firstAuthor!.firstName} and ${secondAuthor!.firstName}`,
        );
    });

    test("returns title with updates from more than two authors using others summary", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const author1 = await space.createSession();
        const author2 = await space.createSession();
        const author3 = await space.createSession();
        const currentAccount = await getAccountWithoutAvatar(
            space.systemAction(),
            space.id,
            session.account.id,
        );

        const chat1 = await TestChat.get(session, author1);
        const chat2 = await TestChat.get(session, author2);
        const chat3 = await TestChat.get(session, author3);

        const message1 = await chat1.sendMessage(author1, "Hello from author 1");
        const message2 = await chat2.sendMessage(author2, "Hello from author 2");
        const message3 = await chat3.sendMessage(author3, "Hello from author 3");
        await ProcessContextModule.waitForTestTasks();

        // Create affinity with descending scores
        await createAffinityForAccount(session, space, author1.account.id, 300);
        await createAffinityForAccount(session, space, author2.account.id, 200);
        await createAffinityForAccount(session, space, author3.account.id, 100);

        const pendingSubtleNotifications = new Map<string, PendingSubtleNotificationStub>([
            [
                "notification-1",
                {
                    eventAuthorId: author1.account.id,
                    eventTime: message1.createdTime,
                    inboxEntryKey: {type: "Chat", chatId: chat1.id},
                },
            ],
            [
                "notification-2",
                {
                    eventAuthorId: author2.account.id,
                    eventTime: message2.createdTime,
                    inboxEntryKey: {type: "Chat", chatId: chat2.id},
                },
            ],
            [
                "notification-3",
                {
                    eventAuthorId: author3.account.id,
                    eventTime: message3.createdTime,
                    inboxEntryKey: {type: "Chat", chatId: chat3.id},
                },
            ],
        ]);

        const result = await getPendingSubtleNotificationSummaryContent({
            context: space.systemAction().clone({webPush: new TestWebPushContextModule()}),
            spaceId: space.id,
            currentAccount,
            pendingSubtleNotifications,
        });

        expect(result).not.toBeNull();
        // Title should show top 2 authors and "Other" for the third
        const author1FirstName = author1.account.initialName.split(" ")[0];
        const author2FirstName = author2.account.initialName.split(" ")[0];
        expect(result!.title).toBe(
            `3 updates from ${author1FirstName}, ${author2FirstName}, and 1 other`,
        );
    });

    test("returns null when no author has an inbox entry even if unrelated inbox entries exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const currentAccount = await getAccountWithoutAvatar(
            space.systemAction(),
            space.id,
            session.account.id,
        );

        const author1 = await space.createSession({name: "Bob"});
        const author2 = await space.createSession({name: "Alice"});

        const chat1 = await TestChat.get(session, author1);
        await chat1.sendMessage(author1, "Message 1");
        await chat1.sendMessage(author1, "Message 2");

        const chat2 = await TestChat.get(session, author2);
        await chat2.sendMessage(author2, "Message 3");
        await chat2.sendMessage(author2, "Message 4");

        await ProcessContextModule.waitForTestTasks();

        const fakeAuthorId = generateId<AccountId>();

        // Create affinity for the fake author so we go down the top author path
        await createAffinityForAccount(session, space, fakeAuthorId, 100);

        const pendingSubtleNotifications = new Map<string, PendingSubtleNotificationStub>([
            [
                "notification-1",
                {
                    eventAuthorId: fakeAuthorId,
                    eventTime: new Date(),
                    // Reference a non-existent chat
                    inboxEntryKey: {type: "Chat", chatId: generateId()},
                },
            ],
        ]);

        const result = await getPendingSubtleNotificationSummaryContent({
            context: space.systemAction().clone({webPush: new TestWebPushContextModule()}),
            spaceId: space.id,
            currentAccount,
            pendingSubtleNotifications,
        });

        // Even though unrelated inbox entries exist (author1 and author2 chats), the
        // notification author's inbox entry is missing so there's no content to send.
        expect(result).toBeNull();
    });

    test("falls through to the next highest affinity author when the top author has no inbox entry", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const highAffinityAuthor = await space.createSession({name: "Alice"});
        const lowAffinityAuthor = await space.createSession({name: "Bob"});
        const unrelatedAuthor = await space.createSession({name: "Carol"});
        const currentAccount = await getAccountWithoutAvatar(
            space.systemAction(),
            space.id,
            session.account.id,
        );

        // The low affinity author has a real inbox entry from an earlier message.
        const lowAffinityChat = await TestChat.get(session, lowAffinityAuthor);
        const lowAffinityMessage = await lowAffinityChat.sendMessage(lowAffinityAuthor, "Hello");

        // An unrelated author has the most recent inbox entry overall, which must not be
        // surfaced since they aren't one of the notification authors.
        const unrelatedChat = await TestChat.get(session, unrelatedAuthor);
        await unrelatedChat.sendMessage(unrelatedAuthor, "Most recent unrelated message");
        await ProcessContextModule.waitForTestTasks();

        await createAffinityForAccount(session, space, highAffinityAuthor.account.id, 500);
        await createAffinityForAccount(session, space, lowAffinityAuthor.account.id, 100);

        const pendingSubtleNotifications = new Map<string, PendingSubtleNotificationStub>([
            [
                "notification-1",
                {
                    eventAuthorId: highAffinityAuthor.account.id,
                    eventTime: new Date(),
                    // Reference a non-existent chat so the top author has no inbox entry.
                    inboxEntryKey: {type: "Chat", chatId: generateId<ChatId>()},
                },
            ],
            [
                "notification-2",
                {
                    eventAuthorId: lowAffinityAuthor.account.id,
                    eventTime: lowAffinityMessage.createdTime,
                    inboxEntryKey: {type: "Chat", chatId: lowAffinityChat.id},
                },
            ],
        ]);

        const result = await getPendingSubtleNotificationSummaryContent({
            context: space.systemAction().clone({webPush: new TestWebPushContextModule()}),
            spaceId: space.id,
            currentAccount,
            pendingSubtleNotifications,
        });

        // The body should come from the low affinity author's inbox entry (the next author
        // in affinity order).
        const lowAffinityFirstName = lowAffinityAuthor.account.initialName.split(" ")[0];
        expect(result!.body).toBe(`${lowAffinityFirstName} sent you a message`);
    });

    test("treats authors without affinity as zero affinity and uses their inbox entry", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const author = await space.createSession({name: "Bob"});
        const currentAccount = await getAccountWithoutAvatar(
            space.systemAction(),
            space.id,
            session.account.id,
        );

        const chat = await TestChat.get(session, author);
        const message = await chat.sendMessage(author, "Hello");
        await ProcessContextModule.waitForTestTasks();

        // Intentionally do not create any affinity for the author. They should be treated
        // as having zero affinity points and still selected as the top author rather than
        // falling back to the latest inbox entry.
        const pendingSubtleNotifications = new Map<string, PendingSubtleNotificationStub>([
            [
                "notification-1",
                {
                    eventAuthorId: author.account.id,
                    eventTime: message.createdTime,
                    inboxEntryKey: {type: "Chat", chatId: chat.id},
                },
            ],
        ]);

        const result = await getPendingSubtleNotificationSummaryContent({
            context: space.systemAction().clone({webPush: new TestWebPushContextModule()}),
            spaceId: space.id,
            currentAccount,
            pendingSubtleNotifications,
        });

        // The zero-affinity author is still considered, so we resolve their inbox entry
        // instead of returning null.
        const authorFirstName = author.account.initialName.split(" ")[0];
        expect(result).toEqual({
            title: `${authorFirstName} sent you a message`,
            body: "Hello",
        });
    });

    test("uses most recent notification from highest affinity author for body", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const highAffinityAuthor = await space.createSession();
        const lowAffinityAuthor = await space.createSession();
        const currentAccount = await getAccountWithoutAvatar(
            space.systemAction(),
            space.id,
            session.account.id,
        );

        const chat1 = await TestChat.get(session, highAffinityAuthor);
        const chat2 = await TestChat.get(session, lowAffinityAuthor);

        // Send messages with different times
        const earlierMessage = await chat1.sendMessage(highAffinityAuthor, "Earlier message");
        const laterMessage = await chat1.sendMessage(highAffinityAuthor, "Later message");
        await chat2.sendMessage(lowAffinityAuthor, "Low affinity message");
        await ProcessContextModule.waitForTestTasks();

        // High affinity author gets much higher score
        await createAffinityForAccount(session, space, highAffinityAuthor.account.id, 500);
        await createAffinityForAccount(session, space, lowAffinityAuthor.account.id, 50);

        const pendingSubtleNotifications = new Map<string, PendingSubtleNotificationStub>([
            [
                "notification-1",
                {
                    eventAuthorId: highAffinityAuthor.account.id,
                    eventTime: earlierMessage.createdTime,
                    inboxEntryKey: {type: "Chat", chatId: chat1.id},
                },
            ],
            [
                "notification-2",
                {
                    eventAuthorId: highAffinityAuthor.account.id,
                    eventTime: laterMessage.createdTime,
                    inboxEntryKey: {type: "Chat", chatId: chat1.id},
                },
            ],
            [
                "notification-3",
                {
                    eventAuthorId: lowAffinityAuthor.account.id,
                    eventTime: new Date(),
                    inboxEntryKey: {type: "Chat", chatId: chat2.id},
                },
            ],
        ]);

        const result = await getPendingSubtleNotificationSummaryContent({
            context: space.systemAction().clone({webPush: new TestWebPushContextModule()}),
            spaceId: space.id,
            currentAccount,
            pendingSubtleNotifications,
        });

        expect(result).not.toBeNull();
        // The body should be from the high affinity author's chat inbox entry
        expect(result!.body).toBeTruthy();
    });

    test("returns title with updates from four or more authors with 2 others summary", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const author1 = await space.createSession({name: "Bob"});
        const author2 = await space.createSession({name: "Alice"});
        const author3 = await space.createSession({name: "Charlie"});
        const author4 = await space.createSession({name: "David"});
        const currentAccount = await getAccountWithoutAvatar(
            space.systemAction(),
            space.id,
            session.account.id,
        );

        const chat1 = await TestChat.get(session, author1);
        const chat2 = await TestChat.get(session, author2);
        const chat3 = await TestChat.get(session, author3);
        const chat4 = await TestChat.get(session, author4);

        const message1 = await chat1.sendMessage(author1, "Hello");
        const message2 = await chat2.sendMessage(author2, "Hello");
        const message3 = await chat3.sendMessage(author3, "Hello");
        const message4 = await chat4.sendMessage(author4, "Hello");
        await ProcessContextModule.waitForTestTasks();

        await createAffinityForAccount(session, space, author1.account.id, 400);
        await createAffinityForAccount(session, space, author2.account.id, 300);
        await createAffinityForAccount(session, space, author3.account.id, 200);
        await createAffinityForAccount(session, space, author4.account.id, 100);

        const pendingSubtleNotifications = new Map<string, PendingSubtleNotificationStub>([
            [
                "notification-1",
                {
                    eventAuthorId: author1.account.id,
                    eventTime: message1.createdTime,
                    inboxEntryKey: {type: "Chat", chatId: chat1.id},
                },
            ],
            [
                "notification-2",
                {
                    eventAuthorId: author2.account.id,
                    eventTime: message2.createdTime,
                    inboxEntryKey: {type: "Chat", chatId: chat2.id},
                },
            ],
            [
                "notification-3",
                {
                    eventAuthorId: author3.account.id,
                    eventTime: message3.createdTime,
                    inboxEntryKey: {type: "Chat", chatId: chat3.id},
                },
            ],
            [
                "notification-4",
                {
                    eventAuthorId: author4.account.id,
                    eventTime: message4.createdTime,
                    inboxEntryKey: {type: "Chat", chatId: chat4.id},
                },
            ],
        ]);

        const result = await getPendingSubtleNotificationSummaryContent({
            context: space.systemAction().clone({webPush: new TestWebPushContextModule()}),
            spaceId: space.id,
            currentAccount,
            pendingSubtleNotifications,
        });

        expect(result).not.toBeNull();
        const author1FirstName = author1.account.initialName.split(" ")[0];
        const author2FirstName = author2.account.initialName.split(" ")[0];
        // 4 authors - 2 shown = 2 others
        expect(result!.title).toBe(
            `4 updates from ${author1FirstName}, ${author2FirstName}, and 2 others`,
        );
    });

    test("orders authors by affinity score not by notification order", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const lowAffinityAuthor = await space.createSession({name: "Bob"});
        const highAffinityAuthor = await space.createSession({name: "Alice"});
        const currentAccount = await getAccountWithoutAvatar(
            space.systemAction(),
            space.id,
            session.account.id,
        );

        const chat1 = await TestChat.get(session, lowAffinityAuthor);
        const chat2 = await TestChat.get(session, highAffinityAuthor);

        // Low affinity author's message comes first
        const message1 = await chat1.sendMessage(lowAffinityAuthor, "First message");
        const message2 = await chat2.sendMessage(highAffinityAuthor, "Second message");
        await ProcessContextModule.waitForTestTasks();

        // But high affinity author has higher score
        await createAffinityForAccount(session, space, lowAffinityAuthor.account.id, 50);
        await createAffinityForAccount(session, space, highAffinityAuthor.account.id, 500);

        const pendingSubtleNotifications = new Map<string, PendingSubtleNotificationStub>([
            [
                "notification-1",
                {
                    eventAuthorId: lowAffinityAuthor.account.id,
                    eventTime: message1.createdTime,
                    inboxEntryKey: {type: "Chat", chatId: chat1.id},
                },
            ],
            [
                "notification-2",
                {
                    eventAuthorId: highAffinityAuthor.account.id,
                    eventTime: message2.createdTime,
                    inboxEntryKey: {type: "Chat", chatId: chat2.id},
                },
            ],
        ]);

        const result = await getPendingSubtleNotificationSummaryContent({
            context: space.systemAction().clone({webPush: new TestWebPushContextModule()}),
            spaceId: space.id,
            currentAccount,
            pendingSubtleNotifications,
        });

        expect(result).not.toBeNull();
        // High affinity author should be listed first
        const highAffinityFirstName = highAffinityAuthor.account.initialName.split(" ")[0];
        const lowAffinityFirstName = lowAffinityAuthor.account.initialName.split(" ")[0];
        expect(result!.title).toBe(
            `2 updates from ${highAffinityFirstName} and ${lowAffinityFirstName}`,
        );
    });

    test("handles large number of updates with 10+ formatting", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const otherSession = await space.createSession();
        const currentAccount = await getAccountWithoutAvatar(
            space.systemAction(),
            space.id,
            session.account.id,
        );

        const chat = await TestChat.get(session, otherSession);
        const message = await chat.sendMessage(otherSession, "Hello");
        await ProcessContextModule.waitForTestTasks();

        await createAffinityForAccount(session, space, otherSession.account.id, 100);

        // Create 15 notifications across 15 distinct inbox entries to test the 10+
        // formatting. The real chat entry (used for the most recent notification) supplies
        // the body; the other entries don't need to exist in the database since the title
        // only depends on the entry key.
        const pendingSubtleNotifications = new Map<string, PendingSubtleNotificationStub>();
        pendingSubtleNotifications.set("notification-0", {
            eventAuthorId: otherSession.account.id,
            eventTime: new Date(message.createdTime.getTime() + 14),
            inboxEntryKey: {type: "Chat", chatId: chat.id},
        });
        for (let i = 1; i < 15; i++) {
            pendingSubtleNotifications.set(`notification-${i}`, {
                eventAuthorId: otherSession.account.id,
                eventTime: new Date(message.createdTime.getTime() + i - 1),
                inboxEntryKey: {type: "Chat", chatId: generateId<ChatId>()},
            });
        }

        const result = await getPendingSubtleNotificationSummaryContent({
            context: space.systemAction().clone({webPush: new TestWebPushContextModule()}),
            spaceId: space.id,
            currentAccount,
            pendingSubtleNotifications,
        });

        expect(result).not.toBeNull();
        const authorFirstName = otherSession.account.initialName.split(" ")[0];
        // 15 updates should be formatted as "10+ updates"
        expect(result!.title).toBe(`10+ updates from ${authorFirstName}`);
    });

    test("handles four or more authors with varying inbox entry types", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const author1 = await space.createSession({name: "Bob"});
        const author2 = await space.createSession({name: "Alice"});
        const author3 = await space.createSession({name: "Charlie"});
        const author4 = await space.createSession({name: "David"});
        const currentAccount = await getAccountWithoutAvatar(
            space.systemAction(),
            space.id,
            session.account.id,
        );

        const chat1 = await TestChat.get(session, author1);
        const message1 = await chat1.sendMessage(author1, "Hello");

        const channel = await TestChannel.create(session, {access: "Public"});

        const post1 = await channel.createPost(session, "New post 1");
        const post1Comment1 = await post1.createComment(author2, "New comment 1");
        const post1Comment2 = await post1.createComment(author3, "New comment 2");

        const post2 = await channel.createPost(author3, "New post 2");

        const document = await TestDocument.create(session, {
            access: "Public",
            title: "Test document title",
        });
        const {range} = await document.type(session, "Document body");
        const documentCommentThread1 = await document.createCommentThread(
            author2,
            range,
            "Test comment thread 1",
        );
        const documentCommentThread1Comment1 = await documentCommentThread1.createComment(
            author3,
            "New comment 1",
        );

        const documentCommentThread2 = await document.createCommentThread(
            author2,
            range,
            "Test comment thread 2",
        );

        const task1 = await TestTask.create(session, {assignee: author4});
        const taskComment1 = await task1.createComment(author4, "New comment 1");

        await ProcessContextModule.waitForTestTasks();

        await createAffinityForAccount(session, space, author1.account.id, 400);
        await createAffinityForAccount(session, space, author2.account.id, 300);
        await createAffinityForAccount(session, space, author3.account.id, 200);
        await createAffinityForAccount(session, space, author4.account.id, 100);

        const pendingSubtleNotifications = new Map<string, PendingSubtleNotificationStub>([
            [
                "notification-1",
                {
                    eventAuthorId: author1.account.id,
                    eventTime: message1.createdTime,
                    inboxEntryKey: {type: "Chat", chatId: chat1.id},
                },
            ],
            [
                "notification-2",
                {
                    eventAuthorId: author2.account.id,
                    eventTime: post1.createdTime,
                    inboxEntryKey: {
                        type: "ChannelPosts",
                        channelId: channel.id,
                        bucketGeneration: 0,
                    },
                },
            ],
            [
                "notification-3",
                {
                    eventAuthorId: author2.account.id,
                    eventTime: post1Comment1.createdTime,
                    inboxEntryKey: {
                        type: "PostComments",
                        postId: post1.id,
                    },
                },
            ],
            [
                "notification-4",
                {
                    eventAuthorId: author3.account.id,
                    eventTime: post1Comment2.createdTime,
                    inboxEntryKey: {
                        type: "PostComments",
                        postId: post1.id,
                    },
                },
            ],
            [
                "notification-5",
                {
                    eventAuthorId: author3.account.id,
                    eventTime: post2.createdTime,
                    inboxEntryKey: {
                        type: "ChannelPosts",
                        channelId: channel.id,
                        bucketGeneration: 0,
                    },
                },
            ],
            [
                "notification-6",
                {
                    eventAuthorId: author4.account.id,
                    eventTime: documentCommentThread1.firstComment.createdTime,
                    inboxEntryKey: {
                        type: "DocumentNewCommentThreads",
                        documentId: document.id,
                        bucketGeneration: 0,
                    },
                },
            ],
            [
                "notification-7",
                {
                    eventAuthorId: author3.account.id,
                    eventTime: documentCommentThread1Comment1.createdTime,
                    inboxEntryKey: {
                        type: "DocumentCommentThread",
                        documentId: document.id,
                        commentThreadId: documentCommentThread1.id,
                    },
                },
            ],
            [
                "notification-8",
                {
                    eventAuthorId: author4.account.id,
                    eventTime: documentCommentThread2.firstComment.createdTime,
                    inboxEntryKey: {
                        type: "DocumentNewCommentThreads",
                        documentId: document.id,
                        bucketGeneration: 0,
                    },
                },
            ],
            [
                "notification-9",
                {
                    eventAuthorId: author4.account.id,
                    eventTime: taskComment1.createdTime,
                    inboxEntryKey: {
                        type: "Task",
                        taskId: task1.id,
                    },
                },
            ],
        ]);

        const result = await getPendingSubtleNotificationSummaryContent({
            context: space.systemAction().clone({webPush: new TestWebPushContextModule()}),
            spaceId: space.id,
            currentAccount,
            pendingSubtleNotifications,
        });

        expect(result).not.toBeNull();
        const author1FirstName = author1.account.initialName.split(" ")[0];
        const author2FirstName = author2.account.initialName.split(" ")[0];
        // The 9 notifications collapse into 6 distinct inbox entries (the chat, the
        // channel posts entry, the post comments entry, the document new comment threads
        // entry, the document comment thread entry, and the task). 4 authors - 2 shown = 2
        // others.
        expect(result!.title).toBe(
            `6 updates from ${author1FirstName}, ${author2FirstName}, and 2 others`,
        );
    });
});
