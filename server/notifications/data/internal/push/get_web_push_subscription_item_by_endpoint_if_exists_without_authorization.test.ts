import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {NotificationsTable} from "~/server/notifications/data/internal/notifications_table.js";
import {getInitialWebPushSubscriptionItem} from "~/server/notifications/data/internal/push/get_initial_web_push_subscription_item.js";
import {getWebPushSubscriptionItemByEndpointIfExistsWithoutAuthorization} from "~/server/notifications/data/internal/push/get_web_push_subscription_item_by_endpoint_if_exists_without_authorization.js";
import {createTestWebPushSubscription} from "~/server/notifications/data/push/test_helpers/create_test_web_push_subscription.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {BrowserId} from "~/shared/id/types/id_types.js";

import.meta.jest.useFakeTimers();

const context = createTestContext();

describe("getWebPushSubscriptionItemByEndpointIfExistsWithoutAuthorization", () => {
    test("returns null when no subscription items exist for the account", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const result = await getWebPushSubscriptionItemByEndpointIfExistsWithoutAuthorization(
            session.action(),
            {
                accountId: session.account.id,
                endpoint: "https://push.cyberworlds.dev/nonexistent",
            },
        );

        expect(result).toBeNull();
    });

    test("returns null when subscription items exist but none match the endpoint", async () => {
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

        const result = await getWebPushSubscriptionItemByEndpointIfExistsWithoutAuthorization(
            session.action(),
            {
                accountId: session.account.id,
                endpoint: "https://push.cyberworlds.dev/different-endpoint",
            },
        );

        expect(result).toBeNull();
    });

    test("returns the subscription item when it matches the endpoint", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();
        const endpoint = "https://push.cyberworlds.dev/endpoint2";
        const subscription = createTestWebPushSubscription(endpoint);

        await NotificationsTable.createItem(session.action(), {
            ...getInitialWebPushSubscriptionItem(browserId, session.account.id, new Date()),
            subscription,
        });

        const result = await getWebPushSubscriptionItemByEndpointIfExistsWithoutAuthorization(
            session.action(),
            {
                accountId: session.account.id,
                endpoint,
            },
        );

        expect(result).not.toBeNull();
        expect(result?.subscription?.endpoint).toBe(endpoint);
    });

    test("returns null when subscription items exist but have null subscription", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();

        await NotificationsTable.createItem(session.action(), {
            ...getInitialWebPushSubscriptionItem(browserId, session.account.id, new Date()),
            subscription: null,
        });

        const result = await getWebPushSubscriptionItemByEndpointIfExistsWithoutAuthorization(
            session.action(),
            {
                accountId: session.account.id,
                endpoint: "https://push.cyberworlds.dev/any-endpoint",
            },
        );

        expect(result).toBeNull();
    });

    test("returns the newest subscription item when multiple items have the same endpoint", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId1 = generateId<BrowserId>();
        const browserId2 = generateId<BrowserId>();
        const endpoint = "https://push.cyberworlds.dev/shared-endpoint";
        const subscription = createTestWebPushSubscription(endpoint);

        const olderTime = new Date();
        await NotificationsTable.createItem(session.action(), {
            ...getInitialWebPushSubscriptionItem(browserId1, session.account.id, olderTime),
            subscription,
            lastUpdatedTime: olderTime,
        });

        import.meta.jest.advanceTimersByTime(1000);

        const newerTime = new Date();
        await NotificationsTable.createItem(session.action(), {
            ...getInitialWebPushSubscriptionItem(browserId2, session.account.id, newerTime),
            subscription,
            lastUpdatedTime: newerTime,
        });

        const result = await getWebPushSubscriptionItemByEndpointIfExistsWithoutAuthorization(
            session.action(),
            {
                accountId: session.account.id,
                endpoint,
            },
        );

        expect(result?.browserId).toBe(browserId2);
        expect(result?.lastUpdatedTime.getTime()).toBe(newerTime.getTime());
    });

    test("filters by endpoint and returns only matching items", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId1 = generateId<BrowserId>();
        const browserId2 = generateId<BrowserId>();
        const endpoint1 = "https://push.cyberworlds.dev/endpoint-a";
        const endpoint2 = "https://push.cyberworlds.dev/endpoint-b";
        const subscription1 = createTestWebPushSubscription(endpoint1);
        const subscription2 = createTestWebPushSubscription(endpoint2);

        await NotificationsTable.createItem(session.action(), {
            ...getInitialWebPushSubscriptionItem(browserId1, session.account.id, new Date()),
            subscription: subscription1,
        });

        await NotificationsTable.createItem(session.action(), {
            ...getInitialWebPushSubscriptionItem(browserId2, session.account.id, new Date()),
            subscription: subscription2,
        });

        const result = await getWebPushSubscriptionItemByEndpointIfExistsWithoutAuthorization(
            session.action(),
            {
                accountId: session.account.id,
                endpoint: endpoint1,
            },
        );

        expect(result?.browserId).toBe(browserId1);
        expect(result?.subscription?.endpoint).toBe(endpoint1);
    });

    test("does not return subscription items from other accounts", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();
        const browserId = generateId<BrowserId>();
        const endpoint = "https://push.cyberworlds.dev/endpoint4";
        const subscription = createTestWebPushSubscription(endpoint);

        await NotificationsTable.createItem(session1.action(), {
            ...getInitialWebPushSubscriptionItem(browserId, session1.account.id, new Date()),
            subscription,
        });

        const result = await getWebPushSubscriptionItemByEndpointIfExistsWithoutAuthorization(
            session2.action(),
            {
                accountId: session2.account.id,
                endpoint,
            },
        );

        expect(result).toBeNull();
    });
});
