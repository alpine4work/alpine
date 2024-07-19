import {
    ChangeMessageVisibilityBatchCommand,
    DeleteMessageBatchCommand,
    Message,
    ReceiveMessageCommand,
    SQSClient,
} from "@aws-sdk/client-sqs";
import {DynamoSystemActorContextModule} from "~/server/accounts/dynamo_actor_context_module.js";
import {
    ServerSystemActionContext,
    ServerSystemActionContextModules,
} from "~/server/context/server_action_context.js";
import {
    ServerProcessContext,
    ServerProcessContextModules,
} from "~/server/context/server_process_context.js";
import {DynamoBatchContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {TestCounter} from "~/server/helpers/test/test_counter.js";
import {JobDescription, getJobDescriptionSpaceId} from "~/server/jobs/core/job_description.js";
import {JobQueueMessageBody, JobQueueMessageBodySchema} from "~/server/jobs/core/job_sender.js";
import {MaintenanceJobDescription} from "~/server/jobs/core/maintenance_job_description.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {CancelledError, UnknownError} from "~/shared/error/error.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export const receiveMessageTestCounter = new TestCounter<void>();
export const deleteMessageBatchTestCounter = new TestCounter<void>();
export const changeMessageVisibilityBatchTestCounter = new TestCounter<void>();

/**
 * We use SQS long polling to receive messages. AWS recommends long polling and
 * recommends setting the wait time to 20 seconds.
 *
 * From: https://aws.amazon.com/sqs/faqs
 *
 * > Q: When should I use Amazon SQS long polling, and when should I use Amazon
 * >    SQS short polling?
 * >
 * > A: In almost all cases, Amazon SQS long polling is preferable to short
 * >    polling. [...]
 * >
 * > Q: What value should I use for my long-poll timeout?
 * >
 * > A: In general, you should use a maximum of 20 seconds for a long-poll
 * >    timeout. [...]
 */
const receiveMessagesWaitTimeSeconds = 20;

/**
 * AWS SQS [default visibility timeout is 30 seconds][1].
 *
 * [1]: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html
 */
// Use a 10x faster timeout in unit tests so tests that exercise message retries
// run in reasonable time.
const receiveMessagesVisibilityTimeoutSeconds = !import.meta.jest ? 30 : 3;

/**
 * The maximum number of parallel `_consume()` calls we allow. After receiving
 * some messages we immediately want to receive more while we process our current
 * batch of messages.
 *
 * Given we can consume 10 messages at a time and we can only have 10 parallel
 * `_consume()` calls at once, that means the maximum number of jobs our
 * consumer will process at once is 100 (10 * 10).
 */
const maxRunningConsumeCallCount = 10;

const stopError = new CancelledError("Job queue consumer stopped");

/**
 * Processes jobs in our job queue. Features:
 *
 * - Long polling: We use AWS SQS long polling to improve efficiency and
 *   reduce cost.
 *
 * - Auto-scaling: We dynamically launch "threads" to receive messages based on
 *   how busy the queue is and scale back down once activity subsides. "Threads"
 *   is a bit of a misnomer, instead we're launching what we call parallel
 *   "consume calls" which you can think of as more akin to lightweight
 *   [goroutines][1].
 *
 * - Heartbeats: If a message is taking a long time to process, we'll extend
 *   the message's visibility timeout so it isn't processed again by another
 *   job.
 *
 * [1]: https://go.dev/tour/concurrency/1
 */
export class JobQueueConsumer {
    private readonly _processContext: ServerProcessContext;
    private readonly _queueUrl: string;
    private readonly _sqsClient: SQSClient;
    private readonly _processJob: (
        context: ServerSystemActionContext,
        job: JobDescription,
        jobStartTime: Date,
        span: TracerSpan,
    ) => Promise<void>;
    private readonly _processMaintenanceJob: (
        context: Context<Omit<ServerSystemActionContextModules, "actor">>,
        job: MaintenanceJobDescription,
        jobStartTime: Date,
        span: TracerSpan,
    ) => Promise<void>;

    private _isStopped = false;
    private _abortController = new AbortController();
    private _runningConsumeCallCount = 0;
    private _hasPendingConsumeCall = false;
    private readonly _processPromises = new Set<Promise<void>>();

    private constructor(
        context: ServerProcessContext,
        {
            region,
            queueUrl,
            processJob,
            processMaintenanceJob,
        }: {
            region: string;
            queueUrl: string;
            processJob: (
                context: ServerSystemActionContext,
                job: JobDescription,
                jobStartTime: Date,
                span: TracerSpan,
            ) => Promise<void>;
            processMaintenanceJob: (
                context: Context<Omit<ServerSystemActionContextModules, "actor">>,
                job: MaintenanceJobDescription,
                jobStartTime: Date,
                span: TracerSpan,
            ) => Promise<void>;
        },
    ) {
        this._processContext = context;
        this._queueUrl = queueUrl;
        this._sqsClient = new SQSClient({
            region,
            endpoint: new URL("/", queueUrl).toString(),
        });
        this._processJob = processJob;
        this._processMaintenanceJob = processMaintenanceJob;
    }

    public static start(
        context: ServerProcessContext,
        options: {
            region: string;
            queueUrl: string;
            processJob: (
                context: ServerSystemActionContext,
                job: JobDescription,
                jobStartTime: Date,
                span: TracerSpan,
            ) => Promise<void>;
            processMaintenanceJob: (
                context: Context<Omit<ServerSystemActionContextModules, "actor">>,
                job: MaintenanceJobDescription,
                jobStartTime: Date,
                span: TracerSpan,
            ) => Promise<void>;
        },
    ) {
        const consumer = new JobQueueConsumer(context, options);

        consumer._processContext.process.waitUntil(consumer._consume());

        return consumer;
    }

    public async stop() {
        assert(!this._isStopped);
        this._isStopped = true;
        this._abortController.abort(stopError);

        // Wait for all our running jobs to finish.
        while (this._processPromises.size > 0) {
            await runAllPromises(this._processPromises);
        }
    }

    private async _consume() {
        assert(!this._isStopped);

        this._runningConsumeCallCount++;

        try {
            receiveMessageTestCounter.incrementForTest();

            const output = await this._sqsClient.send(
                new ReceiveMessageCommand({
                    QueueUrl: this._queueUrl,
                    VisibilityTimeout: receiveMessagesVisibilityTimeoutSeconds,
                    WaitTimeSeconds: receiveMessagesWaitTimeSeconds,
                    // SQS will not let us receive more than 10 messages at a time.
                    MaxNumberOfMessages: 10,
                }),
                {abortSignal: this._abortController.signal},
            );

            const messages = output.Messages ?? [];

            // If we got some messages, then while we process them we want to try and
            // consume more messages concurrently. Keep consuming messages until we reach
            // a max number of consume calls.
            if (!this._isStopped && messages.length > 0) {
                if (this._runningConsumeCallCount < maxRunningConsumeCallCount) {
                    this._processContext.process.waitUntil(this._consume());
                } else {
                    // The next consume call to finish will start a new consume call.
                    this._hasPendingConsumeCall = true;
                }
            }

            const currentTime = new Date().getTime();

            const messageStates: Array<{
                receiptHandle: string;
                promise: Promise<void>;
            }> = messages.map(message => {
                const receiptHandle = assertExists(message.ReceiptHandle);

                const promise = this._process({
                    message,
                    currentTime,
                    messageBatchSize: messages.length,
                });

                const processPromise = promise.then(
                    () => {
                        this._processPromises.delete(processPromise);
                    },
                    () => {
                        // Ignore errors in process promise. When `stop()` is called (and we wait for
                        // process promises to finish) we don't want job errors to cause `stop()` to
                        // throw.

                        this._processPromises.delete(processPromise);
                    },
                );
                this._processPromises.add(processPromise);

                return {
                    receiptHandle,
                    promise,
                };
            });

            const messageStateSet = new Set(messageStates);
            let deleteMessageReceiptHandles: Array<string> = [];
            const promiseResolver = createPromiseResolver();

            const updateQueue = () => {
                // Batch delete messages we've successfully handled so we don't attempt to
                // process them again.
                if (deleteMessageReceiptHandles.length > 0) {
                    const receiptHandles = deleteMessageReceiptHandles;
                    deleteMessageReceiptHandles = [];

                    this._processContext.process.waitUntil(async () => {
                        deleteMessageBatchTestCounter.incrementForTest();

                        const output = await this._sqsClient.send(
                            new DeleteMessageBatchCommand({
                                QueueUrl: this._queueUrl,
                                Entries: receiptHandles.map((receiptHandle, index) => ({
                                    Id: String(index),
                                    ReceiptHandle: receiptHandle,
                                })),
                            }),
                        );

                        if (output.Failed && output.Failed.length > 0) {
                            const entry = output.Failed[0]!;

                            throw new UnknownError(
                                `Failed to delete ${
                                    output.Failed.length
                                } SQS message(s), first error${
                                    typeof entry.Message === "string" ? `: ${entry.Message}` : ""
                                }${typeof entry.Code === "string" ? ` (code: ${entry.Code})` : ""}`,
                            );
                        }
                    });
                }

                // If we're still processing some messages, extend the visibility and schedule
                // another queue update. This is called "heartbeat"ing and is described in the
                // AWS documentation.
                //
                // https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html
                if (messageStateSet.size > 0) {
                    timeout = createTimeout(
                        updateQueue,
                        (receiveMessagesVisibilityTimeoutSeconds / 2) * 1000,
                    );

                    const receiptHandles = Array.from(
                        messageStateSet,
                        ({receiptHandle}) => receiptHandle,
                    );

                    this._processContext.process.waitUntil(async () => {
                        changeMessageVisibilityBatchTestCounter.incrementForTest();

                        const output = await this._sqsClient.send(
                            new ChangeMessageVisibilityBatchCommand({
                                QueueUrl: this._queueUrl,
                                Entries: receiptHandles.map((receiptHandle, index) => ({
                                    Id: String(index),
                                    ReceiptHandle: receiptHandle,
                                    VisibilityTimeout: receiveMessagesVisibilityTimeoutSeconds,
                                })),
                            }),
                        );

                        if (output.Failed && output.Failed.length > 0) {
                            const entry = output.Failed[0]!;

                            throw new UnknownError(
                                `Failed to change visibility timeout of ${
                                    output.Failed.length
                                } SQS message(s), first error${
                                    typeof entry.Message === "string" ? `: ${entry.Message}` : ""
                                }${typeof entry.Code === "string" ? ` (code: ${entry.Code})` : ""}`,
                            );
                        }
                    });
                }
            };

            let timeout = createTimeout(
                updateQueue,
                (receiveMessagesVisibilityTimeoutSeconds / 2) * 1000,
            );

            if (messageStates.length === 0) {
                promiseResolver.resolve();
            } else {
                for (const messageState of messageStates) {
                    messageState.promise.then(
                        () => {
                            messageStateSet.delete(messageState);
                            if (messageStateSet.size === 0) promiseResolver.resolve();

                            // The message has been handled! Remove it from the queue.
                            deleteMessageReceiptHandles.push(messageState.receiptHandle);
                        },
                        () => {
                            messageStateSet.delete(messageState);
                            if (messageStateSet.size === 0) promiseResolver.resolve();

                            // We don't need to log errors since they've already been reported in the
                            // "Process job" span.
                            //
                            // We leave the message in the queue so it can be processed by the next
                            // `ReceiveMessage` call.
                        },
                    );
                }
            }

            await promiseResolver.promise;

            // All of our jobs have finished processing. Calling `updateQueue()` deletes
            // any messages that successfully finished.
            timeout.clear();
            updateQueue();
        } catch (error) {
            if (
                error === stopError ||
                // Annoyingly, the AWS SDK throws its own abort error instead of respecting the
                // `AbortSignal`'s `reason`.
                // https://github.com/awslabs/smithy-typescript/blob/a4b58b32ac2ae778917e276ba381527f551c2d3d/packages/node-http-handler/src/node-http-handler.ts#L170-L179
                (error instanceof Error && error.name === "AbortError")
            ) {
                // Ignore errors thrown by `AbortController` when `stop()` is called.
                // Cancelling receive message commands when `stop()` is called is expected.
            } else {
                throw error;
            }
        } finally {
            this._runningConsumeCallCount--;

            // Now that we've finished our consume call, if there's a pending call we
            // wanted to make but couldn't since we were at max consume calls then start
            // it now.
            if (!this._isStopped && this._hasPendingConsumeCall) {
                this._hasPendingConsumeCall = false;
                this._processContext.process.waitUntil(this._consume());
            }

            // Never dip below 0 running consume calls.
            if (!this._isStopped && this._runningConsumeCallCount === 0) {
                this._processContext.process.waitUntil(this._consume());
            }
        }
    }

    private async _process({
        message,
        currentTime,
        messageBatchSize,
    }: {
        message: Message;
        currentTime: number;
        messageBatchSize: number;
    }) {
        let span: TracerSpan | undefined;
        let finishSpan: (() => void) | undefined;
        let messageBodyForError: JobQueueMessageBody | undefined;
        try {
            const serializedMessageBody = JSON.parse(assertExists(message.Body));

            // NOTE(calebmer): Job queue messages created before 2024-01-12 don't have a
            // type. Default their type to `Regular`. Once we are a couple months past
            // 2024-01-12, all jobs in our system should have a type and we can
            // remove this.
            serializedMessageBody.type ??= "Regular";

            const messageBody = JobQueueMessageBodySchema.deserialize(serializedMessageBody);
            messageBodyForError = messageBody;

            let handleSpanName = `${
                messageBody.type === "Maintenance" ? "Process maintenance job" : "Process job"
            } ${messageBody.job.type}`;

            // For jobs that process many different things, include the subtype in the
            // name to help identify the span.
            switch (messageBody.job.type) {
                case "NotificationEvent": {
                    handleSpanName += ` (${messageBody.job.event.type})`;
                    break;
                }
                case "IndexSearchEntity": {
                    handleSpanName += ` (${messageBody.job.update.type})`;
                    break;
                }
            }

            const spanName = `Handle: ${handleSpanName}`;

            ({span, finishSpan} =
                messageBody.tracerContext !== null
                    ? this._processContext.tracer
                          .getRoot()
                          .startSpanFromPropagationContextAsLinked(
                              spanName,
                              messageBody.tracerContext,
                          )
                    : this._processContext.tracer.getRoot().startSpan(spanName));

            // The time at which the job starts to be available for processing. The send
            // time plus delay seconds. This will be a little earlier than when the job is
            // truly available for processing since we don't include the latency of adding
            // a job to SQS.
            const jobStartTime =
                messageBody.delaySeconds === 0
                    ? messageBody.sendTime
                    : new Date(messageBody.sendTime.getTime() + messageBody.delaySeconds * 1000);

            span.addData({
                aws: {sqs: {messageId: message.MessageId}},
                jobs: {
                    type: messageBody.job.type,
                    batchSize: messageBatchSize,
                    delaySeconds: messageBody.delaySeconds,
                    queueDurationMs:
                        currentTime -
                        // Don't include the delay in queue duration (use start time instead of send
                        // time). The delay is intentional. We want to measure overall queue health.
                        // Ideally the queue duration should be as close to zero as possible.
                        jobStartTime.getTime(),
                },
            });

            span.addPropagatedDataForChildrenOnly({
                context: {
                    handler: handleSpanName,
                },
            });

            if (messageBody.type === "Regular") {
                const spaceId = getJobDescriptionSpaceId(messageBody.job);

                span.addPropagatedData({context: {spaceId}});

                await this._processContext.with<
                    Omit<ServerSystemActionContextModules, keyof ServerProcessContextModules> & {
                        tracer: TracerContextModule;
                    },
                    void
                >(
                    {
                        tracer: new TracerContextModule(span),
                        cache: new CacheContextModule(),
                        dynamoBatchContext: new DynamoBatchContextModule(),
                        // We're ok dangerously creating a space system actor here since we use AWS IAM
                        // policies to only allow our services to send messages to our SQS queue. So we
                        // can trust job objects to not be malicious.
                        //
                        // It's different for HTTP servers with routes to the public internet! For
                        // those we need to be more careful and make sure we include a signed token to
                        // correctly identify our services.
                        actor: DynamoSystemActorContextModule.dangerouslyNew(
                            "JobQueueService",
                            spaceId,
                        ),
                    },
                    actionContext =>
                        this._processJob(actionContext, messageBody.job, jobStartTime, span!),
                );
            } else {
                await this._processContext.with<
                    Omit<
                        ServerSystemActionContextModules,
                        keyof ServerProcessContextModules | "actor"
                    > & {
                        tracer: TracerContextModule;
                    },
                    void
                >(
                    {
                        tracer: new TracerContextModule(span),
                        cache: new CacheContextModule(),
                        dynamoBatchContext: new DynamoBatchContextModule(),
                    },
                    actionContext =>
                        this._processMaintenanceJob(
                            actionContext,
                            messageBody.job,
                            jobStartTime,
                            span!,
                        ),
                );
            }

            finishSpan();
        } catch (error) {
            // When there's an error processing a job in development, log an error so the
            // user can see it in the console since they might not see it in the UI.
            if (process.env.NODE_ENV !== "production") {
                if (messageBodyForError === undefined) {
                    // eslint-disable-next-line no-console
                    console.error("Job processing failed:", error);
                } else if (messageBodyForError.type === "Maintenance") {
                    // eslint-disable-next-line no-console
                    console.error(
                        quote`Maintenance job ${messageBodyForError.job.type} processing failed:`,
                        error,
                    );
                } else {
                    // eslint-disable-next-line no-console
                    console.error(
                        quote`Job ${messageBodyForError.job.type} processing failed:`,
                        error,
                    );
                }
            }

            if (span) {
                assert(finishSpan);
                span.addException(error);
                finishSpan();
            } else {
                this._processContext.tracer
                    .getTracer()
                    .getRoot()
                    .logUncaughtException("Job parsing failed", error);
            }

            throw error;
        }
    }
}
