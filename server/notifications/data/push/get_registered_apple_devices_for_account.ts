import {ServerActionContext} from "~/server/context/server_action_context.js";
import {
    AccountDevice,
    getRegisteredAppleDevicesForAccountWithoutAuthorization,
} from "~/server/notifications/data/internal/push/get_registered_apple_devices_without_authorization.js";
import {authorizeOwnSpaceAccountAccess} from "~/server/spaces/spaces_actions.js";
import {AccountId} from "~/shared/id/types/id_types.js";

/**
 * Get all devices registered for the provided `AccountId`. System actors can
 * see the registered devices for any account since we need to send push
 * notifications to the account's devices as the system actor.
 */
export async function getRegisteredAppleDevicesForAccount(
    context: ServerActionContext,
    accountId: AccountId,
): Promise<ReadonlyArray<AccountDevice>> {
    await authorizeOwnSpaceAccountAccess(context, accountId);
    return getRegisteredAppleDevicesForAccountWithoutAuthorization(context, accountId);
}
