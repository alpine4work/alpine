import {SQSClient, SendMessageCommand} from "@aws-sdk/client-sqs";
import type {APIGatewayProxyResult} from "aws-lambda";
import {JobQueueMessageBody, JobQueueMessageBodySchema} from "~/server/jobs/core/job_sender.js";
import {InvalidArgumentError} from "~/shared/error/error.js";

type ScheduleDeployLambdaInputEvent = {
    commitSha?: string;
};

export async function handler({
    commitSha,
}: ScheduleDeployLambdaInputEvent): Promise<APIGatewayProxyResult> {
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

        const command = new SendMessageCommand({
            QueueUrl: jobQueueUrl,
            MessageBody: JSON.stringify(JobQueueMessageBodySchema.serialize(messageBody)),
            DelaySeconds: 10,
        });

        const result = await sqsClient.send(command);

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "Deploy scheduled successfully",
                messageId: result.MessageId,
                commitSha,
            }),
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: "Failed to schedule deploy",
                details: error instanceof Error ? error.message : String(error),
            }),
        };
    }
}
