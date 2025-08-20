/* eslint-disable no-console */
import {SQSClient, SendMessageCommand} from "@aws-sdk/client-sqs";
import {JobQueueMessageBody, JobQueueMessageBodySchema} from "~/server/jobs/core/job_sender.js";
import {InvalidArgumentError} from "~/shared/error/error.js";

type ScheduleDeployLambdaInputEvent = {
    commitSha?: string;
};

export async function handler({commitSha}: ScheduleDeployLambdaInputEvent): Promise<void> {
    try {
        const jobQueueUrl = process.env.JOB_QUEUE_URL;
        const awsRegion = process.env.AWS_REGION;

        if (!jobQueueUrl) {
            throw new InvalidArgumentError("JOB_QUEUE_URL environment variable is required");
        }

        if (!awsRegion) {
            throw new InvalidArgumentError("AWS_REGION environment variable is required");
        }

        if (!commitSha) {
            throw new InvalidArgumentError("commitSha is required in the invocation");
        }

        console.log(`Scheduling deploy for commit ${commitSha}`);

        const sqsClient = new SQSClient({
            region: awsRegion,
        });

        const messageBody: JobQueueMessageBody = {
            type: "Maintenance",
            sendTime: new Date(),
            delaySeconds: 0,
            job: {
                type: "ScheduleDeploy",
                commitSha,
            },
            tracerContext: null,
        };

        console.log(`Sending message: ${JSON.stringify(messageBody, null, 2)}`);
        const command = new SendMessageCommand({
            QueueUrl: jobQueueUrl,
            MessageBody: JSON.stringify(JobQueueMessageBodySchema.serialize(messageBody)),
        });

        await sqsClient.send(command);
        console.log(`Successfully scheduled deploy for commit ${commitSha}`);
    } catch (error) {
        console.error("Failed to schedule deploy");
        console.error(error);
    }
}
