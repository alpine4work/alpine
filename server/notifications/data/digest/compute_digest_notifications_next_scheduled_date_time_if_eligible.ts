import {ScheduleDateTime} from "~/server/notifications/core/schedule_date_time.js";
import {computeDigestNotificationsNextScheduledDateTime} from "~/server/notifications/data/digest/compute_digest_notifications_next_scheduled_date_time.js";
import {isInboxEligibleForDigestNotification} from "~/server/notifications/data/digest/is_inbox_eligible_for_digest_notification.js";
import {InboxAttributesItem} from "~/server/notifications/data/internal/inbox_table.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";

/**
 * Computes the next date and time when we should send a digest notification to an
 * account or returns null if they are not eligible to receive one.
 *
 * See `computeDigestNotificationsNextScheduledDateTime` for the time computation
 * logic and `isInboxEligibleForDigestNotification` for the eligibility logic.
 */
export function computeDigestNotificationsNextScheduledDateTimeIfEligible(
    context: Context<{tracer: TracerContextModule}>,
    {
        currentTime,
        timeZone,
        inboxItem,
        options = {lagTimeInMinutes: 0},
    }: {
        currentTime: Date;
        timeZone: TimeZone | null;
        inboxItem: InboxAttributesItem;
        options: {lagTimeInMinutes: number};
    },
): ScheduleDateTime | null {
    return isInboxEligibleForDigestNotification(context, inboxItem)
        ? computeDigestNotificationsNextScheduledDateTime(
              currentTime,
              timeZone,
              inboxItem.digestNotificationsSchedule,
              options,
          )
        : null;
}
