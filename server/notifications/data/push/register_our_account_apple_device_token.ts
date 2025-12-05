import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {SessionActorContextModule} from "~/server/helpers/actor_context_module.js";
import {NotificationsTable} from "~/server/notifications/data/internal/notifications_table.js";
import {Context} from "~/shared/context/context.js";

/**
 * Save a 32-byte Apple device token for the acting account.
 *
 * If the device token was already registered with a different account then
 * this will override the `AccountId` associated with the device token. This is
 * acceptable since device tokens are unguessable. If a device wants to change
 * its `AccountId` (since the user signed out then back in) it may do so.
 */
export async function registerOurAccountAppleDeviceToken(
    context: Context<DynamoContextModules & {actor: SessionActorContextModule}>,
    deviceToken: Uint8Array,
): Promise<void> {
    context.actor.authorizeSession();
    // This method is called every time our iOS app is opened in case the device
    // token has changed. So it's ok to replace the existing item.
    await NotificationsTable.createOrReplaceItem(context, {
        partitionType: "PushTargets",
        sortRangeType: "AppleDeviceToken",
        accountId: context.actor.getAccountId(),
        deviceToken,
    });
}
