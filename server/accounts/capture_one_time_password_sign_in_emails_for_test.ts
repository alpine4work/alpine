import {oneTimePasswordSignInEmailsForTest} from "~/server/accounts/internal/actually_regenerate_one_time_password_sign_in.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {EmailAddress} from "~/shared/helpers/string/email_address.js";

/**
 * Helper for tests to capture one time password sign in emails.
 */
export async function captureOneTimePasswordSignInEmailsForTest(
    action: () => Promise<void>,
): Promise<Array<{emailAddress: EmailAddress; oneTimePassword: string}>> {
    assert(import.meta.jest);

    const previousOneTimePasswordLoginEmailsForTest = oneTimePasswordSignInEmailsForTest.current;
    oneTimePasswordSignInEmailsForTest.current = [];
    try {
        await action();
        return oneTimePasswordSignInEmailsForTest.current;
    } finally {
        oneTimePasswordSignInEmailsForTest.current = previousOneTimePasswordLoginEmailsForTest;
    }
}
