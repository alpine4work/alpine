/**
 * When the inbox is observed, we increment the inbox's generation counter by this
 * amount. New entries will use the generation from the inbox's generation counter.
 *
 * This value is higher than `loudNotificationInboxGenerationIncrement`. Loud
 * notifications add that value to the inbox's generation counter so that loud
 * notifications are at the top of the inbox. When the inbox is observed we
 * therefore need to move the inbox generation counter past this intermediate
 * generation.
 */
export const observeInboxGenerationIncrement = 2;

/**
 * For inbox entries with loud notifications we add this value to the inbox's
 * generation counter to determine the generation of the inbox entry. This puts
 * inbox entries with loud notifications above all other entries that use the
 * inbox's generation counter unmodified.
 *
 * When we observe the inbox we need to increment the inbox's generation counter
 * past the intermediate generation used by loud notifications so that new entries
 * are placed at the top of the inbox.
 */
export const loudNotificationInboxGenerationIncrement = 1;

/**
 * When we unarchive inbox entries we want to put them at the top of the inbox.
 * Even above inbox entries with loud notifications! We do this, currently, by
 * putting them at the same generation as loud notifications. The `enteredTime` of
 * the unarchived entry will be higher than the ones for loud notifications so the
 * entry goes at the top.
 */
export const unarchivedInboxOwnEntryGenerationIncrement = 1;
