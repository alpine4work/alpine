import {Schema, SchemaType} from "~/shared/schema/schema.js";

const nonTransactionalEmailTypeList = ["NotificationDigest"] as const;

// NOTE(rmtobin): We only have digest emails currently, but any other emails we send that can be
// unsubscribed from should be added here. Note that when a user unsubscribes, they unsubscribe from
// that specific email type, not an individual email or all emails.
/**
 * A union of our non-transactional email types, used for creating unsubscribe URLs.
 */
export type NonTransactionalEmailType = SchemaType<typeof NonTransactionalEmailTypeSchema>;
export const NonTransactionalEmailTypeSchema = Schema.enum(nonTransactionalEmailTypeList);

export function isNonTransactionalEmailType(
    emailType: string,
): emailType is NonTransactionalEmailType {
    if (typeof emailType !== "string") return false;
    return nonTransactionalEmailTypeList.includes(emailType as NonTransactionalEmailType);
}
