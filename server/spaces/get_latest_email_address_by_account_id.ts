import {internalGetLatestEmailAddressByAccountIdWithoutAuthorization} from "~/server/accounts/internal_get_latest_email_address_by_account_id_without_authorization.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {authorizeOwnSpaceAccountAccess} from "~/server/spaces/authorize_own_space_account_access.js";
import {NotFoundError} from "~/shared/error/error.open_source.js";
import {EmailAddress} from "~/shared/helpers/string/email_address.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Get the most recently added email address for the provided `AccountId`. System
 * actors can see the most recently added email address for any account in their
 * space.
 */
export async function getLatestEmailAddressByAccountId(
    context: ServerActionContext,
    accountId: AccountId,
): Promise<EmailAddress> {
    await authorizeOwnSpaceAccountAccess(context, accountId);
    const emailAddress = await internalGetLatestEmailAddressByAccountIdWithoutAuthorization(
        context,
        accountId,
    );
    if (!emailAddress) {
        throw new NotFoundError("No email address found for `accountId`");
    }
    return emailAddress;
}
