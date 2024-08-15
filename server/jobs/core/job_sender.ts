import {SQSClient, SendMessageBatchCommand, SendMessageCommand} from "@aws-sdk/client-sqs";
import {JobDescription, JobDescriptionSchema} from "~/server/jobs/core/job_description.js";
import {
    MaintenanceJobDescription,
    MaintenanceJobDescriptionSchema,
} from "~/server/jobs/core/maintenance_job_description.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {UnknownError} from "~/shared/error/error.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";
import {TracerPropagationContextSchema} from "~/shared/tracer/tracer_propagation_context_schema.js";

// The maximum number of messages `SendMessageBatch` will accept is 10.
// https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_SendMessageBatch.html
const maxSendMessageBatchCount = 10;

// 200ms is the default timeout for the AWS Java buffered SQS client (see
// `maxBatchOpenMs`).
//
// We're shorter since for jobs like notification event processing we want to
// feel like the notification is being delivered immediately.
//
// https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-client-side-buffering-request-batching.html
const sendMessageBatchTimeoutMs = 100;

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
    // which is configured in `aws_cron_jobs.ts`. In development maintenance jobs
    // are sent to our job queue by `scheduleDevCronJobs()`.
    //
    // If you are updating the schema for maintenance jobs then make sure to update
    // both of these code paths. `aws_cron_jobs.ts` is not type checked against
    // this schema.
    Maintenance: Schema.object({
        type: Schema.value("Maintenance"),
        sendTime: Schema.date,
        delaySeconds: Schema.integer,
        job: MaintenanceJobDescriptionSchema,
        tracerContext: TracerPropagationContextSchema.nullable(),
    }),
});

type JobSenderMessageBatch = {
    timeout: Timeout;
    messages: Array<{
        job: JobDescription;
        delaySeconds: number;
        tracer: TracerBase;
        promiseResolver: PromiseResolver<void>;
    }>;
};

export interface JobSenderBase {
    /**
     * Same as `JobContextModule.send()` but doesn't authorize that we're allowed to
     * send the job.
     */
    dangerouslySendWithoutAuthorization(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        job: JobDescription,
        options?: {delaySeconds?: number},
    ): void;

    /**
     * Same as `JobContextModule.sendAndWait()` but doesn't authorize that we're
     * allowed to send the job.
     */
    dangerouslySendAndWaitWithoutAuthorization(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        job: JobDescription,
        options?: {delaySeconds?: number},
    ): Promise<void>;

    /**
     * Same as `JobContextModule.sendImmediately()` but doesn't authorize that we're
     * allowed to send the job.
     */
    dangerouslySendImmediatelyWithoutAuthorization(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        job: JobDescription,
        options?: {delaySeconds?: number},
    ): Promise<void>;
}

/**
 * Sends background jobs to our job queue for processing. Will batch jobs sent
 * within a short window of time.
 */
export class JobSender implements JobSenderBase {
    private readonly _queueUrl: string;
    private readonly _sqsClient: SQSClient;

    private _messageBatch: JobSenderMessageBatch | null = null;

    constructor({region, queueUrl}: {region: string; queueUrl: string}) {
        this._queueUrl = queueUrl;
        this._sqsClient = new SQSClient({
            region,
            endpoint: new URL("/", queueUrl).toString(),
        });
    }

    public dangerouslySendWithoutAuthorization(
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

    public dangerouslySendAndWaitWithoutAuthorization(
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

        if (this._messageBatch === null) {
            const timeout = createTimeout(() => {
                this._messageBatch = null;
                void this._sendBatch(messageBatch.messages);
            }, sendMessageBatchTimeoutMs);

            const messageBatch: JobSenderMessageBatch = {
                timeout,
                messages: [],
            };

            this._messageBatch = messageBatch;
        }

        this._messageBatch.messages.push({
            job,
            delaySeconds,
            tracer,
            promiseResolver,
        });

        if (this._messageBatch.messages.length === maxSendMessageBatchCount) {
            const messageBatch = this._messageBatch;
            this._messageBatch = null;
            messageBatch.timeout.clear();

            void this._sendBatch(messageBatch.messages);
        }

        return promiseResolver.promise;
    }

    public async dangerouslySendImmediatelyWithoutAuthorization(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        job: JobDescription,
        {delaySeconds = 0}: {delaySeconds?: number} = {},
    ): Promise<void> {
        const tracer = context.tracer.getTracer();
        const promiseResolver = createPromiseResolver();

        let messages: JobSenderMessageBatch["messages"] = [];
        if (this._messageBatch !== null) {
            const messageBatch = this._messageBatch;
            this._messageBatch = null;
            messageBatch.timeout.clear();

            messages = messageBatch.messages;
        }

        messages.push({
            job,
            delaySeconds,
            tracer,
            promiseResolver,
        });

        void this._sendBatch(messages);

        return promiseResolver.promise;
    }

    private async _sendBatch(originalMessages: JobSenderMessageBatch["messages"]) {
        assert(originalMessages.length > 0);

        const messages = originalMessages.map(message => {
            const {span, finishSpan} = message.tracer.startSpan(`Sent job ${message.job.type}`);

            span.addData({
                jobs: {
                    type: message.job.type,
                    batchSize: originalMessages.length,
                    // NOTE(calebmer): I put this in the `jobs` namespace instead of the `aws.sqs`
                    // namespace because in SQS this can be configured at the queue or message level
                    // but in the job framework it's always configured at the job level. An
                    // `aws.sqs` tracer would need to look at queue configuration to get the correct
                    // value whereas we should always know for a job.
                    delaySeconds: message.delaySeconds,
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

            const output = await this._sqsClient.send(
                new SendMessageBatchCommand({
                    QueueUrl: this._queueUrl,
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

    public dangerouslySendMaintenanceJob(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        job: MaintenanceJobDescription,
    ) {
        return context.tracer.withSpan(
            `Sent maintenance job ${job.type}`,
            async (context, span) => {
                const currentTime = new Date();
                const delaySeconds = 0;

                span.addData({
                    jobs: {
                        type: `Maintenance:${job.type}`,
                        batchSize: 1,
                        delaySeconds,
                    },
                });

                const output = await this._sqsClient.send(
                    new SendMessageCommand({
                        QueueUrl: this._queueUrl,
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

                span.addData({aws: {sqs: {messageId: output.MessageId}}});
            },
        );
    }
}
