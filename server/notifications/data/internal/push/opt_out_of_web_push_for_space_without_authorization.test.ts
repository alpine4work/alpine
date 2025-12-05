import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {NotificationsTable} from "~/server/notifications/data/internal/notifications_table.js";
import {getInitialWebPushSubscriptionItem} from "~/server/notifications/data/internal/push/get_initial_web_push_subscription_item.js";
import {optOutOfWebPushForSpaceWithoutAuthorization} from "~/server/notifications/data/internal/push/opt_out_of_web_push_for_space_without_authorization.js";
import {createTestWebPushSubscription} from "~/server/notifications/data/push/test_helpers/create_test_web_push_subscription.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {generateId} from "~/shared/id/id.js";
import {BrowserId} from "~/shared/id/types/id_types.js";

const context = createTestContext();

describe("optOutOfWebPushForSpaceWithoutAuthorization", () => {
    test("creates new subscription item with spaceId in optedOutSpaceIds when no item exists", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();

        await optOutOfWebPushForSpaceWithoutAuthorization(session.action(), {
            accountId: session.account.id,
            browserId,
            spaceId: space.id,
        });

        const item = await NotificationsTable.getItemIfExists(session.action(), {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId: session.account.id,
            browserId,
        });

        expect(item).not.toBeNull();
    });

    test("new subscription item has null subscription when created via opt-out", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();

        await optOutOfWebPushForSpaceWithoutAuthorization(session.action(), {
            accountId: session.account.id,
            browserId,
            spaceId: space.id,
        });

        const item = await NotificationsTable.getItemIfExists(session.action(), {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId: session.account.id,
            browserId,
        });

        expect(item?.subscription).toBeNull();
    });

    test("new subscription item contains the opted-out spaceId", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();

        await optOutOfWebPushForSpaceWithoutAuthorization(session.action(), {
            accountId: session.account.id,
            browserId,
            spaceId: space.id,
        });

        const item = await NotificationsTable.getItemIfExists(session.action(), {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId: session.account.id,
            browserId,
        });

        expect(item?.optedOutSpaceIds.has(space.id)).toBe(true);
    });

    test("adds spaceId to optedOutSpaceIds on existing subscription item", async () => {
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

        await optOutOfWebPushForSpaceWithoutAuthorization(session.action(), {
            accountId: session.account.id,
            browserId,
            spaceId: space.id,
        });

        const item = await NotificationsTable.getItemIfExists(session.action(), {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId: session.account.id,
            browserId,
        });

        expect(item?.optedOutSpaceIds.has(space.id)).toBe(true);
    });

    test("preserves existing subscription when opting out", async () => {
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

        await optOutOfWebPushForSpaceWithoutAuthorization(session.action(), {
            accountId: session.account.id,
            browserId,
            spaceId: space.id,
        });

        const item = await NotificationsTable.getItemIfExists(session.action(), {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId: session.account.id,
            browserId,
        });

        expect(item?.subscription).toEqual(subscription);
    });

    test("preserves existing optedOutSpaceIds when adding new spaceId", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);
        const session = await space1.createSession();
        const browserId = generateId<BrowserId>();

        await NotificationsTable.createItem(session.action(), {
            ...getInitialWebPushSubscriptionItem(browserId, session.account.id, new Date()),
            optedOutSpaceIds: new Set([space1.id]),
        });

        await optOutOfWebPushForSpaceWithoutAuthorization(session.action(), {
            accountId: session.account.id,
            browserId,
            spaceId: space2.id,
        });

        const item = await NotificationsTable.getItemIfExists(session.action(), {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId: session.account.id,
            browserId,
        });

        expect(item?.optedOutSpaceIds.has(space1.id)).toBe(true);
    });

    test("is idempotent when opting out of the same space twice", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();

        const currentTime = new Date();

        await NotificationsTable.createItem(session.action(), {
            ...getInitialWebPushSubscriptionItem(browserId, session.account.id, currentTime),
            optedOutSpaceIds: new Set([space.id]),
        });

        await optOutOfWebPushForSpaceWithoutAuthorization(session.action(), {
            accountId: session.account.id,
            browserId,
            spaceId: space.id,
        });

        const item = await NotificationsTable.getItemIfExists(session.action(), {
            partitionType: "PushTargets",
            sortRangeType: "WebPushSubscription",
            accountId: session.account.id,
            browserId,
        });

        expect(item?.optedOutSpaceIds.size).toBe(1);
        expect(item?.lastUpdatedTime.getTime()).toBe(currentTime.getTime());
    });
});
