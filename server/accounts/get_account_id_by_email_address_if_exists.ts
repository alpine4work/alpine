import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {EmailAddress} from "~/shared/helpers/string/email_address.js";
import {AccountId} from "~/shared/id/types/id_types.js";

/**
 * Get the AccountId associated with an email address, if one exists.
 *
 * Security considerations: This function allows determining whether an email
 * address has signed up for Alpine and obtaining their AccountId. This is
 * considered an acceptable information leak since: a) On the sign-in page, we
 * already reveal whether an account exists b) An AccountId alone provides no
 * access without additional authentication Additionally, there's no way to
 * directly call this function from the client.
 */
export async function getAccountIdByEmailAddressIfExists(
    context: ServerActionContext,
    emailAddress: EmailAddress,
): Promise<AccountId | null> {
    const accountEmailAddressItem = await AccountsTable.getItemIfExists(context, {
        partitionType: "AccountEmailAddress",
        sortRangeType: "Attributes",
        emailAddress,
    });

    if (!accountEmailAddressItem) {
        return null;
    }

    return accountEmailAddressItem.accountId;
}
