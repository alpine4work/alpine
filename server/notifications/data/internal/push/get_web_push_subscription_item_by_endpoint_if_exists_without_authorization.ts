import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {
    NotificationsTable,
    WebPushSubscriptionItem,
} from "~/server/notifications/data/internal/notifications_table.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {AccountId, BrowserId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Gets the `browserId` of a web push subscription for the provided `accountId` and
 * `endpoint` in an eventually consistent manner.
 *
 * Performs no authorization, you should use `getWebPushSubscription()` or ensure
 * you check authorization before calling this function.
 */
export async function getWebPushSubscriptionItemByEndpointIfExistsWithoutAuthorization(
    context: ServerActionContext,
    {accountId, endpoint}: {accountId: AccountId; endpoint: string},
    {consistency}: {consistency: "Strong" | "Eventual"} = {consistency: "Eventual"},
): Promise<WebPushSubscriptionItem | null> {
    const subscriptionItems = await arrayFromAsyncIterable(
        NotificationsTable.query(context, {
            partitionKey: {partitionType: "PushTargets", accountId},
            startSortKey: {
                sortRangeType: "WebPushSubscription",
                browserId: DynamoKeyAttributeSchema.id.getMinValue<BrowserId>(),
            },
            endSortKey: {
                sortRangeType: "WebPushSubscription",
                browserId: DynamoKeyAttributeSchema.id.getMaxValue<BrowserId>(),
            },
            limit: "All",
            consistency,
        }),
    );

    // We should only have one subscription item per endpoint, but if we're querying
    // with eventual consistency, there's a chance we'll get multiple items. We'll
    // return the newest subscription item by `lastUpdatedTime`.
    const subscriptionItemsByEndpoint = subscriptionItems.filter(
        item => item.subscription?.endpoint === endpoint,
    );

    const newestSubscriptionItem = subscriptionItemsByEndpoint.toSorted(
        (a, b) => b.lastUpdatedTime.getTime() - a.lastUpdatedTime.getTime(),
    )[0];

    return newestSubscriptionItem ?? null;
}
