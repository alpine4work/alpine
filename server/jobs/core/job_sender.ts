import {SQSClient, SendMessageBatchCommand} from "@aws-sdk/client-sqs";
import {JobDescription, JobDescriptionSchema} from "~/server/jobs/core/job_description.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {UnknownError} from "~/shared/error/error.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";
import {TracerPropagationContextSchema} from "~/shared/tracer/tracer_propagation_context_schema.js";

// The maximum number of messages `SendMessageBatch` will accept is 10.
// https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_SendMessageBatch.html
const maxSendMessageBatchCount = 10;

// 200ms is the default timeout for the AWS Java buffered SQS client (see
// `maxBatchOpenMs`).
// https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-client-side-buffering-request-batching.html
const sendMessageBatchTimeoutMs = 200;

export const JobQueueMessageBodySchema = Schema.object({
    sendTime: Schema.date,
    delaySeconds: Schema.integer,
    job: JobDescriptionSchema,
    tracerContext: TracerPropagationContextSchema,
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

export abstract class JobSenderBase {
    /**
     * Sends a job to our job queue for processing. Will be batched with other jobs
     * sent from the same process in a short window of time.
     *
     * The first job in a batch will need to wait 200ms before it can be sent as we
     * accumulate other jobs.
     *
     * Doesn't guarantee the job was delivered. If the process unexpectedly ends
     * you may return a successful result to the user without the job being saved
     * in our queue. If you want to guarantee message delivery call
     * `sendImmediately()` and await.
     */
    public abstract send(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        job: JobDescription,
        options?: {delaySeconds?: number},
    ): void;

    /**
     * Sends a job to our job queue for processing. Will be batched with other jobs
     * sent from the same process in a short window of time.
     *
     * The first job in a batch will need to wait 200ms before it can be sent as we
     * accumulate other jobs.
     *
     * Returns a promise that resolves only once the job has been sent to the
     * queue. This means you may have to wait up to 200ms if this is the first job
     * in a batch! Avoid this function if you need fast performance.
     */
    public abstract sendAndWait(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        job: JobDescription,
        options?: {delaySeconds?: number},
    ): Promise<void>;

    /**
     * Sends a job to our job queue for processing. Will not wait to batch with
     * other jobs and will be send to our queue immediately. If there's a pending
     * batch we'll send the batch along with this new job.
     *
     * Use this if you need to guarantee to the user that the job was delivered to
     * the queue. Once delivered to the queue the job will execute (if it errs we
     * retry) but the duration it will take to execute is not guaranteed.
     *
     * You can also use this to skip the maximum 200ms wait time for new jobs in
     * the queue. However, if your work needs to happen immediately a queue may not
     * even be a good idea given it can take a while for the job service to process
     * your job.
     */
    public abstract sendImmediately(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        job: JobDescription,
        options?: {delaySeconds?: number},
    ): Promise<void>;
}

/**
 * Sends background jobs to our job queue for processing. Will batch jobs sent
 * within a short window of time.
 */
export class JobSender extends JobSenderBase {
    private readonly _queueUrl: string;
    private readonly _sqsClient: SQSClient;

    private _messageBatch: JobSenderMessageBatch | null = null;

    constructor({queueUrl}: {queueUrl: string}) {
        super();
        this._queueUrl = queueUrl;
        this._sqsClient = new SQSClient({endpoint: new URL("/", queueUrl).toString()});
    }

    public override send(
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

    public override sendAndWait(
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

    public override async sendImmediately(
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
}
