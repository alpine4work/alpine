/**
 * After you clear your inbox, we wait this many minutes before showing you the
 * subtle notification badge again. Since new subtle notifications aren't urgent
 * and we want the user to have the peace of inbox zero for a bit.
 *
 * This helps people have a better relationship with their inbox. You can still
 * reach someone immediately with a loud notification.
 *
 * We check the elapsed duration every ~10 minutes so the actual experienced peace
 * minutes may be up to 10 minutes higher than what's declared here.
 */
export const inboxSubtleNotificationBadgePeaceMinutes = 30;
