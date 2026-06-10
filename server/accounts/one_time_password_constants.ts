/**
 * Number of times a user may attempt to sign in with a one-time password.
 */
export const maxFailedOneTimePasswordAttemptCount = 5;

/**
 * Expire one-time passwords after ten minutes.
 */
// We write in our `SignInOrSignUpEmailTemplate` copy that the code expires after
// one hour. If we change the password expiration time, we should also change the
// copy.
export const expireOneTimePasswordAfterMinutes = 10;

/**
 * The number of hours a user must wait after their account has been locked before
 * they can generate a new password.
 */
export const maxHoursUntilRegenerateOneTimePasswordUnlocked = 24;
