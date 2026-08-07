import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {
    AppleDeviceTokenItem,
    NotificationsTable,
} from "~/server/notifications/data/internal/notifications_table.js";
import {Context} from "~/shared/context/context.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {AppleDeviceTarget} from "~/shared/notifications/push_notification_target.js";

/**
 * Get all devices registered for the provided `AccountId`. System actors can see
 * the registered devices for any account since we need to send push notifications
 * to the account's devices as the system actor.
 *
 * You should use `getRegisteredAppleDevicesForAccount()` since it authorizes that
 * the actor is allowed to read the account's registered devices.
 */
export async function getRegisteredAppleDevicesForAccountWithoutAuthorization(
    context: Context<DynamoContextModules & {actor: ActorContextModule}>,
    accountId: AccountId,
): Promise<ReadonlyArray<AppleDeviceTarget>> {
    return await arrayFromAsyncIterable<AppleDeviceTokenItem, AppleDeviceTarget>(
        NotificationsTable.query(context, {
            partitionKey: {partitionType: "PushTargets", accountId},
            startSortKey: {
                sortRangeType: "AppleDeviceToken",
                deviceToken: DynamoKeyAttributeSchema.bytes(32).minValue,
            },
            endSortKey: {
                sortRangeType: "AppleDeviceToken",
                deviceToken: DynamoKeyAttributeSchema.bytes(32).maxValue,
            },
            limit: "All",
        }),
        item => {
            return {
                type: "AppleDevice",
                deviceToken: item.deviceToken,
            };
        },
    );
}
