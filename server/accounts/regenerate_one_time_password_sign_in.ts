import {accountEmailAddressNotFoundError} from "~/server/accounts/internal/account_email_address_not_found_error.js";
import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {actuallyRegenerateOneTimePasswordSignIn} from "~/server/accounts/internal/actually_regenerate_one_time_password_sign_in.js";
import {getAccountItemWithoutAvatarWithEventualThenStrongConsistency} from "~/server/accounts/internal/get_account_item.js";
import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {Context} from "~/shared/context/context.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {EmailAddress} from "~/shared/helpers/string/email_address.js";
import {AccountId} from "~/shared/id/types/id_types.js";

/**
 * Generates a new one time password for signing into an account with the
 * provided email address. Sends the password to the account's email address.
 */
export async function regenerateOneTimePasswordSignIn(
    context: Context<Omit<ServerActionContextModules, "actor"> & {email: EmailContextModuleBase}>,
    emailAddress: EmailAddress,
    {toSearchParam = null}: {toSearchParam?: string | null} = {},
): Promise<{
    accountId: AccountId;
    hasNotSignedUp: boolean;
}> {
    const accountEmailAddressItem = await AccountsTable.getItemIfExists(context, {
        partitionType: "AccountEmailAddress",
        sortRangeType: "Attributes",
        emailAddress,
    });

    if (!accountEmailAddressItem)
        throw accountEmailAddressNotFoundError(emailAddress, {toSearchParam});

    const accountItemPromise = getAccountItemWithoutAvatarWithEventualThenStrongConsistency(
        context,
        accountEmailAddressItem.accountId,
    );

    const [accountItem] = await runAllPromises([
        accountItemPromise,
        actuallyRegenerateOneTimePasswordSignIn(context, accountEmailAddressItem, {
            // If the account hasn't signed up then we'll be redirecting them to the sign
            // up flow. So send them the sign up email instead of the sign in email.
            emailVariant: accountItemPromise.then(accountItem =>
                accountItem.hasNotSignedUp ? "SignUp" : "SignIn",
            ),
        }),
    ]);

    return {
        accountId: accountEmailAddressItem.accountId,
        hasNotSignedUp: accountItem.hasNotSignedUp ?? false,
    };
}
