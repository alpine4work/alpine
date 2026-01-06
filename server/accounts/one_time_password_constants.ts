/**
 * Number of times a user may attempt to sign in with a one-time password.
 */
export const maxFailedOneTimePasswordAttemptCount = 5;

/**
 * Expire one-time passwords after an hour.
 */
// We write in our `SignInEmailTemplate` copy that the code expires after one
// hour. If we change the password expiration time, we should also change
// the copy.
export const expireOneTimePasswordAfterMinutes = 60;

/**
 * The number of hours a user must wait after their account has been locked
 * before they can generate a new password.
 */
export const maxHoursUntilRegenerateOneTimePasswordUnlocked = 24;
