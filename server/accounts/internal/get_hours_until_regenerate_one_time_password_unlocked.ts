import {differenceInHours} from "date-fns";
import {AccountEmailAddressItem} from "~/server/accounts/internal/accounts_table.js";
import {
    maxFailedOneTimePasswordAttemptCount,
    maxHoursUntilRegenerateOneTimePasswordUnlocked,
} from "~/server/accounts/one_time_password_constants.js";

/**
 * Get the number of hours until the user can regenerate their password. If
 * the number is 0 than the account may be unlocked.
 */
export function getHoursUntilRegenerateOneTimePasswordUnlocked({
    oneTimePasswordSignInState,
}: AccountEmailAddressItem): number {
    // If the email address is not locked, the user may regenerate a password
    // whenever.
    if (
        !oneTimePasswordSignInState ||
        oneTimePasswordSignInState.failedAttemptCount < maxFailedOneTimePasswordAttemptCount
    ) {
        return 0;
    }

    if (!oneTimePasswordSignInState.lastFailedAttemptTime) {
        return maxHoursUntilRegenerateOneTimePasswordUnlocked;
    }

    const hoursSinceLastFailedOneTimePasswordSignInAttempt = differenceInHours(
        new Date(),
        oneTimePasswordSignInState.lastFailedAttemptTime,
    );

    const hoursUntilRegenerateOneTimePasswordSignInUnlocked =
        maxHoursUntilRegenerateOneTimePasswordUnlocked -
        hoursSinceLastFailedOneTimePasswordSignInAttempt;

    return Math.max(hoursUntilRegenerateOneTimePasswordSignInUnlocked, 0);
}
