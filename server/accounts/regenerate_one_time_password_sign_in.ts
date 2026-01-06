import {appleReviewerAccountEmailAddress} from "~/server/accounts/apple_reviewer_account_email_address.js";
import {accountEmailAddressNotFoundError} from "~/server/accounts/internal/account_email_address_not_found_error.js";
import {accountEmailAddressSignInLockedError} from "~/server/accounts/internal/account_email_address_sign_in_locked_error.js";
import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {generateOneTimePassword} from "~/server/accounts/internal/generate_one_time_password.js";
import {getHoursUntilRegenerateOneTimePasswordUnlocked} from "~/server/accounts/internal/get_hours_until_regenerate_one_time_password_unlocked.js";
import {maxFailedOneTimePasswordAttemptCount} from "~/server/accounts/one_time_password_constants.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {EmailAddress} from "~/server/emails/email_address.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {ConstantsContextModule} from "~/shared/context/constants_context_module.js";
import {Context} from "~/shared/context/context.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {quote} from "~/shared/helpers/string/quote.js";

/**
 * Generates a new one time password for signing into an account with the
 * provided email address. Sends the password to the account's email address.
 */
export async function regenerateOneTimePasswordSignIn(
    context: Context<
        DynamoContextModules & {email: EmailContextModuleBase} & {
            constants: ConstantsContextModule;
        }
    >,
    emailAddress: EmailAddress,
): Promise<void> {
    const generatedTime = new Date();

    // The Apple reviewer gets the same constant password every time since they
    // don't have access to the email address (we control the email address).
    const password =
        emailAddress === appleReviewerAccountEmailAddress
            ? appleReviewerAccountPassword
            : generateOneTimePassword();

    await AccountsTable.updateItem(
        context,
        {
            partitionType: "AccountEmailAddress",
            sortRangeType: "Attributes",
            emailAddress,
        },
        accountEmailAddressItem => {
            if (!accountEmailAddressItem) throw accountEmailAddressNotFoundError(emailAddress);

            const hoursUntilUnlocked =
                getHoursUntilRegenerateOneTimePasswordUnlocked(accountEmailAddressItem);

            // If the account is locked, you cannot regenerate a password.
            if (hoursUntilUnlocked > 0)
                throw accountEmailAddressSignInLockedError(hoursUntilUnlocked);

            return {
                ...accountEmailAddressItem,
                oneTimePasswordSignInState: {
                    generatedTime,
                    password,
                    // Carry over failed attempt count so an attacker can't regenerate the password
                    // to get more sign in attempts.
                    //
                    // However, if we have exceeded the max attempts and we are at this point then
                    // regenerating the password unlocks this account. If the account is still
                    // locked we would have done an early return above.
                    failedAttemptCount:
                        accountEmailAddressItem.oneTimePasswordSignInState &&
                        accountEmailAddressItem.oneTimePasswordSignInState.failedAttemptCount <
                            maxFailedOneTimePasswordAttemptCount
                            ? accountEmailAddressItem.oneTimePasswordSignInState.failedAttemptCount
                            : 0,
                    lastFailedAttemptTime: null,
                },
            };
        },
    );

    // We allow tests to capture one time password emails. Make sure this only
    // happens in test environments since we don't want developers to have access
    // to one time password.
    if (oneTimePasswordSignInEmailsForTest !== null) {
        assert(import.meta.jest);
        oneTimePasswordSignInEmailsForTest.push({emailAddress, oneTimePassword: password});
    }

    // In development (or Playwright integration tests), log the one time password
    // so developers can sign in. In integration tests we watch the app service
    // stdout for this log line and capture it so we can use the one time password
    // to log in.
    if (process.env.NODE_ENV === "development" || process.env.PLAYWRIGHT_TEST_PATH) {
        // eslint-disable-next-line no-console
        console.log(quote`The one time password for ${emailAddress} is ${password}`);
    }

    await context.email.sendImmediately({
        fromEmailAddressAlias: "SignIn",
        toEmailAddress: emailAddress,
        templateName: "SignIn",
        templateProps: {
            code: password,
            baseUrl: context.constants.edgeServiceUrl,
            emailAddress,
        },
    });
}

let oneTimePasswordSignInEmailsForTest: Array<{
    emailAddress: string;
    oneTimePassword: string;
}> | null = null;

/**
 * Helper for tests to capture one time password sign in emails.
 */
export async function captureOneTimePasswordSignInEmailsForTest(
    action: () => Promise<void>,
): Promise<Array<{emailAddress: string; oneTimePassword: string}>> {
    assert(import.meta.jest);

    const previousOneTimePasswordLoginEmailsForTest = oneTimePasswordSignInEmailsForTest;
    oneTimePasswordSignInEmailsForTest = [];
    try {
        await action();
        return oneTimePasswordSignInEmailsForTest;
    } finally {
        oneTimePasswordSignInEmailsForTest = previousOneTimePasswordLoginEmailsForTest;
    }
}

/**
 * This is a secret string shared between our company and Apple. An Apple
 * reviewer may use this string to log into a space made just for them. It's
 * not that big a deal if the string leaks. All the account has access to is
 * their own space.
 */
const appleReviewerAccountPassword = "968706";

export function getAppleReviewerAccountPasswordForTest() {
    assert(import.meta.jest);
    return appleReviewerAccountPassword;
}
