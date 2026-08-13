import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {NotificationsTable} from "~/server/notifications/data/internal/notifications_table.js";
import {createOrUpdateAccountWebPushSubscriptionWithoutAuthorization} from "~/server/notifications/data/internal/push/create_or_update_web_push_subscription_without_authorization.js";
import {createTestWebPushSubscription} from "~/server/notifications/data/push/test_helpers/create_test_web_push_subscription.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {BrowserId} from "~/shared/id/types/id_types.js";

import.meta.jest.useFakeTimers();

const context = createTestContext();

describe("createOrUpdateAccountWebPushSubscriptionWithoutAuthorization", () => {
    test("creates a new web push subscription item when none exists", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();
        const subscription = createTestWebPushSubscription(
            "https://push.cyberworlds.dev/endpoint1",
        );

        await createOrUpdateAccountWebPushSubscriptionWithoutAuthorization(session.action(), {
            accountId: session.account.id,
            browserId,
            subscription,
        });

        const item = await NotificationsTable.getItemIfExists(session.action(), {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId: session.account.id,
            browserId,
        });

        expect(item).not.toBeNull();
        expect(item?.subscription).toEqual(subscription);
    });

    test("creates a new subscription item with empty optedOutSpaceIds", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();
        const subscription = createTestWebPushSubscription(
            "https://push.cyberworlds.dev/endpoint2",
        );

        await createOrUpdateAccountWebPushSubscriptionWithoutAuthorization(session.action(), {
            accountId: session.account.id,
            browserId,
            subscription,
        });

        const item = await NotificationsTable.getItemIfExists(session.action(), {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId: session.account.id,
            browserId,
        });

        expect(item?.optedOutSpaceIds.size).toBe(0);
    });

    test("updates an existing subscription item with a null subscription", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();
        const subscription = createTestWebPushSubscription(
            "https://push.cyberworlds.dev/endpoint5",
        );

        await createOrUpdateAccountWebPushSubscriptionWithoutAuthorization(session.action(), {
            accountId: session.account.id,
            browserId,
            subscription,
        });

        await createOrUpdateAccountWebPushSubscriptionWithoutAuthorization(session.action(), {
            accountId: session.account.id,
            browserId,
            subscription: null,
        });

        const item = await NotificationsTable.getItemIfExists(session.action(), {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId: session.account.id,
            browserId,
        });

        expect(item?.subscription).toBeNull();
    });

    test("updates an existing subscription item with a new subscription", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();
        const subscription1 = createTestWebPushSubscription(
            "https://push.cyberworlds.dev/endpoint6",
        );
        const subscription2 = createTestWebPushSubscription(
            "https://push.cyberworlds.dev/endpoint7",
        );

        await createOrUpdateAccountWebPushSubscriptionWithoutAuthorization(session.action(), {
            accountId: session.account.id,
            browserId,
            subscription: subscription1,
        });

        await createOrUpdateAccountWebPushSubscriptionWithoutAuthorization(session.action(), {
            accountId: session.account.id,
            browserId,
            subscription: subscription2,
        });

        const item = await NotificationsTable.getItemIfExists(session.action(), {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId: session.account.id,
            browserId,
        });

        expect(item?.subscription).toEqual(subscription2);
    });

    test("updates lastUpdatedTime when subscription changes", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();
        const subscription1 = createTestWebPushSubscription(
            "https://push.cyberworlds.dev/endpoint8",
        );
        const subscription2 = createTestWebPushSubscription(
            "https://push.cyberworlds.dev/endpoint9",
        );

        await createOrUpdateAccountWebPushSubscriptionWithoutAuthorization(session.action(), {
            accountId: session.account.id,
            browserId,
            subscription: subscription1,
        });

        const itemBefore = await NotificationsTable.getItemIfExists(session.action(), {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId: session.account.id,
            browserId,
        });

        import.meta.jest.advanceTimersByTime(1000);

        await createOrUpdateAccountWebPushSubscriptionWithoutAuthorization(session.action(), {
            accountId: session.account.id,
            browserId,
            subscription: subscription2,
        });

        const itemAfter = await NotificationsTable.getItemIfExists(session.action(), {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId: session.account.id,
            browserId,
        });

        expect(itemAfter!.lastUpdatedTime.getTime()).toBeGreaterThan(
            itemBefore!.lastUpdatedTime.getTime(),
        );
    });

    test("opts in to the passed-in spaceId when previously opted out", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();
        const subscription = createTestWebPushSubscription(
            "https://push.cyberworlds.dev/endpoint10",
        );

        await createOrUpdateAccountWebPushSubscriptionWithoutAuthorization(session.action(), {
            accountId: session.account.id,
            browserId,
            subscription,
        });

        await NotificationsTable.updateItem(
            session.action(),
            {
                partitionType: "PushTargets",
                sortRangeType: "WebPushSubscription",
                accountId: session.account.id,
                browserId,
            },
            item => ({
                ...item!,
                optedOutSpaceIds: new Set([space.id]),
            }),
        );

        // Verify the space is in optedOutSpaceIds
        const itemWithOptOut = await NotificationsTable.getItemIfExists(session.action(), {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId: session.account.id,
            browserId,
        });
        expect(itemWithOptOut?.optedOutSpaceIds.has(space.id)).toBe(true);

        await createOrUpdateAccountWebPushSubscriptionWithoutAuthorization(session.action(), {
            accountId: session.account.id,
            browserId,
            spaceIdToOptIn: space.id,
            subscription,
        });

        const itemAfter = await NotificationsTable.getItemIfExists(session.action(), {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId: session.account.id,
            browserId,
        });

        expect(itemAfter?.optedOutSpaceIds.has(space.id)).toBe(false);
    });

    test("preserves other opted-out spaceIds when opting in to one spaceId", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);
        const session = await space1.createSession();
        const browserId = generateId<BrowserId>();
        const subscription = createTestWebPushSubscription(
            "https://push.cyberworlds.dev/endpoint11",
        );

        // Create initial subscription
        await createOrUpdateAccountWebPushSubscriptionWithoutAuthorization(session.action(), {
            accountId: session.account.id,
            browserId,
            subscription,
        });

        // Manually add both spaces to optedOutSpaceIds
        await NotificationsTable.updateItem(
            session.action(),
            {
                partitionType: "PushTargets",
                sortRangeType: "WebPushSubscription",
                accountId: session.account.id,
                browserId,
            },
            item => ({
                ...item!,
                optedOutSpaceIds: new Set([space1.id, space2.id]),
            }),
        );

        // Call the function with space1 - should opt in to space1 but keep space2 opted
        // out
        await createOrUpdateAccountWebPushSubscriptionWithoutAuthorization(session.action(), {
            accountId: session.account.id,
            browserId,
            spaceIdToOptIn: space1.id,
            subscription,
        });

        const itemAfter = await NotificationsTable.getItemIfExists(session.action(), {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId: session.account.id,
            browserId,
        });

        expect(itemAfter?.optedOutSpaceIds.has(space1.id)).toBe(false);
        expect(itemAfter?.optedOutSpaceIds.has(space2.id)).toBe(true);
    });

    test("skips update when subscription is the same and not opted out of spaceId", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();
        const subscription = createTestWebPushSubscription(
            "https://push.cyberworlds.dev/endpoint12",
        );

        await createOrUpdateAccountWebPushSubscriptionWithoutAuthorization(session.action(), {
            accountId: session.account.id,
            browserId,
            subscription,
        });

        const itemBefore = await NotificationsTable.getItemIfExists(session.action(), {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId: session.account.id,
            browserId,
        });

        // Wait a tiny bit to ensure time would be different if update happened
        import.meta.jest.advanceTimersByTime(1000);

        await createOrUpdateAccountWebPushSubscriptionWithoutAuthorization(session.action(), {
            accountId: session.account.id,
            browserId,
            subscription,
        });

        const itemAfter = await NotificationsTable.getItemIfExists(session.action(), {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId: session.account.id,
            browserId,
        });

        // lastUpdatedTime should be the same since no update was needed
        expect(itemAfter!.lastUpdatedTime.getTime()).toBe(itemBefore!.lastUpdatedTime.getTime());
    });

    test("does not skip update when subscription is the same but is opted out of the passed-in spaceId", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();
        const subscription = createTestWebPushSubscription(
            "https://push.cyberworlds.dev/endpoint13",
        );

        await createOrUpdateAccountWebPushSubscriptionWithoutAuthorization(session.action(), {
            accountId: session.account.id,
            browserId,
            subscription,
        });

        await NotificationsTable.updateItem(
            session.action(),
            {
                partitionType: "PushTargets",
                sortRangeType: "WebPushSubscription",
                accountId: session.account.id,
                browserId,
            },
            item => ({
                ...item!,
                optedOutSpaceIds: new Set([space.id]),
            }),
        );

        const itemBefore = await NotificationsTable.getItemIfExists(session.action(), {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId: session.account.id,
            browserId,
        });

        // Wait a tiny bit to ensure time difference
        import.meta.jest.advanceTimersByTime(1000);

        // Call again with same subscription but opted out - should update to opt back in
        await createOrUpdateAccountWebPushSubscriptionWithoutAuthorization(session.action(), {
            accountId: session.account.id,
            browserId,
            subscription,
            spaceIdToOptIn: space.id,
        });

        const itemAfter = await NotificationsTable.getItemIfExists(session.action(), {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId: session.account.id,
            browserId,
        });

        // lastUpdatedTime should be different since update was needed to opt back in
        expect(itemAfter!.lastUpdatedTime.getTime()).toBeGreaterThan(
            itemBefore!.lastUpdatedTime.getTime(),
        );
    });

    test("previously created subscription is not deleted when a new subscription with different browserId and null endpoint is created", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const oldBrowserId = generateId<BrowserId>();
        const newBrowserId = generateId<BrowserId>();
        const endpoint = "https://push.cyberworlds.dev/endpoint19";
        const subscription = createTestWebPushSubscription(endpoint);

        await createOrUpdateAccountWebPushSubscriptionWithoutAuthorization(session.action(), {
            accountId: session.account.id,
            browserId: oldBrowserId,
            subscription,
        });

        await createOrUpdateAccountWebPushSubscriptionWithoutAuthorization(session.action(), {
            accountId: session.account.id,
            browserId: newBrowserId,
            subscription: null,
        });

        const oldItem = await NotificationsTable.getItemIfExists(session.action(), {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId: session.account.id,
            browserId: oldBrowserId,
        });

        expect(oldItem).not.toBeNull();
    });

    test("previously created subscription is deleted when a new subscription with different browserId and same endpoint is created", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const oldBrowserId = generateId<BrowserId>();
        const newBrowserId = generateId<BrowserId>();
        const endpoint = "https://push.cyberworlds.dev/endpoint19";
        const subscription = createTestWebPushSubscription(endpoint);

        await createOrUpdateAccountWebPushSubscriptionWithoutAuthorization(session.action(), {
            accountId: session.account.id,
            browserId: oldBrowserId,
            subscription,
        });

        const oldItemBefore = await NotificationsTable.getItemIfExists(session.action(), {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId: session.account.id,
            browserId: oldBrowserId,
        });

        expect(oldItemBefore).not.toBeNull();

        await createOrUpdateAccountWebPushSubscriptionWithoutAuthorization(session.action(), {
            accountId: session.account.id,
            browserId: newBrowserId,
            subscription,
        });

        const oldItemAfter = await NotificationsTable.getItemIfExists(session.action(), {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId: session.account.id,
            browserId: oldBrowserId,
        });

        expect(oldItemAfter).toBeNull();
    });
});
