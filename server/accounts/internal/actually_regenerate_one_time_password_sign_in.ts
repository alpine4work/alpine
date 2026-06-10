import {appleReviewerAccountEmailAddress} from "~/server/accounts/apple_reviewer_account_email_address.js";
import {accountEmailAddressSignInLockedError} from "~/server/accounts/internal/account_email_address_sign_in_locked_error.js";
import {AccountEmailAddressItem, AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {generateOneTimePassword} from "~/server/accounts/internal/generate_one_time_password.js";
import {getHoursUntilRegenerateOneTimePasswordUnlocked} from "~/server/accounts/internal/get_hours_until_regenerate_one_time_password_unlocked.js";
import {maxFailedOneTimePasswordAttemptCount} from "~/server/accounts/one_time_password_constants.js";
import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {Context} from "~/shared/context/context.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {EmailAddress} from "~/shared/helpers/string/email_address.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";

export async function actuallyRegenerateOneTimePasswordSignIn(
    context: Context<Omit<ServerActionContextModules, "actor"> & {email: EmailContextModuleBase}>,
    initialAccountEmailAddressItem: AccountEmailAddressItem,
    {emailVariant}: {emailVariant: MaybePromise<"SignIn" | "SignUp">},
): Promise<void> {
    const {emailAddress} = initialAccountEmailAddressItem;
    const generatedTime = new Date();

    // The Apple reviewer gets the same constant password every time since they don't
    // have access to the email address (we control the email address).
    const password =
        emailAddress === appleReviewerAccountEmailAddress
            ? appleReviewerAccountPassword
            : generateOneTimePassword();

    let hasAlreadyAttempted = false;

    await context.dynamo.retryTransaction(async context => {
        const isInitialAttempt = !hasAlreadyAttempted;
        hasAlreadyAttempted = true;

        const accountEmailAddressItem = isInitialAttempt
            ? initialAccountEmailAddressItem
            : await AccountsTable.getItemWithEventualThenStrongConsistency(context, {
                  partitionType: "AccountEmailAddress",
                  sortRangeType: "Attributes",
                  emailAddress,
              });
        const hoursUntilUnlocked =
            getHoursUntilRegenerateOneTimePasswordUnlocked(accountEmailAddressItem);

        // If the account is locked, you cannot regenerate a password.
        if (hoursUntilUnlocked > 0) throw accountEmailAddressSignInLockedError(hoursUntilUnlocked);

        await AccountsTable.directlyUpdateItem(context, {
            ...accountEmailAddressItem,
            oneTimePasswordSignInState: {
                generatedTime,
                password,
                // Carry over failed attempt count so an attacker can't regenerate the password to
                // get more sign in attempts.
                //
                // However, if we have exceeded the max attempts and we are at this point then
                // regenerating the password unlocks this account. If the account is still locked
                // we would have done an early return above.
                failedAttemptCount:
                    accountEmailAddressItem?.oneTimePasswordSignInState &&
                    accountEmailAddressItem.oneTimePasswordSignInState.failedAttemptCount <
                        maxFailedOneTimePasswordAttemptCount
                        ? accountEmailAddressItem.oneTimePasswordSignInState.failedAttemptCount
                        : 0,
                lastFailedAttemptTime: null,
            },
        });
    });

    // Send an email to `emailAddress` with the new password.
    await afterRegenerateOneTimePasswordSignIn(context, {
        emailAddress,
        // Allow `emailVariant` to be decided asynchronously while we regenerate the
        // one-time password.
        emailVariant: await emailVariant,
        password,
    });
}

export async function afterRegenerateOneTimePasswordSignIn(
    context: Context<Omit<ServerActionContextModules, "actor"> & {email: EmailContextModuleBase}>,
    {
        emailAddress,
        emailVariant,
        password,
    }: {
        emailAddress: EmailAddress;
        emailVariant: "SignIn" | "SignUp";
        password: string;
    },
) {
    // We allow tests to capture one time password emails. Make sure this only happens
    // in test environments since we don't want developers to have access to one time
    // password.
    if (oneTimePasswordSignInEmailsForTest.current !== null) {
        assert(import.meta.jest);
        oneTimePasswordSignInEmailsForTest.current.push({emailAddress, oneTimePassword: password});
    }

    // In development (or Playwright integration tests), log the one time password so
    // developers can sign in. In integration tests we watch the app service stdout for
    // this log line and capture it so we can use the one time password to log in.
    if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.log(quote`The one time password for ${emailAddress} is ${password}`);
    }

    await context.email.sendImmediately({
        fromEmailAddressAlias: emailVariant,
        toEmailAddress: emailAddress,
        templateName: "SignInOrSignUp",
        templateProps: {
            variant: emailVariant,
            code: password,
        },
    });
}

export const oneTimePasswordSignInEmailsForTest: {
    current: Array<{
        emailAddress: EmailAddress;
        oneTimePassword: string;
    }> | null;
} = {current: null};

/**
 * This is a secret string shared between our company and Apple. An Apple reviewer
 * may use this string to log into a space made just for them. It's not that big a
 * deal if the string leaks. All the account has access to is their own space.
 */
const appleReviewerAccountPassword = "968706";

export function getAppleReviewerAccountPasswordForTest() {
    assert(import.meta.jest);
    return appleReviewerAccountPassword;
}
