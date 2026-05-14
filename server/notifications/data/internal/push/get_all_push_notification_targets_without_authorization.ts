import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {NotificationsTable} from "~/server/notifications/data/internal/notifications_table.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {filterMapAsyncIterableIterator} from "~/shared/helpers/iterable/filter_map_async_iterable_iterator.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {PushNotificationTarget} from "~/shared/notifications/push_notification_target.js";

/**
 * Get all push notification targets for the provided `accountId` and `spaceId`,
 * filtering out any targets that are opted out for the provided `spaceId`.
 */
export function getAllPushNotificationTargetsWithoutAuthorization(
    context: ServerActionContext,
    {accountId, spaceId}: {accountId: AccountId; spaceId: SpaceId},
    {consistency, limit}: {consistency: "Strong" | "Eventual"; limit: number | "All"} = {
        consistency: "Eventual",
        limit: "All",
    },
): AsyncIterableIterator<PushNotificationTarget> {
    return filterMapAsyncIterableIterator(
        NotificationsTable.query(context, {
            partitionKey: {partitionType: "PushTargets", accountId},
            startSortKey: {
                sortRangeType: "SlackIntegration",
                spaceId,
                workspaceId: DynamoKeyAttributeSchema.labelString<string>().minValue,
            },
            endSortKey: {
                sortRangeType: "AppleDeviceToken",
                deviceToken: DynamoKeyAttributeSchema.bytes(32).maxValue,
            },
            limit: limit,
            consistency,
        }),
        item => {
            switch (item.sortRangeType) {
                case "SlackIntegration":
                    if (item.spaceId !== spaceId) return null;
                    return {
                        type: "SlackIntegration",
                        spaceId: item.spaceId,
                        slackUserId: item.slackUserId,
                        workspaceId: item.workspaceId,
                    };
                case "WebPushSubscription":
                    if (item.subscription === null || item.optedOutSpaceIds.has(spaceId))
                        return null;
                    return {
                        type: "WebPushSubscription",
                        browserId: item.browserId,
                        subscription: item.subscription,
                        optedOutSpaceIds: item.optedOutSpaceIds,
                    };
                case "AppleDeviceToken":
                    return {
                        type: "AppleDevice",
                        deviceToken: item.deviceToken,
                    };
                default:
                    throw exhaustive(item);
            }
        },
    );
}
