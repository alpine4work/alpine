import {addDays} from "date-fns";
import {BotWebhookContextModule} from "~/server/bots/bot_webhook_context_module.js";
import {
    BotWebhookEventItem,
    BotWebhookEventsTable,
    botWebhookMaxRetryCount,
} from "~/server/bots/internal/bot_webhook_events_table.js";
import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {ServerSystemActionContextModules} from "~/server/context/server_action_context.js";
import {CallBotWebhookJobDescription} from "~/server/jobs/core/job_description.js";
import {BotTokenPayloadScope} from "~/server/tokens/token_payload.js";
import {parseApiBotWebhookEventIntoMessageRoom} from "~/shared/api/parse_api_path.js";
import {ApiBotWebhookRequestBody} from "~/shared/api/types/api_specification_convenience_types.js";
import {Context} from "~/shared/context/context.js";
import {DeadlineExceededError, UnknownError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";

const botWebhookRequestTimeoutMs = 10 * 1000;
const botWebhookRetryDelayIncrementMs = 2 * 1000;

function getBotWebhookRetryTime(attemptNumber: number, endTime: Date) {
    return endTime.getTime() + botWebhookRetryDelayIncrementMs * attemptNumber;
}

let isProcessCallBotWebhookJobCrashSimulatedForTest = false;

export function setIsProcessCallBotWebhookJobCrashSimulatedForTest(value: boolean) {
    assert(import.meta.jest);
    isProcessCallBotWebhookJobCrashSimulatedForTest = value;
}

/**
 * When processing a bot webhook job we'll retry failures up to three times
 * (after 2 seconds then 4 seconds). We time out requests after 10 seconds.
 */
export async function processCallBotWebhookJob(
    context: Context<ServerSystemActionContextModules & {botWebhook: BotWebhookContextModule}>,
    job: CallBotWebhookJobDescription,
) {
    let hasLease = false;

    const [botItem, eventItem] = await runAllPromises([
        BotsTable.getItem(context, {
            partitionType: "Bot",
            sortRangeType: "Attributes",
            botId: job.botId,
        }),
        BotWebhookEventsTable.updateItem(
            context,
            {
                partitionType: "BotSpace",
                sortRangeType: "Event",
                botId: job.botId,
                spaceId: job.spaceId,
                eventId: job.eventId,
            },
            oldEventItem => {
                let newEventItem;
                ({hasLease, eventItem: newEventItem} = leaseBotWebhookEventItem(job, oldEventItem));
                return newEventItem;
            },
        ),
    ]);

    // We always create an event item if one doesn't already exist.
    assert(eventItem);

    if (!botItem.webhookUrl) {
        // If the bot has no webhook URL then we shouldn't proceed with webhook event
        // processing.
        return;
    }

    if (hasLease) {
        await actuallyCallBotWebhook(context, botItem.webhookUrl, eventItem, job);
        return;
    }

    // If the request was rejected but we have more attempts then reschedule the
    // job and use `delaySeconds` to wait until the right time to retry.
    //
    // We need this since if status is `Rejected` there's no job in the SQS queue
    // which SQS will keep retrying. So we manually need to make sure we're
    // rescheduling retries. We don't need to reschedule `Pending` jobs because SQS
    // should manage retrying `Pending` jobs we lose track of (e.g. because of a
    // process crash).
    if (
        eventItem.attempt.status.type === "Rejected" &&
        eventItem.attempt.number < botWebhookMaxRetryCount
    ) {
        const retryTime = getBotWebhookRetryTime(
            eventItem.attempt.number,
            eventItem.attempt.status.endTime,
        );

        await context.jobs.sendAndWait(job, {
            delaySeconds: Math.max(0, Math.ceil((retryTime - Date.now()) / 1000)),
        });
    }
}

/**
 * Only one process in our distributed system is allowed to make a webhook call
 * for a given event at a time. So before we call the webhook claim a "lease"
 * using the webhook event item.
 *
 * Leasing is successful if the event item doesn't exist or is in a rejected
 * state and has more retries. We can make a new webhook call after this.
 * Leasing is unsuccessful if there's record of a pending attempt in the bot
 * webhook table.
 */
function leaseBotWebhookEventItem(
    job: CallBotWebhookJobDescription,
    eventItem: BotWebhookEventItem | null,
): {
    hasLease: boolean;
    eventItem: BotWebhookEventItem;
} {
    const currentTime = new Date();

    // If we haven't seen the event yet then we can call the webhook.
    if (!eventItem) {
        return {
            hasLease: true,
            eventItem: {
                partitionType: "BotSpace",
                sortRangeType: "Event",
                botId: job.botId,
                spaceId: job.spaceId,
                eventId: job.eventId,
                event: job.event,
                attempt: {
                    number: 1,
                    startTime: currentTime,
                    status: {type: "Pending"},
                },
                // Delete the event after 30 days. We don't need to keep a record longer
                // than that.
                expirationTime: addDays(currentTime, 30),
            },
        };
    }

    // Mark a timed out attempt as rejected.
    if (
        eventItem.attempt.status.type === "Pending" &&
        eventItem.attempt.startTime.getTime() + botWebhookRequestTimeoutMs <= currentTime.getTime()
    ) {
        eventItem = {
            ...eventItem,
            attempt: {
                ...eventItem.attempt,
                status: {
                    type: "Rejected",
                    endTime: new Date(
                        eventItem.attempt.startTime.getTime() + botWebhookRequestTimeoutMs,
                    ),
                    reason: "DeadlineExceeded",
                },
            },
        };
    }

    // If the previous attempt was rejected (time out counts as rejected) and our
    // retry wait time has passed then start a new attempt.
    if (
        eventItem.attempt.status.type === "Rejected" &&
        eventItem.attempt.number < botWebhookMaxRetryCount &&
        getBotWebhookRetryTime(eventItem.attempt.number, eventItem.attempt.status.endTime) <=
            currentTime.getTime()
    ) {
        return {
            hasLease: true,
            eventItem: {
                ...eventItem,
                attempt: {
                    number: eventItem.attempt.number + 1,
                    startTime: currentTime,
                    status: {type: "Pending"},
                },
            },
        };
    }

    return {
        hasLease: false,
        eventItem,
    };
}

/**
 * We're allowed to call the webhook! Leasing the event was successful, we're
 * the only process in our distributed system allowed to make a call, so go
 * ahead and make the call.
 */
async function actuallyCallBotWebhook(
    context: Context<ServerSystemActionContextModules & {botWebhook: BotWebhookContextModule}>,
    webhookUrl: string,
    eventItem: BotWebhookEventItem,
    job: CallBotWebhookJobDescription,
) {
    const attemptNumber = eventItem.attempt.number;
    const botWebhookUrl = new URL(webhookUrl);

    const room = parseApiBotWebhookEventIntoMessageRoom(job.event);

    let scope: BotTokenPayloadScope;

    switch (room.type) {
        case "Chat":
            scope = {type: "Chat", chatId: room.id};
            break;
        case "DocumentCommentThread":
            scope = {type: "Document", documentId: room.id};
            break;
        case "Post":
            scope = {type: "Post", postId: room.id};
            break;
        case "Task":
            scope = {type: "Task", taskId: room.id};
            break;
        default:
            throw exhaustive(room);
    }

    // Signing this token grants the bot access to `roomPath`! We assume whoever
    // scheduled this job was certain the bot has access to `roomPath`.
    const accessToken = await context.botWebhook.dangerouslySignLongLivedToken({
        type: "Bot",
        spaceId: job.spaceId,
        accountId: job.botAccountId,
        scope,
    });

    const requestBody: ApiBotWebhookRequestBody = {
        spaceId: job.spaceId,
        botId: job.botId,
        botAccountId: job.botAccountId,
        // TODO(calebmer, #public-api): Remove `accountId` after this commit deploys.
        // It's only here for backwards compatibility purposes.
        accountId: job.botAccountId,
        accessToken,
        attempt: attemptNumber,
        eventId: job.eventId,
        event: job.event,
    };

    const abortController = new AbortController();

    // Rejected reason starts as `Unavailable`. Since if `fetch()` throws that's
    // usually a network failure.
    let rejectedReason: "DeadlineExceeded" | "Unavailable" | "Internal" | "ServerErrorStatusCode" =
        "Unavailable";

    const timeout = createTimeout(() => {
        rejectedReason = "DeadlineExceeded";
        abortController.abort(new DeadlineExceededError(`Webhook request timed out`));
    }, botWebhookRequestTimeoutMs);

    try {
        // TODO(calebmer, #public-api): When we start making requests to third-parties
        // we don't want to expose the IP address of our AWS EC2 instances. Right now
        // our AWS EC2 instances lives in a public VPC so if you have the IP address
        // you'll be able to make requests to our servers which might be a problem.
        //
        // TODO(calebmer, #public-api): Tracing needs to behave differently when
        // calling third-party services. We shouldn't use `AgentService` as the
        // `serviceName` and maybe the route should be `/*` since we don't know the
        // route structure of third-party services.
        await fetchWithTracer(
            context.tracer.getTracer(),
            botWebhookUrl,
            {
                serviceName: "AgentService",
                route: botWebhookUrl.pathname,
                signal: abortController.signal,
                method: "POST",
                headers: {
                    // 1.0.0 is the same version number that's in `api_specification.yaml`. If we
                    // change the API version we should consider changing the user agent here too.
                    "user-agent": "Alpine-API/1.0.0",
                    "content-type": "application/json",
                },
                body: JSON.stringify(requestBody),
            },
            async response => {
                // We don't use the response body. Cancel the stream so if the server returns a
                // big response payload we don't pay for it.
                //
                // The webhook is responsible for calling any write methods on the API (e.g.
                // `POST /chats/{id}/messages`) to update the app in response to the webhook
                // event.
                await response.body?.cancel();

                // Only retry 5xx errors. We consider 2xx, 3xx, and 4xx status codes as
                // successful delivery. Status codes like 400 and 401 (unauthorized) probably
                // mean the recipient server is misconfigured.
                if (response.status >= 500) {
                    rejectedReason = "ServerErrorStatusCode";
                    throw new UnknownError(`Webhook request failed with status ${response.status}`);
                }
            },
        );

        timeout.clear();

        // If we throw after this point, it's an internal error due to a bug in
        // our code.
        rejectedReason = "Internal";

        // Unit test helper for simulating a process crash.
        if (import.meta.jest && isProcessCallBotWebhookJobCrashSimulatedForTest) return;

        await BotWebhookEventsTable.updateItem(
            context,
            eventItem,
            eventItem => {
                // Make sure the event is still in our expected state.
                //
                // Defends against another `processCallBotWebhookJob()` running, deciding the
                // call has timed out (maybe because of clock skew), and updating to a
                // `Rejected` state or `Pending` state with a new `attemptNumber`.
                if (eventItem.attempt.status.type !== "Pending") return eventItem;
                if (eventItem.attempt.number !== attemptNumber) return eventItem;

                return {
                    ...eventItem,
                    attempt: {
                        ...eventItem.attempt,
                        status: {type: "Resolved", endTime: new Date()},
                    },
                };
            },
            {initialItem: eventItem},
        );
    } catch {
        timeout.clear();

        // Unit test helper for simulating a process crash.
        if (import.meta.jest && isProcessCallBotWebhookJobCrashSimulatedForTest) return;

        await BotWebhookEventsTable.updateItem(
            context,
            eventItem,
            eventItem => {
                // Make sure the event is still in our expected state.
                //
                // Defends against another `processCallBotWebhookJob()` running, deciding the
                // call has timed out (maybe because of clock skew), and updating to a
                // `Rejected` state or `Pending` state with a new `attemptNumber`.
                if (eventItem.attempt.status.type !== "Pending") return eventItem;
                if (eventItem.attempt.number !== attemptNumber) return eventItem;

                return {
                    ...eventItem,
                    attempt: {
                        ...eventItem.attempt,
                        status: {type: "Rejected", endTime: new Date(), reason: rejectedReason},
                    },
                };
            },
            {initialItem: eventItem},
        );

        // If we have more retries then send the job back to the queue with a delay so
        // we can try again.
        if (attemptNumber < botWebhookMaxRetryCount) {
            await context.jobs.sendAndWait(job, {
                delaySeconds: Math.ceil((botWebhookRetryDelayIncrementMs * attemptNumber) / 1000),
            });
        }
    }
}
