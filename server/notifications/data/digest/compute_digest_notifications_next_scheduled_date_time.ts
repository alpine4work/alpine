import {ZonedDateTime, fromDate, minDate, parseTime} from "@internationalized/date";
import {
    ScheduleDateTime,
    assertScheduleDateTime,
} from "~/server/notifications/core/schedule_date_time.js";
import {TimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {DigestNotificationsSchedule} from "~/shared/notifications/notifications_schedule_schema.js";

/**
 * Computes the next date and time when we should send a digest notification to an account.
 *
 * To determine when an account's next digest should be sent, we look for the closest future
 * time within their schedule from the perspective of the account's current local time.
 * Scheduled times that are earlier than the current local time are treated as tomorrow
 * (e.g. at 15:00 local, a schedule time of 08:00 is treated as 08:00 local tomorrow).
 *
 * Optionally, you can provide a `lagTimeInMinutes` which acts as if the current time is ahead by
 * that amount. This is useful if you'd like to ensure you don't receive a schedule time that is
 * too close to the current time and could cause downstream systems to receive a time that has
 * already passed.
 */
export function computeDigestNotificationsNextScheduledDateTime(
    currentTime: Date,
    timeZone: TimeZone | null,
    digestNotificationsSchedule: DigestNotificationsSchedule,
    options: {lagTimeInMinutes: number} = {lagTimeInMinutes: 0},
): ScheduleDateTime | null {
    // If we receive no time zone, use our default so the user will still get digests, even if
    // they are at the wrong time(s). The default is 'America/New_York', so digests will be at
    // least roughly correct for most US users.
    const actualTimeZone = timeZone ?? defaultTimeZone;

    const currentAccountDateTime = fromDate(currentTime, actualTimeZone);

    const adjustedCurrentTime = options.lagTimeInMinutes
        ? currentAccountDateTime.add({minutes: options.lagTimeInMinutes})
        : currentAccountDateTime;

    let closestZonedDateTime: ZonedDateTime | null = null;
    for (const scheduledHour of digestNotificationsSchedule) {
        const time = parseTime(scheduledHour);
        const scheduledDateTime = adjustedCurrentTime.set({
            hour: time.hour,
            minute: time.minute,
            second: 0,
            millisecond: 0,
        });
        if (scheduledDateTime.compare(adjustedCurrentTime) >= 0) {
            closestZonedDateTime ??= scheduledDateTime;
            closestZonedDateTime = minDate(closestZonedDateTime, scheduledDateTime);
        } else {
            const nextDayScheduledDateTime = scheduledDateTime.add({days: 1});
            closestZonedDateTime ??= nextDayScheduledDateTime;
            closestZonedDateTime = minDate(closestZonedDateTime, nextDayScheduledDateTime);
        }
    }

    return closestZonedDateTime ? assertScheduleDateTime(closestZonedDateTime.toDate()) : null;
}
