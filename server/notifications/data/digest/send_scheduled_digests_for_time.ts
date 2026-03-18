import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {
    serializeScheduleDateTime,
    serializeScheduleDateTimeString,
} from "~/server/notifications/core/schedule_date_time.js";
import {NotificationDigestEntriesIndex} from "~/server/notifications/data/internal/inbox_table.js";
import {Context} from "~/shared/context/context.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";

// NOTE (rmtobin, 10/06/25): If we end up with too many digests to be sent per
// partition, we can run more than one instance of this function and give it a sort
// key range on `accountId`.
/**
 * Spawns `SendNotificationDigest` jobs to send scheduled digest notifications for
 * all accounts that are scheduled to receive a digest at the next closest future
 * hour. For example, if digestTime is at 7:00-7:59, it will send digests for 8:00.
 */
export async function sendScheduledDigestsForTime(
    context: Context<{jobs: JobsContextModule} & Omit<ServerActionContextModules, "actor">>,
    digestTime: Date,
) {
    return context.tracer.withSpan(
        "Send scheduled notification digests for time",
        async (context, span) => {
            const sendTime = serializeScheduleDateTime(digestTime);
            span.addData({
                notifications: {
                    emailDigest: {
                        sendTime: serializeScheduleDateTimeString(sendTime),
                    },
                },
            });
            const result = NotificationDigestEntriesIndex.query(context, {
                partitionKey: {
                    digestNotificationsNextScheduledDateTime: sendTime,
                },
                limit: "All",
            });
            await parallelMapAsyncIterableToArray(result, async item => {
                await context.jobs.sendAndWait({
                    type: "SendNotificationDigest",
                    accountId: item.accountId,
                    spaceId: item.spaceId,
                    sendTime,
                });
            });
        },
    );
}
