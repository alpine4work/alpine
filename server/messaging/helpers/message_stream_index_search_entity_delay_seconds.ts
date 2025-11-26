import {addMilliseconds, addSeconds} from "date-fns";
import {messageStreamTimeoutMs} from "~/server/messaging/helpers/message_stream_timeout_ms.js";
import {isDatePossiblyLessThanWithUncertaintyWindow} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";

/**
 * The delay in seconds between when we send `IndexSearchEntity` jobs for a
 * message stream.
 *
 * `IndexSearchEntity` jobs also will mark streams as expired if they haven't
 * been pinged in a while. So we base our `IndexSearchEntity` delay based on
 * 2x the message stream timeout which would be 20 seconds. So for 10 seconds
 * we don't need to schedule a new job.
 */
export const messageStreamIndexSearchEntityDelaySeconds = Math.ceil(
    (messageStreamTimeoutMs * 2) / 1000,
);

/**
 * Should we schedule a new `IndexSearchEntity` job for a message stream?
 *
 * Invariant: we always want an `IndexSearchEntity` job scheduled to run *after*
 * the stream’s timeout, so that if no further pings arrive, the job can see
 * that the stream has expired and index the final state.
 *
 * When we receive the first stream part operation, we queue an
 * `IndexSearchEntity` job to run 20 seconds in the future (10 seconds after
 * the initial stream timeout at T+10).
 *
 * Each subsequent stream operation pushes the stream’s timeout forward, since
 * the stream times out after the *last* operation. If an operation updates the
 * timeout so that the currently scheduled `IndexSearchEntity` job would now run
 * *before* the new timeout, we queue a new `IndexSearchEntity` job to run
 * 10 seconds after the updated timeout.
 *
 * Example with time starting at T0:
 *
 * 1. createMessage @  T0, timeoutTime = T10, indexSearchEntity.jobTime = T20
 * 2. putStreamPart @  T3, timeoutTime = T13, indexSearchEntity.jobTime = T20
 * 3. pingStream    @  T5, timeoutTime = T15, indexSearchEntity.jobTime = T20
 * 4. pingStream    @ T12, timeoutTime = T22, indexSearchEntity.jobTime = T32
 *
 *    - At step 4, we finally schedule a new job at T32. The previously
 *      scheduled job at T20 would run before the stream’s timeout (T22), so
 *      we need a new job after the timeout. This is important because the job
 *      needs to be able to determine whether the stream has timed out.
 */
export function shouldScheduleMessageStreamIndexSearchEntityJob(
    lastIndexSearchEntityJob: {sendTime: Date; delaySeconds: number},
    lastPingTime: Date,
) {
    return isDatePossiblyLessThanWithUncertaintyWindow(
        addSeconds(lastIndexSearchEntityJob.sendTime, lastIndexSearchEntityJob.delaySeconds),
        addMilliseconds(lastPingTime, messageStreamTimeoutMs),
    );
}
