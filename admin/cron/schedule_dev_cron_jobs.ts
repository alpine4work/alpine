import {SQSClient, SendMessageCommand} from "@aws-sdk/client-sqs";
import cron from "node-cron";
import {cronJobs} from "~/admin/cron/cron_jobs.js";
import {JobQueueMessageBody, JobQueueMessageBodySchema} from "~/server/jobs/core/job_sender.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * In development, schedule our cron jobs to run at their specified interval.
 */
export function scheduleDevCronJobs({
    jobQueueUrl,
    logError,
}: {
    jobQueueUrl: string;
    logError: (reason: string, error: unknown) => void;
}) {
    assert(process.env.NODE_ENV === "development");

    const sqsClient = new SQSClient({
        region: "us-east-1",
        endpoint: new URL("/", jobQueueUrl).toString(),
    });

    for (const cronJob of cronJobs) {
        let cronExpression;
        switch (cronJob.rate.type) {
            case "Minutes":
                cronExpression = `*/${cronJob.rate.minutes} * * * *`;
                break;
            case "Hours":
                cronExpression = `* */${cronJob.rate.hours} * * *`;
                break;
            default:
                throw exhaustive(cronJob.rate);
        }

        cron.schedule(cronExpression, () => {
            const messageBody: JobQueueMessageBody = {
                type: "Maintenance",
                sendTime: new Date(),
                delaySeconds: 0,
                job: cronJob.job,
                tracerContext: null,
            };

            sqsClient
                .send(
                    new SendMessageCommand({
                        QueueUrl: jobQueueUrl,
                        MessageBody: JSON.stringify(
                            JobQueueMessageBodySchema.serialize(messageBody),
                        ),
                        DelaySeconds: messageBody.delaySeconds,
                    }),
                )
                .catch(error => {
                    logError("Couldn’t send cron job", error);
                });
        });
    }
}
