import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {
    NotificationsTable,
    WebPushSubscriptionItem,
} from "~/server/notifications/data/internal/notifications_table.js";
import {getInitialWebPushSubscriptionItem} from "~/server/notifications/data/internal/push/get_initial_web_push_subscription_item.js";
import {getWebPushSubscriptionItemByEndpointIfExistsWithoutAuthorization} from "~/server/notifications/data/internal/push/get_web_push_subscription_item_by_endpoint_if_exists_without_authorization.js";
import {getWebPushSubscriptionItemIfExistsWithoutAuthorization} from "~/server/notifications/data/internal/push/get_web_push_subscription_item_if_exists_without_authorization.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {AccountId, BrowserId, SpaceId} from "~/shared/id/types/id_types.js";
import {WebPushSubscription} from "~/shared/notifications/web_push_subscription.js";

/**
 * Create or update a web push subscription for an account and `browserId` pair.
 * Optionally accepts a `spaceIdToOptIn` to remove a space from an existing
 * subscription's `optedOutSpaceIds` set. This is useful for updating a
 * subscription and opting back in to a space at the same time. If a space has not
 * been opted out of previously, it is not necessary to opt in as all spaces begin
 * opted in by default.
 *
 * Performs no authorization, you should use
 * `createOrUpdateAccountWebPushSubscription()` or ensure you check authorization
 * before calling this function.
 */
export async function createOrUpdateAccountWebPushSubscriptionWithoutAuthorization(
    context: ServerActionContext,
    {
        accountId,
        browserId,
        subscription,
        spaceIdToOptIn,
    }: {
        accountId: AccountId;
        browserId: BrowserId;
        subscription: WebPushSubscription | null;
        spaceIdToOptIn?: SpaceId;
    },
): Promise<void> {
    return context.dynamo.retryTransaction(async context => {
        const transactionEntries: Array<DynamoTransactionEntry> = [];
        const currentTime = new Date();

        let existingSubscriptionItem: WebPushSubscriptionItem | null = null;

        existingSubscriptionItem = await getWebPushSubscriptionItemIfExistsWithoutAuthorization(
            context,
            {accountId, browserId},
            {consistency: "Strong"},
        );
        // Optimization: skip updating if the subscription is the same and we're not opted
        // out of notifications for the space we're opting in to.
        if (
            existingSubscriptionItem &&
            isDeepEqual(existingSubscriptionItem.subscription, subscription) &&
            // Check if we're opted out of the space we're opting in to.
            (!spaceIdToOptIn || !existingSubscriptionItem.optedOutSpaceIds.has(spaceIdToOptIn))
        ) {
            return;
        }

        // If this is a new subscription for this browserId, check if a different browserId
        // has already registered this endpoint. If the endpoint is already registered, it
        // means this is the same browser but the `browserId` changed, so we should carry
        // over the existing opt-out state and remove the old subscription.
        if (!existingSubscriptionItem && subscription?.endpoint) {
            const staleSubscriptionItem =
                await getWebPushSubscriptionItemByEndpointIfExistsWithoutAuthorization(
                    context,
                    {
                        accountId,
                        endpoint: subscription.endpoint,
                    },
                    {consistency: "Strong"},
                );

            if (staleSubscriptionItem) {
                existingSubscriptionItem = {
                    ...getInitialWebPushSubscriptionItem(browserId, accountId, currentTime),
                    optedOutSpaceIds: staleSubscriptionItem.optedOutSpaceIds,
                };
                // Put this delete in a transaction to run atomically with the update so we don't
                // delete a potentially valid subscription if the update fails. Doing so might
                // cause the user to miss notifications.
                transactionEntries.push(
                    NotificationsTable.transactionDeleteItemIfExists(staleSubscriptionItem),
                );
            }
        }

        const newSubscriptionItem =
            existingSubscriptionItem ??
            getInitialWebPushSubscriptionItem(browserId, accountId, currentTime);

        transactionEntries.push(
            NotificationsTable.transactionDirectlyUpdateItem({
                ...newSubscriptionItem,
                subscription,
                lastUpdatedTime: currentTime,
                optedOutSpaceIds: spaceIdToOptIn
                    ? new Set(
                          [...newSubscriptionItem.optedOutSpaceIds].filter(
                              spaceId => spaceId !== spaceIdToOptIn,
                          ),
                      )
                    : newSubscriptionItem.optedOutSpaceIds,
            }),
        );

        await DynamoTableSchema.executeTransaction(context, transactionEntries);
    });
}
