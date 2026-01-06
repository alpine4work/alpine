import {authorizeInternalAccess} from "~/server/accounts/authorize_internal_access.js";
import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {createAccountModelWithoutSpaceFromItem} from "~/server/accounts/internal/create_account_model_without_space_from_item.js";
import {getAccountItem} from "~/server/accounts/internal/get_account_item.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {validateEmailAddress} from "~/server/emails/email_address.js";
import {AccountModelWithoutSpace} from "~/shared/accounts/account_model_without_space.js";

/**
 * Get any `AccountModelWithoutSpace` by `EmailAddress`. The actor must have
 * internal access to make this request.
 */
export async function getAccountByEmailAddressAsAdmin(
    context: ServerActionContext,
    emailAddress: string,
): Promise<AccountModelWithoutSpace> {
    await authorizeInternalAccess(context);

    const accountEmailAddressItem = await AccountsTable.getItem(context, {
        partitionType: "AccountEmailAddress",
        sortRangeType: "Attributes",
        emailAddress: validateEmailAddress(emailAddress),
    });

    const accountItem = await getAccountItem(context, accountEmailAddressItem.accountId);

    return createAccountModelWithoutSpaceFromItem(accountItem);
}
