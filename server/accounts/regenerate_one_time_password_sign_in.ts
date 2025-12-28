import {accountEmailAddressNotFoundError} from "~/server/accounts/internal/account_email_address_not_found_error.js";
import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {actuallyRegenerateOneTimePasswordSignIn} from "~/server/accounts/internal/actually_regenerate_one_time_password_sign_in.js";
import {getAccountItemWithoutAvatarWithEventualThenStrongConsistency} from "~/server/accounts/internal/get_account_item.js";
import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {EmailAddress} from "~/server/emails/email_address.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {Context} from "~/shared/context/context.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {AccountId} from "~/shared/id/types/id_types.js";

/**
 * Generates a new one time password for signing into an account with the
 * provided email address. Sends the password to the account's email address.
 */
export async function regenerateOneTimePasswordSignIn(
    context: Context<Omit<ServerActionContextModules, "actor"> & {email: EmailContextModuleBase}>,
    emailAddress: EmailAddress,
): Promise<{
    accountId: AccountId;
    hasNotSignedUp: boolean;
}> {
    const accountEmailAddressItem = await AccountsTable.getItemIfExists(context, {
        partitionType: "AccountEmailAddress",
        sortRangeType: "Attributes",
        emailAddress,
    });

    if (!accountEmailAddressItem) throw accountEmailAddressNotFoundError(emailAddress);

    const [accountItem] = await runAllPromises([
        getAccountItemWithoutAvatarWithEventualThenStrongConsistency(
            context,
            accountEmailAddressItem.accountId,
        ),
        actuallyRegenerateOneTimePasswordSignIn(context, accountEmailAddressItem),
    ]);

    return {
        accountId: accountEmailAddressItem.accountId,
        hasNotSignedUp: accountItem.hasNotSignedUp ?? false,
    };
}
