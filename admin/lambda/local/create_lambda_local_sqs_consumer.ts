import {Context as LambdaContext, SQSEvent, SQSHandler, SQSRecord} from "aws-lambda";
import {randomUUID} from "crypto";
import {createLambdaEventMockWithUnimplementedErrors} from "~/admin/lambda/local/internal/create_lambda_event_mock_with_unimplemented_errors.js";
import {createLambdaLocalEventContext} from "~/admin/lambda/local/internal/create_lambda_local_event_context.js";
import {JobDescription} from "~/server/jobs/core/job_description.js";
import {JobQueueName} from "~/server/jobs/core/job_queue_name.js";
import {JobQueueConsumer} from "~/server/jobs/queue/consumer/job_queue_consumer.js";
import {LambdaActionContext} from "~/server/lambda/helpers/lambda_action_context.js";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {InternalError} from "~/shared/error/error.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {quote} from "~/shared/helpers/string/quote.js";

export type LambdaLocalSqsConsumerOptions = {
    /**
     * The Lambda handler function to wrap
     */
    handler: SQSHandler;

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

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        processJob: async (actionContext, job, jobStartTime, span) => {
            await processJob({job, handler, functionName, timeoutMs});
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

async function processJob({
    job,
    handler,
    functionName,
    timeoutMs,
}: {
    job: JobDescription;
    handler: SQSHandler;
    functionName: string;
    timeoutMs: number;
}) {
    const requestId = randomUUID();
    const event: SQSEvent = createSqsEvent(job);
    const lambdaContext: LambdaContext = createLambdaLocalEventContext({
        functionName,
        requestId,
        timeoutMs,
    });

    // NOTE(ifitzsimmons, #unimplemented-lambda-handler-callback)
    const response = await handler(event, lambdaContext, noop);

    if (response?.batchItemFailures && response.batchItemFailures.length > 0) {
        throw new InternalError(
            `Lambda SQS consumer (${functionName}) failed to process ${response.batchItemFailures.length} messages`,
        );
    }
}

function createSqsEvent(job: JobDescription): SQSEvent {
    const requestId = randomUUID();

    const sqsRecordBase: Partial<SQSRecord> = {
        messageId: requestId,
        body: JSON.stringify({job}),
    };
    const sqsRecord = createLambdaEventMockWithUnimplementedErrors(sqsRecordBase, "SQSRecord");
    return {
        Records: [sqsRecord],
    };
}
