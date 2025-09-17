import {Schema, SchemaType} from "~/shared/schema/schema.js";

export type DigestNotificationsSchedule = SchemaType<typeof DigestNotificationsScheduleSchema>;

export const defaultDigestNotificationSchedule: DigestNotificationsSchedule = new Set([
    "08:00",
    "17:00",
]);

/**
 * The possible times available for a notification to be scheduled as "HH:mm".
 * These times are timezone naive and represent a desired time in any given time zone.
 */
export const DigestNotificationsScheduleSchema = Schema.set(
    Schema.enum([
        "00:00",
        "01:00",
        "02:00",
        "03:00",
        "04:00",
        "05:00",
        "06:00",
        "07:00",
        "08:00",
        "09:00",
        "10:00",
        "11:00",
        "12:00",
        "13:00",
        "14:00",
        "15:00",
        "16:00",
        "17:00",
        "18:00",
        "19:00",
        "20:00",
        "21:00",
        "22:00",
        "23:00",
    ]),
).default(defaultDigestNotificationSchedule);
