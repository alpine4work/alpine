/**
 * A union of our non-transactional email types, used for creating unsubscribe URLs.
 *
 * NOTE(rmtobin): We only have digest emails currently, but any other emails we send that can be
 * unsubscribed from should be added here. Note that when a user unsubscribes, they unsubscribe from
 * that specific email type, not an individual email or all emails.
 */
export type NonTransactionalEmailType = (typeof nonTransactionalEmailTypeList)[number];

const nonTransactionalEmailTypeList = ["NotificationDigest"] as const;

export function isNonTransactionalEmailType(
    emailType: string,
): emailType is NonTransactionalEmailType {
    if (typeof emailType !== "string") return false;
    return nonTransactionalEmailTypeList.includes(emailType as NonTransactionalEmailType);
}
