import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {NotificationsTable} from "~/server/notifications/data/internal/notifications_table.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {AccountId, BrowserId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Get all web push subscription items registered for the provided `AccountId`
 * across all registered browsers.
 */
export function getWebPushSubscriptionItemsWithoutAuthorization(
    context: ServerActionContext,
    {accountId}: {accountId: AccountId},
    {consistency}: {consistency: "Strong" | "Eventual"} = {consistency: "Eventual"},
) {
    return arrayFromAsyncIterable(
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
}
