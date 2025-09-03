import {randomUUID} from "crypto";
import {JobDescription} from "~/server/jobs/core/job_description.js";
import {JobQueueName, JobTypeByQueueName} from "~/server/jobs/core/job_queue_name.js";
import {JobQueueConsumer} from "~/server/jobs/queue/consumer/job_queue_consumer.js";
import {LambdaActionContext} from "~/server/lambda/helpers/lambda_action_context.js";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {DeadlineExceededError} from "~/shared/error/error.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export type LambdaLocalSqsConsumerOptions = {
    /**
     * The Lambda handler function to wrap
     */
    handler: <T extends JobDescription & {type: JobTypeByQueueName[JobQueueName]}>(
        processContext: LambdaActionContext,
        {
            job,
            jobStartTime,
            span,
            sqsMessageId,
        }: {
            job: T;
            jobStartTime: Date;
            span: TracerSpan;
            sqsMessageId: string;
        },
    ) => Promise<void>;

    /**
     * Local SQS server configuration
     */
    sqs: {
        endpoint: string;
        region: string;
        queueUrl: string;
        queueName: JobQueueName;
    };

    /**
     * function name for logging/identification
     */
    functionName: string;

    /**
     * Optional timeout in milliseconds (defaults to 30000ms)
     */
    timeoutMs?: number;

    /**
     * Maximum number of messages to receive in a single batch (1-10)
     */
    maxMessages?: number;

    /**
     * Wait time for long polling in seconds (0-20)
     */
    waitTimeSeconds?: number;

    /**
     * Visibility timeout in seconds
     */
    visibilityTimeoutSeconds?: number;
};

/**
 * Generic SQS consumer wrapper for AWS Lambda functions that expect SQSEvent.
 * Polls local SQS for messages and invokes the Lambda handler.
 */
export function createLambdaLocalSqsConsumer(
    context: LambdaActionContext,
    shutdownManager: ShutdownManager,
    {handler, sqs, timeoutMs = 30000, functionName}: LambdaLocalSqsConsumerOptions,
) {
    const consumer = JobQueueConsumer.start(context, {
        region: "us-east-1",
        queueName: sqs.queueName,
        queueUrl: sqs.queueUrl,
        maxFiberCount: 1,
        maxFiberMessageCount: 1,

        processJob: async (actionContext, job, jobStartTime, span) => {
            let timeout: NodeJS.Timeout;
            const timeoutPromise = new Promise<never>((_, reject) => {
                timeout = setTimeout(() => {
                    reject(
                        new DeadlineExceededError(
                            quote`Lambda function ${functionName} timed out after ${timeoutMs}ms`,
                        ),
                    );
                }, timeoutMs);
            });

            // Call the Lambda handler with timeout
            await Promise.race([
                handler(actionContext, {
                    job,
                    jobStartTime,
                    span,
                    sqsMessageId: randomUUID(),
                }),
                timeoutPromise,
            ]).finally(() => clearTimeout(timeout));
        },
    });

    shutdownManager.registerListenerForIngressTraffic(
        quote`Stopping job queue consumer: ${functionName}`,
        async () => {
            await consumer.stop();
        },
    );

    return consumer;
}
