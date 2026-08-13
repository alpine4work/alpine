import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {NotificationsTable} from "~/server/notifications/data/internal/notifications_table.js";
import {getAllPushNotificationTargetsWithoutAuthorization} from "~/server/notifications/data/internal/push/get_all_push_notification_targets_without_authorization.js";
import {getInitialWebPushSubscriptionItem} from "~/server/notifications/data/internal/push/get_initial_web_push_subscription_item.js";
import {createTestWebPushSubscription} from "~/server/notifications/data/push/test_helpers/create_test_web_push_subscription.js";
import {addSpaceAccountForTest} from "~/server/spaces/create_space_for_test.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {BrowserId} from "~/shared/id/types/id_types.js";

const context = createTestContext();

/**
 * Returns two spaces whose ids satisfy `spaceEarlier.id < spaceLater.id` so a
 * `PushTargets` query starting at `SlackIntegration` for `spaceEarlier` still
 * includes `SlackIntegration` rows for `spaceLater` in the DynamoDB key range.
 */
async function createTwoSpacesOrderedById() {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);
    return space1.id < space2.id
        ? {spaceEarlier: space1, spaceLater: space2}
        : {spaceEarlier: space2, spaceLater: space1};
}

describe("getAllPushNotificationTargetsWithoutAuthorization", () => {
    test("returns SlackIntegration targets only for the requested spaceId", async () => {
        const {spaceEarlier, spaceLater} = await createTwoSpacesOrderedById();
        const session = await spaceEarlier.createSession();
        await addSpaceAccountForTest(context, {
            spaceId: spaceLater.id,
            accountId: session.account.id,
            role: "Member",
        });

        const slackTime = new Date();
        await NotificationsTable.createItem(session.action(), {
            partitionType: "PushTargets",
            sortRangeType: "SlackIntegration",
            accountId: session.account.id,
            spaceId: spaceEarlier.id,
            workspaceId: "T00WORKSPACEEARLIER",
            slackUserId: "U00SLACKEARLIER",
            createdTime: slackTime,
            lastUpdatedTime: slackTime,
        });
        await NotificationsTable.createItem(session.action(), {
            partitionType: "PushTargets",
            sortRangeType: "SlackIntegration",
            accountId: session.account.id,
            spaceId: spaceLater.id,
            workspaceId: "T00WORKSPACELATER",
            slackUserId: "U00SLACKLATER",
            createdTime: slackTime,
            lastUpdatedTime: slackTime,
        });

        const targets = await arrayFromAsyncIterable(
            getAllPushNotificationTargetsWithoutAuthorization(session.action(), {
                accountId: session.account.id,
                spaceId: spaceEarlier.id,
            }),
        );

        expect(targets).toMatchObject([
            {
                type: "SlackIntegration",
                spaceId: spaceEarlier.id,
                slackUserId: "U00SLACKEARLIER",
                workspaceId: "T00WORKSPACEEARLIER",
            },
        ]);
    });

    test("does not return SlackIntegration for another space when that space id sorts after the requested space id", async () => {
        const {spaceEarlier, spaceLater} = await createTwoSpacesOrderedById();
        const session = await spaceEarlier.createSession();
        await addSpaceAccountForTest(context, {
            spaceId: spaceLater.id,
            accountId: session.account.id,
            role: "Member",
        });

        const slackTime = new Date();
        await NotificationsTable.createItem(session.action(), {
            partitionType: "PushTargets",
            sortRangeType: "SlackIntegration",
            accountId: session.account.id,
            spaceId: spaceLater.id,
            workspaceId: "T00WORKSPACEONLYLATER",
            slackUserId: "U00SLACKONLYLATER",
            createdTime: slackTime,
            lastUpdatedTime: slackTime,
        });

        const targets = await arrayFromAsyncIterable(
            getAllPushNotificationTargetsWithoutAuthorization(session.action(), {
                accountId: session.account.id,
                spaceId: spaceEarlier.id,
            }),
        );

        expect(targets.filter(t => t.type === "SlackIntegration")).toEqual([]);
    });

    test("returns WebPushSubscription when subscribed and not opted out for the space", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();
        const subscription = createTestWebPushSubscription(
            "https://push.cyberworlds.dev/get-all-targets-endpoint",
        );
        const currentTime = new Date();

        await NotificationsTable.createItem(session.action(), {
            ...getInitialWebPushSubscriptionItem(browserId, session.account.id, currentTime),
            subscription,
        });

        const targets = await arrayFromAsyncIterable(
            getAllPushNotificationTargetsWithoutAuthorization(session.action(), {
                accountId: session.account.id,
                spaceId: space.id,
            }),
        );

        expect(targets).toMatchObject([
            {
                type: "WebPushSubscription",
                browserId,
                subscription,
            },
        ]);
    });

    test("omits WebPushSubscription when subscription is null", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();
        const currentTime = new Date();

        await NotificationsTable.createItem(session.action(), {
            ...getInitialWebPushSubscriptionItem(browserId, session.account.id, currentTime),
        });

        const targets = await arrayFromAsyncIterable(
            getAllPushNotificationTargetsWithoutAuthorization(session.action(), {
                accountId: session.account.id,
                spaceId: space.id,
            }),
        );

        expect(targets.filter(t => t.type === "WebPushSubscription")).toEqual([]);
    });

    test("omits WebPushSubscription when opted out of the requested space", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();
        const subscription = createTestWebPushSubscription(
            "https://push.cyberworlds.dev/get-all-targets-opted-out",
        );
        const currentTime = new Date();

        await NotificationsTable.createItem(session.action(), {
            ...getInitialWebPushSubscriptionItem(browserId, session.account.id, currentTime),
            subscription,
            optedOutSpaceIds: new Set([space.id]),
        });

        const targets = await arrayFromAsyncIterable(
            getAllPushNotificationTargetsWithoutAuthorization(session.action(), {
                accountId: session.account.id,
                spaceId: space.id,
            }),
        );

        expect(targets.filter(t => t.type === "WebPushSubscription")).toEqual([]);
    });
});
