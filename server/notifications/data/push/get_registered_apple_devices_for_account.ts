import {ServerActionContext} from "~/server/context/server_action_context.js";
import {getRegisteredAppleDevicesForAccountWithoutAuthorization} from "~/server/notifications/data/internal/push/get_registered_apple_devices_without_authorization.js";
import {authorizeOwnSpaceAccountAccess} from "~/server/spaces/authorize_own_space_account_access.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {AppleDeviceTarget} from "~/shared/notifications/push_notification_target.js";

/**
 * Get all devices registered for the provided `AccountId`. System actors can see
 * the registered devices for any account since we need to send push notifications
 * to the account's devices as the system actor.
 */
export async function getRegisteredAppleDevicesForAccount(
    context: ServerActionContext,
    accountId: AccountId,
): Promise<ReadonlyArray<AppleDeviceTarget>> {
    await authorizeOwnSpaceAccountAccess(context, accountId);
    return await getRegisteredAppleDevicesForAccountWithoutAuthorization(context, accountId);
}
