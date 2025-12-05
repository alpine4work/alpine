import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {permissionDeniedBotError} from "~/server/helpers/permission_denied_bot_error.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {NotificationsTable} from "~/server/notifications/data/internal/notifications_table.js";
import {Context} from "~/shared/context/context.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId} from "~/shared/id/types/id_types.js";

/**
 * Delete a device token associated with the provided `AccountId`. System
 * actors can delete the device token for any account whereas session actors
 * may only delete device tokens for their own account.
 *
 * If the provided device token doesn't exist (or was already deleted) this
 * function does nothing.
 */
export async function deleteAccountAppleDeviceTokenIfExists(
    context: Context<DynamoContextModules & {actor: ActorContextModule}>,
    {accountId, deviceToken}: {accountId: AccountId; deviceToken: Uint8Array},
): Promise<void> {
    switch (context.actor.type) {
        case "Session":
        case "ImpersonatedAccount": {
            if (context.actor.getAccountId() !== accountId) {
                throw new PermissionDeniedError(
                    "Can’t delete device token for a different account",
                );
            }
            break;
        }
        case "System": {
            // System actor can delete device tokens for any account...
            break;
        }
        case "Anonymous": {
            throw unauthenticatedSessionError();
        }
        case "Bot": {
            throw permissionDeniedBotError();
        }
        default:
            throw exhaustive(context.actor);
    }

    await NotificationsTable.deleteItemWithKeyIfExists(context, {
        partitionType: "PushTargets",
        sortRangeType: "AppleDeviceToken",
        accountId,
        deviceToken,
    });
}
