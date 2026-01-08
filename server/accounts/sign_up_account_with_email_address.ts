import {createAccountTransactionEntries} from "~/server/accounts/create_account_transaction_entries.js";
import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {
    actuallyRegenerateOneTimePasswordSignIn,
    afterRegenerateOneTimePasswordSignIn,
} from "~/server/accounts/internal/actually_regenerate_one_time_password_sign_in.js";
import {generateOneTimePassword} from "~/server/accounts/internal/generate_one_time_password.js";
import {getAccountItemWithoutAvatarWithEventualThenStrongConsistency} from "~/server/accounts/internal/get_account_item.js";
import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {isDynamoConditionCheckError} from "~/server/dynamo/core/is_dynamo_condition_check_error.js";
import {EmailAddress} from "~/server/emails/email_address.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {Context} from "~/shared/context/context.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";

/**
 * Sign up an account with the provided email address. Sends the account an
 * email containing a one time password they'll use to verify the email address
 * and complete the sign up process. If we already have an account item for the
 * email address we either throw an error or let them sign up if
 * `hasNotSignedUp` is true (e.g. when a new email is invited to a space).
 */
export async function signUpAccountWithEmailAddress(
    context: Context<Omit<ServerActionContextModules, "actor"> & {email: EmailContextModuleBase}>,
    emailAddress: EmailAddress,
): Promise<AccountId> {
    const accountId = generateId<AccountId>();

    const currentTime = new Date();
    const password = generateOneTimePassword();

    try {
        await DynamoTableSchema.executeTransaction(context, [
            ...createAccountTransactionEntries({
                id: accountId,
                currentTime: currentTime,
                name: emailAddress,
            }),
            AccountsTable.transactionCreateItem({
                partitionType: "AccountEmailAddress",
                sortRangeType: "Attributes",
                emailAddress,
                accountId,
                isVerified: false,
                createdTime: currentTime,
                oneTimePasswordSignInState: {
                    generatedTime: currentTime,
                    password,
                    failedAttemptCount: 0,
                    lastFailedAttemptTime: null,
                },
            }),
        ]);
    } catch (error) {
        if (!isDynamoConditionCheckError(error)) throw error;

        // If an account already exists for the email address then we still allow the
        // sign up flow if `hasNotSignedUp` is true on the account item.
        const existingAccountId = await handleSignUpAccountWithEmailAddressConditionCheckError(
            context,
            emailAddress,
        );

        return existingAccountId;
    }

    // Send an email to `emailAddress` with the new password.
    await afterRegenerateOneTimePasswordSignIn(context, emailAddress, password);

    return accountId;
}

async function handleSignUpAccountWithEmailAddressConditionCheckError(
    context: Context<Omit<ServerActionContextModules, "actor"> & {email: EmailContextModuleBase}>,
    emailAddress: EmailAddress,
): Promise<AccountId> {
    const accountEmailAddressItem = await AccountsTable.getItemWithEventualThenStrongConsistency(
        context,
        {
            partitionType: "AccountEmailAddress",
            sortRangeType: "Attributes",
            emailAddress,
        },
    );

    const accountItem = await getAccountItemWithoutAvatarWithEventualThenStrongConsistency(
        context,
        accountEmailAddressItem.accountId,
    );

    if (!accountItem.hasNotSignedUp) {
        throw new FailedPreconditionError("Email address has already signed up", {
            displayMessage: errorDisplayMessage`The email “${emailAddress}” has already been used. Try ${errorDisplayMessage.link(
                "signing in",
                `/auth/sign-in?email=${encodeURIComponent(emailAddress)}`,
            )}.`,
        });
    }

    // If the account already exists then regenerate the one time password and send
    // an email with the new password.
    await actuallyRegenerateOneTimePasswordSignIn(context, accountEmailAddressItem);

    return accountEmailAddressItem.accountId;
}
