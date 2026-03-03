import {SQSClient, SendMessageBatchCommand, SendMessageCommand} from "@aws-sdk/client-sqs";
import {JobDescription, JobDescriptionSchema} from "~/server/jobs/core/job_description.js";
import {JobQueueName, jobQueueNameByType} from "~/server/jobs/core/job_queue_name.js";
import {
    MaintenanceJobDescription,
    MaintenanceJobDescriptionSchema,
} from "~/server/jobs/core/maintenance_job_description.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {UnknownError} from "~/shared/error/error.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {schedulePostPromiseJob} from "~/shared/helpers/async/schedule_post_promise_job.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";
import {TracerPropagationContextSchema} from "~/shared/tracer/tracer_propagation_context_schema.js";

// The maximum number of messages `SendMessageBatch` will accept is 10.
// https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_SendMessageBatch.html
const maxSendMessageBatchCount = 10;

export type JobQueueMessageBody = SchemaType<typeof JobQueueMessageBodySchema>;

export const JobQueueMessageBodySchema = Schema.union({
    Regular: Schema.object({
        type: Schema.value("Regular"),
        sendTime: Schema.date,
        delaySeconds: Schema.integer,
        job: JobDescriptionSchema,
        tracerContext: TracerPropagationContextSchema.nullable(),
    }),

    // Maintenance jobs in production are sent to our job queue by AWS EventBridge
    // which is configured in `aws_cron_jobs.ts`. In development maintenance jobs are
    // sent to our job queue by `scheduleDevCronJobs()`.
    //
    // If you are updating the schema for maintenance jobs then make sure to update
    // both of these code paths. `aws_cron_jobs.ts` is not type checked against this
    // schema.
    Maintenance: Schema.object({
        type: Schema.value("Maintenance"),
        sendTime: Schema.date,
        delaySeconds: Schema.integer,
        job: MaintenanceJobDescriptionSchema,
        tracerContext: TracerPropagationContextSchema.nullable(),
    }),
});

export const FileProcessorJobQueueMessageBodySchema = Schema.object({
    sendTime: Schema.date,
    spaceId: Schema.id<SpaceId>(),
    fileId: Schema.id<FileId>(),
    tracerContext: TracerPropagationContextSchema.nullable(),
});

type JobSenderMessageBatch = {
    messages: Array<{
        job: JobDescription;
        delaySeconds: number;
        tracer: TracerBase;
        promiseResolver: PromiseResolver<void>;
    }>;
    cancel: () => void;
};

export interface JobSenderBase {
    /**
     * Sends a job to our job queue for processing. Will be batched with other jobs
     * sent synchronously.
     *
     * Doesn't guarantee the job was delivered. If the process unexpectedly ends you
     * may return a successful result to the user without the job being saved in our
     * queue. If you want to guarantee message delivery call `sendAndWait()`.
     *
     * Before 2025-08-06 we used to wait 100ms and batch together any jobs sent during
     * this time window. However, adding this delay hurts jobs where latency matters
     * (e.g. `NotificationEvent` where the job is responsible for sending push
     * notifications and bot webhooks). Batching every 100ms was purely a cost
     * optimization. Given SQS is cheap compared to other services we use (like
     * DynamoDB) our new perspective is we're going to favor speed over cost until SQS
     * costs become an issue.
     */
    send(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        job: JobDescription,
        options?: {delaySeconds?: number},
    ): void;

    /**
     * Sends a job to our job queue for processing. Will be batched with other jobs
     * sent synchronously.
     *
     * Returns a promise that resolves only once the job has been sent to the queue.
     * When this function resolves, you're guaranteed the message has been delivered.
     *
     * Before 2025-08-06 we used to wait 100ms and batch together any jobs sent during
     * this time window. However, adding this delay hurts jobs where latency matters
     * (e.g. `NotificationEvent` where the job is responsible for sending push
     * notifications and bot webhooks). Batching every 100ms was purely a cost
     * optimization. Given SQS is cheap compared to other services we use (like
     * DynamoDB) our new perspective is we're going to favor speed over cost until SQS
     * costs become an issue.
     */
    sendAndWait(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        job: JobDescription,
        options?: {delaySeconds?: number},
    ): Promise<void>;

    /**
     * Send a maintenance job to our job queue. It's dangerous to schedule maintenance
     * jobs since maintenance jobs have access to all data across our system! Users
     * should not be able to arbitrarily schedule maintenance jobs.
     */
    dangerouslySendMaintenance(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        job: MaintenanceJobDescription,
        options?: {delaySeconds?: number},
    ): Promise<void>;
}

/**
 * Sends background jobs to our job queue for processing. Will batch jobs sent
 * within a short window of time.
 */
export class JobSender implements JobSenderBase {
    private readonly _defaultQueueUrl: string;
    private readonly _defaultSqsClient: SQSClient;

    // TODO(ifitzsimmons, 2025-07-30, #file-processor-service-migration): Remove
    // original job queue url
    private readonly _fileProcessorQueueUrl: string;
    private readonly _fileProcessorSqsClient: SQSClient;

    private readonly _fileProcessorHeavyQueueUrl: string;
    private readonly _fileProcessorHeavySqsClient: SQSClient;

    private readonly _fileProcessorLightQueueUrl: string;
    private readonly _fileProcessorLightSqsClient: SQSClient;

    private readonly _messageBatchByQueueName = new Map<JobQueueName, JobSenderMessageBatch>();

    constructor({
        region,
        queueUrl: defaultQueueUrl,
        fileProcessorQueueUrl,
        fileProcessorHeavyQueueUrl,
        fileProcessorLightQueueUrl,
    }: {
        region: string;
        queueUrl: string;
        fileProcessorQueueUrl: string;
        fileProcessorHeavyQueueUrl: string;
        fileProcessorLightQueueUrl: string;
    }) {
        const defaultEndpoint = new URL("/", defaultQueueUrl).toString();
        const fileProcessorEndpoint = new URL("/", fileProcessorQueueUrl).toString();
        const fileProcessorHeavyEndpoint = new URL("/", fileProcessorHeavyQueueUrl).toString();
        const fileProcessorLightEndpoint = new URL("/", fileProcessorLightQueueUrl).toString();

        this._defaultQueueUrl = defaultQueueUrl;
        this._defaultSqsClient = new SQSClient({
            region,
            endpoint: defaultEndpoint,
        });

        this._fileProcessorQueueUrl = fileProcessorQueueUrl;
        this._fileProcessorSqsClient =
            defaultEndpoint === fileProcessorEndpoint
                ? this._defaultSqsClient
                : new SQSClient({
                      region,
                      endpoint: fileProcessorEndpoint,
                  });

        this._fileProcessorHeavyQueueUrl = fileProcessorHeavyQueueUrl;
        this._fileProcessorHeavySqsClient = new SQSClient({
            region,
            endpoint: fileProcessorHeavyEndpoint,
        });

        this._fileProcessorLightQueueUrl = fileProcessorLightQueueUrl;
        this._fileProcessorLightSqsClient = new SQSClient({
            region,
            endpoint: fileProcessorLightEndpoint,
        });
    }

    public send(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        job: JobDescription,
        options?: {delaySeconds?: number},
    ): void {
        context.process.waitUntil(
            this._send(context, job, options).catch(() => {
                // Errors are reported in the "Send job" span. We don't need to log an uncaught
                // `waitUntil()` error as well. We do still want to make sure the process stays
                // alive until the job finishes sending though.
            }),
        );
    }

    public sendAndWait(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        job: JobDescription,
        options?: {delaySeconds?: number},
    ): Promise<void> {
        return this._send(context, job, options);
    }

    private _send(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        job: JobDescription,
        {delaySeconds = 0}: {delaySeconds?: number} = {},
    ): Promise<void> {
        const tracer = context.tracer.getTracer();
        const promiseResolver = createPromiseResolver();

        const queueName = jobQueueNameByType[job.type];

        const messageBatch = getOrSetDefaultMapValue(
            this._messageBatchByQueueName,
            queueName,
            () => {
                let isCancelled = false;

                schedulePostPromiseJob(() => {
                    if (isCancelled) return;

                    this._messageBatchByQueueName.delete(queueName);
                    void this._sendBatch(
                        context.tracer.getTracer(),
                        queueName,
                        messageBatch.messages,
                    );
                });

                const messageBatch: JobSenderMessageBatch = {
                    messages: [],
                    cancel: () => {
                        isCancelled = true;
                    },
                };

                return messageBatch;
            },
        );

        messageBatch.messages.push({
            job,
            delaySeconds,
            tracer,
            promiseResolver,
        });

        if (messageBatch.messages.length === maxSendMessageBatchCount) {
            this._messageBatchByQueueName.delete(queueName);
            messageBatch.cancel();

            void this._sendBatch(context.tracer.getTracer(), queueName, messageBatch.messages);
        }

        return promiseResolver.promise;
    }

    private async _sendBatch(
        tracer: TracerBase,
        queueName: JobQueueName,
        originalMessages: JobSenderMessageBatch["messages"],
    ) {
        assert(originalMessages.length > 0);

        const messages = originalMessages.map(message => {
            const {span, finishSpan} = message.tracer.startSpan(`Send job ${message.job.type}`);

            span.addData({
                jobs: {
                    type: message.job.type,
                    queueName,
                    // NOTE(calebmer): I put this in the `jobs` namespace instead of the `aws.sqs`
                    // namespace because in SQS this can be configured at the queue or message level
                    // but in the job framework it's always configured at the job level. An `aws.sqs`
                    // tracer would need to look at queue configuration to get the correct value
                    // whereas we should always know for a job.
                    delaySeconds: message.delaySeconds,
                },
                aws: {
                    sqs: {
                        messageCount: originalMessages.length,
                    },
                },
            });

            return {
                ...message,
                span,
                finishSpan,
            };
        });

        try {
            const currentTime = new Date();

            let sqsClient;
            let queueUrl;
            let sqsQueueName;
            switch (queueName) {
                case "Default": {
                    sqsClient = this._defaultSqsClient;
                    queueUrl = this._defaultQueueUrl;
                    sqsQueueName = "JobQueue";
                    break;
                }
                case "FileProcessor": {
                    sqsClient = this._fileProcessorSqsClient;
                    queueUrl = this._fileProcessorQueueUrl;
                    sqsQueueName = "FileProcessorJobQueue";
                    break;
                }
                case "FileProcessorHeavy": {
                    sqsClient = this._fileProcessorHeavySqsClient;
                    queueUrl = this._fileProcessorHeavyQueueUrl;
                    sqsQueueName = "FileProcessorHeavyJobQueue";
                    break;
                }
                case "FileProcessorLight": {
                    sqsClient = this._fileProcessorLightSqsClient;
                    queueUrl = this._fileProcessorLightQueueUrl;
                    sqsQueueName = "FileProcessorLightJobQueue";
                    break;
                }
                default:
                    throw exhaustive(queueName);
            }

            const output = await tracer.withSpan(
                `SQS SendMessageBatch ${sqsQueueName}`,
                async span => {
                    span.addData({
                        jobs: {queueName},
                        aws: {
                            sqs: {
                                queueName: sqsQueueName,
                                messageCount: messages.length,
                            },
                        },
                    });

                    const output = await sqsClient.send(
                        new SendMessageBatchCommand({
                            QueueUrl: queueUrl,
                            Entries: messages.map((message, messageIndex) => ({
                                Id: String(messageIndex),
                                MessageBody: JSON.stringify(
                                    JobQueueMessageBodySchema.serialize({
                                        type: "Regular",
                                        sendTime: currentTime,
                                        delaySeconds: message.delaySeconds,
                                        job: message.job,
                                        tracerContext: message.span.getPropagationContext(),
                                    }),
                                ),
                                DelaySeconds: message.delaySeconds,
                            })),
                        }),
                    );

                    if (output.Successful?.length === 1 && (output.Failed?.length ?? 0) === 0) {
                        span.addData({aws: {sqs: {messageId: output.Successful[0]!.MessageId}}});
                    }

                    return output;
                },
            );

            for (const entry of output.Failed ?? []) {
                const messageIndex = parseInt(entry.Id!, 10);
                const message = messages[messageIndex]!;

                const error = new UnknownError(
                    `Failed to send SQS message${
                        typeof entry.Message === "string" ? `: ${entry.Message}` : ""
                    }${typeof entry.Code === "string" ? ` (code: ${entry.Code})` : ""}`,
                );

                message.span.addException(error);
                message.finishSpan();
                message.promiseResolver.reject(error);
            }

            for (const entry of output.Successful ?? []) {
                const messageIndex = parseInt(entry.Id!, 10);
                const message = messages[messageIndex]!;

                message.span.addData({aws: {sqs: {messageId: entry.MessageId}}});
                message.finishSpan();
                message.promiseResolver.resolve();
            }
        } catch (error) {
            for (const message of messages) {
                message.span.addException(error);
                message.finishSpan();
                message.promiseResolver.reject(error);
            }
        }
    }

    /**
     * Send a maintenance job to our job queue. It's dangerous to schedule maintenance
     * jobs since maintenance jobs have access to all data across our system! Users
     * should not be able to arbitrarily schedule maintenance jobs.
     */
    public dangerouslySendMaintenance(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        job: MaintenanceJobDescription,
        {delaySeconds = 0}: {delaySeconds?: number} = {},
    ): Promise<void> {
        return context.tracer.withSpan(
            `Send maintenance job ${job.type}`,
            async (context, span) => {
                const currentTime = new Date();

                span.addData({
                    jobs: {
                        type: `Maintenance:${job.type}`,
                        delaySeconds,
                    },
                    aws: {
                        sqs: {
                            messageCount: 1,
                        },
                    },
                });

                const sqsQueueName = "JobQueue";

                const output = await context.tracer.withSpan(
                    `SQS SendMessage ${sqsQueueName}`,
                    async (context, span) => {
                        span.addData({
                            jobs: {queueName: "Default"},
                            aws: {sqs: {queueName: sqsQueueName}},
                        });

                        const output = await this._defaultSqsClient.send(
                            new SendMessageCommand({
                                QueueUrl: this._defaultQueueUrl,
                                MessageBody: JSON.stringify(
                                    JobQueueMessageBodySchema.serialize({
                                        type: "Maintenance",
                                        sendTime: currentTime,
                                        delaySeconds,
                                        job,
                                        tracerContext: span.getPropagationContext(),
                                    }),
                                ),
                                DelaySeconds: delaySeconds,
                            }),
                        );

                        span.addData({
                            aws: {sqs: {messageId: output.MessageId}},
                        });

                        return output;
                    },
                );

                span.addData({aws: {sqs: {messageId: output.MessageId}}});
            },
        );
    }
}
