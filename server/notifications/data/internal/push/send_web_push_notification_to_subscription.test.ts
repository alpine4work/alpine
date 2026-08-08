import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {
    TestWebPushContextModule,
    WebPushContextModuleBase,
} from "~/server/context/web_push_context_module.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {NotificationsTable} from "~/server/notifications/data/internal/notifications_table.js";
import {getInitialWebPushSubscriptionItem} from "~/server/notifications/data/internal/push/get_initial_web_push_subscription_item.js";
import {sendWebPushNotificationToSubscription} from "~/server/notifications/data/internal/push/send_web_push_notification_to_subscription.js";
import {createTestWebPushSubscription} from "~/server/notifications/data/push/test_helpers/create_test_web_push_subscription.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {
    InternalError,
    NotFoundError,
    PermissionDeniedError,
    UnknownError,
} from "~/shared/error/error.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {BrowserId} from "~/shared/id/types/id_types.open_source.js";
import {WebPushNotificationContent} from "~/shared/notifications/web_push_notification_content.js";
import {WebPushSubscription} from "~/shared/notifications/web_push_subscription.js";

const context = createTestContext();

function createTestNotificationContent(): WebPushNotificationContent {
    return {
        title: "Test Notification",
        body: "This is a test notification",
        data: {
            url: "https://cyberworlds.dev/test",
        },
    };
}

class MockWebPushContextModule extends WebPushContextModuleBase {
    public sendNotificationToBrowserMock = import.meta.jest.fn();

    public override async sendNotificationToBrowser(
        subscription: WebPushSubscription,
        notificationContent: WebPushNotificationContent,
        options?: unknown,
    ) {
        return this.sendNotificationToBrowserMock(subscription, notificationContent, options);
    }
}

describe("sendWebPushNotificationToSubscription", () => {
    test("throws NotFoundError when subscription item does not exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();

        await expect(
            sendWebPushNotificationToSubscription(
                session.action().clone({webPush: new TestWebPushContextModule()}),
                {
                    spaceId: space.id,
                    accountId: session.account.id,
                    browserId,
                    notificationContent: createTestNotificationContent(),
                },
            ),
        ).rejects.toThrow(NotFoundError);
    });

    test("throws NotFoundError when subscription item exists but subscription is null", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();

        await NotificationsTable.createItem(session.action(), {
            ...getInitialWebPushSubscriptionItem(browserId, session.account.id, new Date()),
            subscription: null,
        });

        await expect(
            sendWebPushNotificationToSubscription(
                session.action().clone({webPush: new TestWebPushContextModule()}),
                {
                    spaceId: space.id,
                    accountId: session.account.id,
                    browserId,
                    notificationContent: createTestNotificationContent(),
                },
            ),
        ).rejects.toThrow(NotFoundError);
    });

    test("sends notification when subscription item exists with valid subscription", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();
        const subscription = createTestWebPushSubscription(
            "https://push.cyberworlds.dev/endpoint1",
        );

        await NotificationsTable.createItem(session.action(), {
            ...getInitialWebPushSubscriptionItem(browserId, session.account.id, new Date()),
            subscription,
        });

        const mockWebPush = new MockWebPushContextModule();
        mockWebPush.sendNotificationToBrowserMock.mockResolvedValue({
            statusCode: 200,
            body: "",
            headers: {},
        });

        const notificationContent = createTestNotificationContent();

        await sendWebPushNotificationToSubscription(
            session.action().clone({webPush: mockWebPush}),
            {
                spaceId: space.id,
                accountId: session.account.id,
                browserId,
                notificationContent,
            },
        );

        expect(mockWebPush.sendNotificationToBrowserMock).toHaveBeenCalledTimes(1);
    });

    test("passes the correct subscription to sendNotificationToBrowser", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();
        const subscription = createTestWebPushSubscription(
            "https://push.cyberworlds.dev/endpoint2",
        );

        await NotificationsTable.createItem(session.action(), {
            ...getInitialWebPushSubscriptionItem(browserId, session.account.id, new Date()),
            subscription,
        });

        const mockWebPush = new MockWebPushContextModule();
        mockWebPush.sendNotificationToBrowserMock.mockResolvedValue({
            statusCode: 200,
            body: "",
            headers: {},
        });

        const notificationContent = createTestNotificationContent();

        await sendWebPushNotificationToSubscription(
            session.action().clone({webPush: mockWebPush}),
            {
                spaceId: space.id,
                accountId: session.account.id,
                browserId,
                notificationContent,
            },
        );

        expect(mockWebPush.sendNotificationToBrowserMock).toHaveBeenCalledWith(
            subscription,
            notificationContent,
            undefined,
        );
    });

    test("does not send notification when spaceId is in optedOutSpaceIds", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();
        const subscription = createTestWebPushSubscription(
            "https://push.cyberworlds.dev/endpoint3",
        );

        await NotificationsTable.createItem(session.action(), {
            ...getInitialWebPushSubscriptionItem(browserId, session.account.id, new Date()),
            subscription,
            optedOutSpaceIds: new Set([space.id]),
        });

        const mockWebPush = new MockWebPushContextModule();
        mockWebPush.sendNotificationToBrowserMock.mockResolvedValue({
            statusCode: 200,
            body: "",
            headers: {},
        });

        await sendWebPushNotificationToSubscription(
            session.action().clone({webPush: mockWebPush}),
            {
                spaceId: space.id,
                accountId: session.account.id,
                browserId,
                notificationContent: createTestNotificationContent(),
            },
        );

        expect(mockWebPush.sendNotificationToBrowserMock).not.toHaveBeenCalled();
    });

    test("removes subscription when sendNotificationToBrowser throws InternalError", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();
        const subscription = createTestWebPushSubscription(
            "https://push.cyberworlds.dev/endpoint4",
        );

        await NotificationsTable.createItem(session.action(), {
            ...getInitialWebPushSubscriptionItem(browserId, session.account.id, new Date()),
            subscription,
        });

        const mockWebPush = new MockWebPushContextModule();
        mockWebPush.sendNotificationToBrowserMock.mockRejectedValue(
            new InternalError("Web push subscription is no longer valid"),
        );

        await sendWebPushNotificationToSubscription(
            session.action().clone({webPush: mockWebPush}),
            {
                spaceId: space.id,
                accountId: session.account.id,
                browserId,
                notificationContent: createTestNotificationContent(),
            },
        );

        const item = await NotificationsTable.getItemIfExists(session.action(), {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId: session.account.id,
            browserId,
        });

        expect(item?.subscription).toBeNull();
    });

    test("rethrows non-InternalError errors from sendNotificationToBrowser", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();
        const subscription = createTestWebPushSubscription(
            "https://push.cyberworlds.dev/endpoint5",
        );

        await NotificationsTable.createItem(session.action(), {
            ...getInitialWebPushSubscriptionItem(browserId, session.account.id, new Date()),
            subscription,
        });

        const mockWebPush = new MockWebPushContextModule();
        const testError = new UnknownError("Some other error");
        mockWebPush.sendNotificationToBrowserMock.mockRejectedValue(testError);

        await expect(
            sendWebPushNotificationToSubscription(session.action().clone({webPush: mockWebPush}), {
                spaceId: space.id,
                accountId: session.account.id,
                browserId,
                notificationContent: createTestNotificationContent(),
            }),
        ).rejects.toThrow(testError);
    });

    test("does not remove subscription when non-InternalError is thrown", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();
        const subscription = createTestWebPushSubscription(
            "https://push.cyberworlds.dev/endpoint6",
        );

        await NotificationsTable.createItem(session.action(), {
            ...getInitialWebPushSubscriptionItem(browserId, session.account.id, new Date()),
            subscription,
        });

        const mockWebPush = new MockWebPushContextModule();
        mockWebPush.sendNotificationToBrowserMock.mockRejectedValue(
            new UnknownError("Some other error"),
        );

        try {
            await sendWebPushNotificationToSubscription(
                session.action().clone({webPush: mockWebPush}),
                {
                    spaceId: space.id,
                    accountId: session.account.id,
                    browserId,
                    notificationContent: createTestNotificationContent(),
                },
            );
        } catch {
            // Expected to throw
        }

        const item = await NotificationsTable.getItemIfExists(session.action(), {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId: session.account.id,
            browserId,
        });

        expect(item?.subscription).toEqual(subscription);
    });

    test("sends notification when spaceId is not in optedOutSpaceIds but other spaces are", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);
        const session = await space1.createSession();
        const browserId = generateId<BrowserId>();
        const subscription = createTestWebPushSubscription(
            "https://push.cyberworlds.dev/endpoint7",
        );

        await NotificationsTable.createItem(session.action(), {
            ...getInitialWebPushSubscriptionItem(browserId, session.account.id, new Date()),
            subscription,
            optedOutSpaceIds: new Set([space2.id]),
        });

        const mockWebPush = new MockWebPushContextModule();
        mockWebPush.sendNotificationToBrowserMock.mockResolvedValue({
            statusCode: 200,
            body: "",
            headers: {},
        });

        await sendWebPushNotificationToSubscription(
            session.action().clone({webPush: mockWebPush}),
            {
                spaceId: space1.id,
                accountId: session.account.id,
                browserId,
                notificationContent: createTestNotificationContent(),
            },
        );

        expect(mockWebPush.sendNotificationToBrowserMock).toHaveBeenCalledTimes(1);
    });

    test("throws PermissionDeniedError when sessionactor does not have access to the space", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);
        const session1 = await space1.createSession();
        const session2 = await space2.createSession();
        const browserId = generateId<BrowserId>();
        const subscription = createTestWebPushSubscription(
            "https://push.cyberworlds.dev/endpoint8",
        );

        await NotificationsTable.createItem(session1.action(), {
            ...getInitialWebPushSubscriptionItem(browserId, session1.account.id, new Date()),
            subscription,
        });

        await expect(
            sendWebPushNotificationToSubscription(
                session2.action().clone({webPush: new TestWebPushContextModule()}),
                {
                    spaceId: space1.id,
                    accountId: session1.account.id,
                    browserId,
                    notificationContent: createTestNotificationContent(),
                },
            ),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("throws PermissionDeniedError when account is a bot account", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const botAccount = await TestBot.createAndInstantiate(session);
        const browserId = generateId<BrowserId>();
        const subscription = createTestWebPushSubscription(
            "https://push.cyberworlds.dev/endpoint9",
        );

        await NotificationsTable.createItem(session.action(), {
            ...getInitialWebPushSubscriptionItem(browserId, botAccount.id, new Date()),
            subscription,
        });

        await expect(
            sendWebPushNotificationToSubscription(
                session.action().clone({webPush: new TestWebPushContextModule()}),
                {
                    spaceId: space.id,
                    accountId: botAccount.id,
                    browserId,
                    notificationContent: createTestNotificationContent(),
                },
            ),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("allows impersonated account actor to send notification to subscription", async () => {
        const space1 = await TestSpace.create(context);
        const session1 = await space1.createSession();
        const browserId = generateId<BrowserId>();
        const subscription = createTestWebPushSubscription(
            "https://push.cyberworlds.dev/endpoint8",
        );

        await NotificationsTable.createItem(session1.action(), {
            ...getInitialWebPushSubscriptionItem(browserId, session1.account.id, new Date()),
            subscription,
        });

        await expect(
            sendWebPushNotificationToSubscription(
                context
                    .impersonatedAccountAction(space1.id, session1.account.id)
                    .clone({webPush: new TestWebPushContextModule()}),
                {
                    spaceId: space1.id,
                    accountId: session1.account.id,
                    browserId,
                    notificationContent: createTestNotificationContent(),
                },
            ),
        ).resolves.not.toThrow();
    });

    test("throws PermissionDeniedError when actor is impersonated and does not have access to the space", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);
        const session1 = await space1.createSession();
        const browserId = generateId<BrowserId>();
        const subscription = createTestWebPushSubscription(
            "https://push.cyberworlds.dev/endpoint8",
        );

        await NotificationsTable.createItem(session1.action(), {
            ...getInitialWebPushSubscriptionItem(browserId, session1.account.id, new Date()),
            subscription,
        });

        await expect(
            sendWebPushNotificationToSubscription(
                context
                    .impersonatedAccountAction(space2.id, session1.account.id)
                    .clone({webPush: new TestWebPushContextModule()}),
                {
                    spaceId: space1.id,
                    accountId: session1.account.id,
                    browserId,
                    notificationContent: createTestNotificationContent(),
                },
            ),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("allows system actor to send notification to subscription", async () => {
        const space1 = await TestSpace.create(context);
        const session1 = await space1.createSession();
        const browserId = generateId<BrowserId>();
        const subscription = createTestWebPushSubscription(
            "https://push.cyberworlds.dev/endpoint8",
        );

        await NotificationsTable.createItem(session1.action(), {
            ...getInitialWebPushSubscriptionItem(browserId, session1.account.id, new Date()),
            subscription,
        });

        await expect(
            sendWebPushNotificationToSubscription(
                space1.systemAction().clone({webPush: new TestWebPushContextModule()}),
                {
                    spaceId: space1.id,
                    accountId: session1.account.id,
                    browserId,
                    notificationContent: createTestNotificationContent(),
                },
            ),
        ).resolves.not.toThrow();
    });

    test("throws PermissionDeniedError if system actor is not in the space", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);
        const session1 = await space1.createSession();
        const browserId = generateId<BrowserId>();
        const subscription = createTestWebPushSubscription(
            "https://push.cyberworlds.dev/endpoint8",
        );

        await NotificationsTable.createItem(session1.action(), {
            ...getInitialWebPushSubscriptionItem(browserId, session1.account.id, new Date()),
            subscription,
        });

        await expect(
            sendWebPushNotificationToSubscription(
                space2.systemAction().clone({webPush: new TestWebPushContextModule()}),
                {
                    spaceId: space1.id,
                    accountId: session1.account.id,
                    browserId,
                    notificationContent: createTestNotificationContent(),
                },
            ),
        ).rejects.toThrow(PermissionDeniedError);
    });
});
