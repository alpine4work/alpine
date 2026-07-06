import {
    ChangeMessageVisibilityBatchCommand,
    DeleteMessageBatchCommand,
    Message,
    ReceiveMessageCommand,
    SQSClient,
} from "@aws-sdk/client-sqs";
import {ActorServiceName, SystemActorContextModule} from "~/server/helpers/actor_context_module.js";
import {getJobQueueConsumerHandleSpanName} from "~/server/jobs/core/get_job_queue_consumer_handle_span_name.js";
import {JobDescription, getJobDescriptionSpaceId} from "~/server/jobs/core/job_description.js";
import {
    JobQueueName,
    JobTypeByQueueName,
    jobQueueNameByType,
} from "~/server/jobs/core/job_queue_name.js";
import {JobQueueMessageBody, JobQueueMessageBodySchema} from "~/server/jobs/core/job_sender.js";
import {MaintenanceJobDescription} from "~/server/jobs/core/maintenance_job_description.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {AbortedError, InternalError, UnknownError} from "~/shared/error/error.js";
import {Queue} from "~/shared/helpers/array/queue.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";
import {TestCounter} from "~/shared/helpers/test/test_counter.js";
import {Replace} from "~/shared/helpers/types/replace.js";
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
 * > Q: When should I use Amazon SQS long polling, and when should I use Amazon SQS
 * > short polling?
 * >
 * > A: In almost all cases, Amazon SQS long polling is preferable to short
 * > polling. [...]
 * >
 * > Q: What value should I use for my long-poll timeout?
 * >
 * > A: In general, you should use a maximum of 20 seconds for a long-poll timeout.
 * > [...]
 */
const receiveMessagesWaitTimeSeconds = 20;

/**
 * AWS SQS [default visibility timeout is 30 seconds][1].
 *
 * [1]:
 *     https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html
 */
// Use a faster timeout in unit tests so tests that exercise message retries run in
// reasonable time.
const receiveMessagesVisibilityTimeoutSeconds = !import.meta.jest ? 30 : 3;

/**
 * Processes jobs in our job queue. Features:
 *
 * - Long polling: We use AWS SQS long polling to improve efficiency and reduce
 *   cost.
 *
 * - Auto-scaling: We dynamically launch "[fibers][1]" to concurrently receive many
 *   messages based on how busy the queue is and scale back down once activity
 *   subsides. Fibers are a lightweight thread of execution. If you're familiar
 *   with [goroutines][1] they're similar to that. Fibers are like threads with the
 *   key difference being fibers use cooperative context switching on a single
 *   operating system thread instead of preemptive time-slicing.
 *
 *     This allows a single JavaScript thread to process up to 100 jobs
 *     concurrently. Instead of the 10 message max on an SQS
 *     `ReceiveMessageCommand`.
 *
 * - Heartbeats: If a message is taking a long time to process, we'll extend the
 *   message's visibility timeout so it isn't processed again by another job.
 *
 * [1]: https://en.wikipedia.org/wiki/Fiber_(computer_science)
 * [2]: https://go.dev/tour/concurrency/1
 */
export class JobQueueConsumer<
    QueueName extends JobQueueName,
    ProcessContextModules extends {process: ProcessContextModule; tracer: TracerContextModule},
> {
    private readonly _processContext: Context<ProcessContextModules>;
    private readonly _queueName: JobQueueName;
    private readonly _serviceName: ActorServiceName;
    private readonly _queueUrl: string;
    private readonly _sqsClient: SQSClient;
    private readonly _sqsQueueName: string;

    private readonly _processJob: (
        context: Context<
            Replace<
                ProcessContextModules,
                {
                    tracer: TracerContextModule;
                    cache: CacheContextModule;
                    batch: BatchContextModule;
                    actor: SystemActorContextModule;
                }
            >
        >,
        job: JobDescription & {type: JobTypeByQueueName[QueueName]},
        jobStartTime: Date,
        span: TracerSpan,
    ) => Promise<void>;

    private readonly _processMaintenanceJob: (
        context: Context<
            Replace<
                ProcessContextModules,
                {tracer: TracerContextModule; cache: CacheContextModule; batch: BatchContextModule}
            >
        >,
        job: QueueName extends "Default" ? MaintenanceJobDescription : never,
        jobStartTime: Date,
        span: TracerSpan,
    ) => Promise<void>;

    private _isStarted = false;
    private _isStopped = false;
    private _abortController = new AbortController();
    private readonly _receiveMessageAbortControllers = new Set<AbortController>();
    private _fiberCount = 0;
    private _hasPendingMainFiber = false;
    private readonly _pendingExternalFibers = new Queue<() => void>();
    private readonly _mainFiberPromiseWaiter = new PromiseWaiter();

    /**
     * The maximum number of parallel `_consume()` calls we allow. After receiving some
     * messages we immediately want to receive more while we process our current batch
     * of messages.
     *
     * This and `maxFiberMessageCount` determine the maximum number of jobs our
     * consumer can process in one JavaScript thread at once. For example, if this
     * value is 10 and `maxFiberMessageCount` is 10, then the maximum number of jobs
     * our consumer can process at once is 100 (10 \* 10). If we're running on a
     * machine with 3 cores then each core will run a different Node.js worker process
     * with its own queue consumer so we end up being able to process 300 messages at
     * once.
     */
    private readonly _maxFiberCount: number;

    /**
     * What is the maximum number of messages to return from one `_runFiber()` call?
     * Same as the `MaxNumberOfMessages` parameter in the [SQS `ReceiveMessage`
     * action][1]. Can't be greater than 10.
     *
     * This and `maxFiberCount` determine the maximum number of jobs our consumer can
     * process in one JavaScript thread at once. For example, if this value is 10 and
     * `maxFiberCount` is 10, then the maximum number of jobs our consumer can process
     * at once is 100 (10 \* 10). If we're running on a machine with 3 cores then each
     * core will run a different Node.js worker process with its own queue consumer so
     * we end up being able to process 300 messages at once.
     *
     * [1]:
     *     https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_ReceiveMessage.html
     */
    private readonly _maxFiberMessageCount: number;

    // Every minute we create an activity span for our `JobQueueConsumer`. All fiber
    // runs and other background activity run by the `JobQueueConsumer` is logged to
    // this span. This allows us to conveniently debug the operations of our
    // `JobQueueConsumer` on a timeline.
    private _activitySpan!: TracerSpan;
    private _finishActivitySpan!: () => void;
    private _activityTimeout!: Timeout;

    private constructor(
        context: Context<ProcessContextModules>,
        {
            region,
            queueName,
            queueUrl,
            maxFiberCount,
            maxFiberMessageCount,
            processJob,
            processMaintenanceJob,
        }: {
            region: string;
            queueName: JobQueueName;
            queueUrl: string;
            maxFiberCount: number;
            maxFiberMessageCount: number;
            processJob: (
                context: Context<
                    Replace<
                        ProcessContextModules,
                        {
                            tracer: TracerContextModule;
                            cache: CacheContextModule;
                            batch: BatchContextModule;
                            actor: SystemActorContextModule;
                        }
                    >
                >,
                job: JobDescription & {type: JobTypeByQueueName[QueueName]},
                jobStartTime: Date,
                span: TracerSpan,
            ) => Promise<void>;
            processMaintenanceJob?: (
                context: Context<
                    Replace<
                        ProcessContextModules,
                        {
                            tracer: TracerContextModule;
                            cache: CacheContextModule;
                            batch: BatchContextModule;
                        }
                    >
                >,
                job: QueueName extends "Default" ? MaintenanceJobDescription : never,
                jobStartTime: Date,
                span: TracerSpan,
            ) => Promise<void>;
        },
    ) {
        this._processContext = context;
        this._queueName = queueName;
        switch (this._queueName) {
            case "Default":
                this._serviceName = "JobQueueService";
                this._sqsQueueName = "JobQueue";
                break;
            case "FileProcessor":
                this._serviceName = "FileProcessorService";
                this._sqsQueueName = "FileProcessorJobQueue";
                break;
            case "FileProcessorLight":
                // NOTE(ifitzsimmons, 07-24-2025) Only used in Dev Environment
                assert(process.env.NODE_ENV !== "production");
                this._serviceName = "FileProcessorService";
                this._sqsQueueName = "FileProcessorLightJobQueue";
                break;
            case "FileProcessorHeavy":
                // NOTE(ifitzsimmons, 07-24-2025) Only used in Dev Environment
                assert(process.env.NODE_ENV !== "production");
                this._serviceName = "FileProcessorService";
                this._sqsQueueName = "FileProcessorHeavyJobQueue";
                break;
            default:
                throw exhaustive(this._queueName);
        }

        assert(
            queueUrl.includes(this._sqsQueueName),
            quote`Expected queue URL ${queueUrl} to include ${this._sqsQueueName}`,
        );

        this._queueUrl = queueUrl;
        this._sqsClient = new SQSClient({
            region,
            endpoint: new URL("/", queueUrl).toString(),
        });
        this._maxFiberCount = maxFiberCount;
        this._maxFiberMessageCount = maxFiberMessageCount;
        this._processJob = processJob;

        // Require `processMaintenanceJob` to exist for the `Default` queue.
        if (this._queueName === "Default") {
            this._processMaintenanceJob = assertExists(processMaintenanceJob);
        } else {
            assert(!processMaintenanceJob);
            this._processMaintenanceJob = (context, job) => {
                throw exhaustive(job as never);
            };
        }

        const loopActivitySpan = () => {
            const {span: activitySpan, finishSpan: actuallyFinishActivitySpan} =
                this._processContext.tracer
                    .getRoot()
                    .startSpan(`JobQueueConsumer activity (${this._queueName})`);

            activitySpan.addData({
                jobs: {
                    queueName: this._queueName,
                    consumer: {
                        startFiberCount: this._fiberCount,
                        maxFiberCount: this._maxFiberCount,
                    },
                },
            });

            const finishActivitySpan = () => {
                activitySpan.addData({jobs: {consumer: {endFiberCount: this._fiberCount}}});
                actuallyFinishActivitySpan();
            };

            const activityTimeout = createTimeout(() => {
                finishActivitySpan();
                loopActivitySpan();
            }, 60 * 1000);

            this._activitySpan = activitySpan;
            this._finishActivitySpan = finishActivitySpan;
            this._activityTimeout = activityTimeout;
        };

        loopActivitySpan();
    }

    public static start<
        QueueName extends JobQueueName,
        ProcessContextModules extends {process: ProcessContextModule; tracer: TracerContextModule},
    >(
        context: Context<ProcessContextModules>,
        options: {
            region: string;
            queueName: QueueName;
            queueUrl: string;
            maxFiberCount: number;
            maxFiberMessageCount: number;
            processJob: (
                context: Context<
                    Replace<
                        ProcessContextModules,
                        {
                            tracer: TracerContextModule;
                            cache: CacheContextModule;
                            batch: BatchContextModule;
                            actor: SystemActorContextModule;
                        }
                    >
                >,
                job: JobDescription & {type: JobTypeByQueueName[QueueName]},
                jobStartTime: Date,
                span: TracerSpan,
            ) => Promise<void>;
            processMaintenanceJob?: (
                context: Context<
                    Replace<
                        ProcessContextModules,
                        {
                            tracer: TracerContextModule;
                            cache: CacheContextModule;
                            batch: BatchContextModule;
                        }
                    >
                >,
                job: QueueName extends "Default" ? MaintenanceJobDescription : never,
                jobStartTime: Date,
                span: TracerSpan,
            ) => Promise<void>;
        },
    ) {
        const consumer = new JobQueueConsumer(context, options);
        consumer._start();
        return consumer;
    }

    private _start() {
        assert(!this._isStopped);
        assert(!this._isStarted);
        this._isStarted = true;

        this._mainFiberPromiseWaiter.waitUntil(this._runMainFiber());
    }

    public async stop() {
        assert(!this._isStopped);
        this._isStopped = true;
        this._abortController.abort(new AbortedError("Job queue consumer stopped"));

        this._activityTimeout.clear();

        try {
            // Wait for all our running jobs to finish.
            await this._mainFiberPromiseWaiter.wait();
        } finally {
            this._finishActivitySpan();
        }
    }

    private async _runMainFiber() {
        assert(!this._isStopped);

        this._fiberCount++;
        const {span: fiberSpan, finishSpan: finishFiberSpan} = this._activitySpan.startSpan(
            `JobQueueConsumer fiber main (${this._queueName})`,
        );

        let isReceiveMessageAborted = false;

        try {
            receiveMessageTestCounter.incrementForTest();

            // Create an abort controller for each `ReceiveMessageCommand` call. It inherits
            // from the class abort controller which is called when the consumer stops.
            //
            // When `withFiber()` is called we abort an idle `ReceiveMessageCommand` to allow
            // for our resize to run.
            const receiveMessageAbortController = new AbortController();

            const handleAbort = () => {
                this._receiveMessageAbortControllers.delete(receiveMessageAbortController);

                // After aborting, we need to replace this main fiber run. So set to true.
                this._hasPendingMainFiber = true;

                isReceiveMessageAborted = true;

                this._fiberCount--;
                fiberSpan.addData({common: {didNothing: true}});
                finishFiberSpan();
                this._afterFiberFinish();
            };

            receiveMessageAbortController.signal.addEventListener("abort", handleAbort);
            this._receiveMessageAbortControllers.add(receiveMessageAbortController);

            let output;
            try {
                output = await fiberSpan.withSpan(
                    `SQS ReceiveMessage ${this._sqsQueueName}`,
                    async span => {
                        span.addData({
                            jobs: {queueName: this._queueName},
                            aws: {
                                sqs: {
                                    queueName: this._sqsQueueName,
                                    visibilityTimeout: receiveMessagesVisibilityTimeoutSeconds,
                                    waitTimeSeconds: receiveMessagesWaitTimeSeconds,
                                    maxNumberOfMessages: this._maxFiberMessageCount,
                                },
                            },
                        });

                        const output = await this._sqsClient.send(
                            new ReceiveMessageCommand({
                                QueueUrl: this._queueUrl,
                                VisibilityTimeout: receiveMessagesVisibilityTimeoutSeconds,
                                WaitTimeSeconds: receiveMessagesWaitTimeSeconds,
                                // SQS will not let us receive more than 10 messages at a time.
                                MaxNumberOfMessages: this._maxFiberMessageCount,
                                MessageSystemAttributeNames: ["ApproximateReceiveCount"],
                            }),
                            // In tests environments, when `stop()` is called cancel SQS `ReceiveMessage`
                            // requests instead of waiting out `WaitTimeSeconds`. In non-test environments use
                            // our safer abort handling that continues waiting (so we don't have issues when
                            // there's a race where SQS is just about to send us messages).
                            isTestNodeEnvOrAdminScenariosScript
                                ? {abortSignal: this._abortController.signal}
                                : undefined,
                        );

                        span.addData({
                            aws: {
                                sqs: {
                                    messageCount: output.Messages?.length ?? 0,
                                },
                            },
                        });

                        return output;
                    },
                );
            } finally {
                this._abortController.signal.removeEventListener("abort", handleAbort);
                this._receiveMessageAbortControllers.delete(receiveMessageAbortController);
                receiveMessageAbortController.signal.removeEventListener("abort", handleAbort);
            }

            const messages = output.Messages ?? [];

            // If our `ReceiveMessage` call was aborted then we don't actually cancel the
            // underlying command. The reason being we've encountered race conditions
            // (including in our integration test `document_files_desktop.spec.ts`) where even
            // though we've used an `AbortSignal` to cancel a request, SQS still might have
            // pushed messages to our `ReceiveMessage` call and set those message visibility
            // timeouts to `VisibilityTimeout` (30s is our current value) before SQS realizes
            // the message was aborted. This means another queue consumer instance won't be
            // able to pick up the message for another 30s. If this is a latency sensitive job
            // (e.g. file processing) the user will be sitting, staring, waiting for the job to
            // get picked up for 30s.
            //
            // So instead what we do is when an abort happens we immediately decrement
            // `fiberCount` but we wait the remaining `WaitTimeSeconds` (20s is our current
            // value). If we receive messages then we call `ChangeMessageVisibilityBatch` to
            // set the message visibility timeouts to 0. This tells SQS we won't process these
            // messages so someone else needs to.
            if (isReceiveMessageAborted) {
                if (messages.length > 0) {
                    await fiberSpan.withSpan(
                        `SQS ChangeMessageVisibilityBatch ${this._sqsQueueName}`,
                        span => {
                            span.addData({
                                jobs: {queueName: this._queueName},
                                aws: {
                                    sqs: {
                                        queueName: this._sqsQueueName,
                                        messageCount: messages.length,
                                        visibilityTimeout: 0,
                                    },
                                },
                            });

                            return this._sqsClient.send(
                                new ChangeMessageVisibilityBatchCommand({
                                    QueueUrl: this._queueUrl,
                                    Entries: messages.map((message, index) => ({
                                        Id: String(index),
                                        ReceiptHandle: message.ReceiptHandle,
                                        VisibilityTimeout: 0,
                                    })),
                                }),
                            );
                        },
                    );
                }
                return;
            }

            // If we got some messages, then while we process them we want to try and consume
            // more messages concurrently. Keep consuming messages until we reach a max number
            // of fibers.
            //
            // If we un-aborted (`wasReceiveMessageAborted` is true) then we won't spawn a new
            // fiber. There should already be an idle `ReceiveMessage` fiber from the main
            // `_afterFiberFinish()` loop.
            if (!this._isStopped && messages.length > 0) {
                if (this._fiberCount < this._maxFiberCount) {
                    this._mainFiberPromiseWaiter.waitUntil(this._runMainFiber());
                } else {
                    // The next fiber to finish will start a new fiber.
                    this._hasPendingMainFiber = true;
                }
            }

            const currentTime = new Date().getTime();

            const messageStates: Array<{
                receiptHandle: string;
                promise: Promise<void>;
            }> = messages.map(message => {
                const receiptHandle = assertExists(message.ReceiptHandle);

                const promise = this._process(fiberSpan, {
                    message,
                    currentTime,
                    messageBatchSize: messages.length,
                });

                return {
                    receiptHandle,
                    promise,
                };
            });

            const messageStateSet = new Set(messageStates);
            let deleteMessageReceiptHandles: Array<string> = [];
            const promiseResolver = createPromiseResolver();

            const updateQueue = () => {
                // Batch delete messages we've successfully handled so we don't attempt to process
                // them again.
                if (deleteMessageReceiptHandles.length > 0) {
                    const receiptHandles = deleteMessageReceiptHandles;
                    deleteMessageReceiptHandles = [];

                    this._processContext.process.waitUntil(async () => {
                        deleteMessageBatchTestCounter.incrementForTest();

                        const output = await fiberSpan.withSpan(
                            `SQS DeleteMessageBatch ${this._sqsQueueName}`,
                            span => {
                                span.addData({
                                    jobs: {queueName: this._queueName},
                                    aws: {
                                        sqs: {
                                            queueName: this._sqsQueueName,
                                            messageCount: receiptHandles.length,
                                        },
                                    },
                                });

                                return this._sqsClient.send(
                                    new DeleteMessageBatchCommand({
                                        QueueUrl: this._queueUrl,
                                        Entries: receiptHandles.map((receiptHandle, index) => ({
                                            Id: String(index),
                                            ReceiptHandle: receiptHandle,
                                        })),
                                    }),
                                );
                            },
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
                // another queue update. This is called "heartbeat"ing and is described in the AWS
                // documentation.
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

                        const output = await fiberSpan.withSpan(
                            `SQS ChangeMessageVisibilityBatch ${this._sqsQueueName}`,
                            span => {
                                span.addData({
                                    jobs: {queueName: this._queueName},
                                    aws: {
                                        sqs: {
                                            queueName: this._sqsQueueName,
                                            messageCount: receiptHandles.length,
                                            visibilityTimeout:
                                                receiveMessagesVisibilityTimeoutSeconds,
                                        },
                                    },
                                });

                                return this._sqsClient.send(
                                    new ChangeMessageVisibilityBatchCommand({
                                        QueueUrl: this._queueUrl,
                                        Entries: receiptHandles.map((receiptHandle, index) => ({
                                            Id: String(index),
                                            ReceiptHandle: receiptHandle,
                                            VisibilityTimeout:
                                                receiveMessagesVisibilityTimeoutSeconds,
                                        })),
                                    }),
                                );
                            },
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

                            // We don't need to log errors since they've already been reported in the "Process
                            // job" span.
                            //
                            // We leave the message in the queue so it can be processed by the next
                            // `ReceiveMessage` call.
                        },
                    );
                }
            }

            await promiseResolver.promise;

            // All of our jobs have finished processing. Calling `updateQueue()` deletes any
            // messages that successfully finished.
            timeout.clear();
            updateQueue();
        } catch (error) {
            if (
                error instanceof AbortedError ||
                // Annoyingly, the AWS SDK throws its own abort error instead of respecting the
                // `AbortSignal`'s `reason`.
                // https://github.com/awslabs/smithy-typescript/blob/a4b58b32ac2ae778917e276ba381527f551c2d3d/packages/node-http-handler/src/node-http-handler.ts#L170-L179
                (error instanceof Error && error.name === "AbortError")
            ) {
                // Ignore errors thrown by `AbortController` when `stop()` is called. Cancelling
                // receive message commands when `stop()` is called is expected.
            } else {
                throw error;
            }
        } finally {
            // If the `ReceiveMessage` action was aborted then we should have already
            // decremented the fiber count.
            if (!isReceiveMessageAborted) {
                this._fiberCount--;
                finishFiberSpan();
                this._afterFiberFinish();
            }
        }
    }

    private _afterFiberFinish() {
        if (this._isStopped) return;

        // If there's any pending external fibers then run them. We'll run pending external
        // fibers until the queue is exhausted at which point we'll continue running our
        // main fiber.
        //
        // NOTE(calebmer): This can lead to starvation issues! Let's take
        // `FileProcessorService` as an example which runs resize requests in an external
        // fiber. If we have many incoming resize requests then they'll starve out main
        // fibers from running. We may need to build more advanced scheduling capabilities
        // to make sure the main fiber doesn't get starved. We can also scale ourselves out
        // of the problem by running plenty of file processor servers.
        if (this._fiberCount < this._maxFiberCount) {
            const pendingExternalFiber = this._pendingExternalFibers.dequeue();
            pendingExternalFiber?.();
        }

        // If there's a pending call we wanted to make but couldn't since we were at max
        // fibers then start it now.
        if (this._fiberCount < this._maxFiberCount && this._hasPendingMainFiber) {
            this._hasPendingMainFiber = false;
            this._mainFiberPromiseWaiter.waitUntil(this._runMainFiber());
        }

        // Never dip below 0 running fibers.
        if (!(this._fiberCount > 0)) {
            this._mainFiberPromiseWaiter.waitUntil(this._runMainFiber());
        }
    }

    private async _process(
        fiberSpan: TracerSpan,
        {
            message,
            currentTime,
            messageBatchSize,
        }: {
            message: Message;
            currentTime: number;
            messageBatchSize: number;
        },
    ) {
        let span: TracerSpan | undefined;
        let finishSpan: (() => void) | undefined;
        let messageBodyForError: JobQueueMessageBody | undefined;
        try {
            const serializedMessageBody = JSON.parse(assertExists(message.Body));

            // NOTE(calebmer): Job queue messages created before 2024-01-12 don't have a type.
            // Default their type to `Regular`. Once we are a couple months past 2024-01-12,
            // all jobs in our system should have a type and we can remove this.
            serializedMessageBody.type ??= "Regular";

            const messageBody = JobQueueMessageBodySchema.deserialize(serializedMessageBody);
            messageBodyForError = messageBody;

            const handleSpanName = getJobQueueConsumerHandleSpanName(messageBody);
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

            fiberSpan.link(`Execution: ${handleSpanName}`, span);

            // The time at which the job starts to be available for processing. The send time
            // plus delay seconds. This will be a little earlier than when the job is truly
            // available for processing since we don't include the latency of adding a job to
            // SQS.
            const jobStartTime =
                messageBody.delaySeconds === 0
                    ? messageBody.sendTime
                    : new Date(messageBody.sendTime.getTime() + messageBody.delaySeconds * 1000);

            span.addData({
                aws: {
                    sqs: {
                        messageId: message.MessageId,
                        messageCount: messageBatchSize,
                        approximateReceiveCount: message.Attributes?.ApproximateReceiveCount
                            ? parseInt(message.Attributes.ApproximateReceiveCount, 10)
                            : undefined,
                    },
                },
                jobs: {
                    type: messageBody.job.type,
                    delaySeconds: messageBody.delaySeconds,
                    queueDurationMs:
                        currentTime -
                        // Don't include the delay in queue duration (use start time instead of send time).
                        // The delay is intentional. We want to measure overall queue health. Ideally the
                        // queue duration should be as close to zero as possible.
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

                const jobQueueName = jobQueueNameByType[messageBody.job.type];
                if (jobQueueName !== this._queueName) {
                    throw new InternalError(
                        quote`Job ${messageBody.job.type} is in the wrong queue, the job should be in the queue ${jobQueueName} but we\u2019re consuming the queue ${this._queueName}`,
                    );
                }

                await this._processContext.with<
                    {
                        tracer: TracerContextModule;
                        cache: CacheContextModule;
                        batch: BatchContextModule;
                        actor: SystemActorContextModule;
                    },
                    void
                >(
                    {
                        tracer: new TracerContextModule(span),
                        cache: CacheContextModule.new(),
                        batch: BatchContextModule.new(),
                        // We're ok dangerously creating a space system actor here since we use AWS IAM
                        // policies to only allow our services to send messages to our SQS queue. So we can
                        // trust job objects to not be malicious.
                        //
                        // It's different for HTTP servers with routes to the public internet! For those we
                        // need to be more careful and make sure we include a signed token to correctly
                        // identify our services.
                        actor: SystemActorContextModule.dangerouslyNew(this._serviceName, spaceId),
                    },
                    actionContext =>
                        this._processJob(
                            actionContext,
                            messageBody.job as JobDescription & {
                                type: JobTypeByQueueName[QueueName];
                            },
                            jobStartTime,
                            span!,
                        ),
                );
            } else {
                // All maintenance jobs are in the default queue.
                const jobQueueName = "Default";
                if (jobQueueName !== this._queueName) {
                    throw new InternalError(
                        quote`Job ${messageBody.job.type} is in the wrong queue, the job should be in the queue ${jobQueueName} but we\u2019re consuming the queue ${this._queueName}`,
                    );
                }

                await this._processContext.with<
                    {
                        tracer: TracerContextModule;
                        cache: CacheContextModule;
                        batch: BatchContextModule;
                    },
                    void
                >(
                    {
                        tracer: new TracerContextModule(span),
                        cache: CacheContextModule.new(),
                        batch: BatchContextModule.new(),
                    },
                    actionContext =>
                        this._processMaintenanceJob(
                            actionContext,
                            messageBody.job as JobQueueName extends "Default"
                                ? MaintenanceJobDescription
                                : never,
                            jobStartTime,
                            span!,
                        ),
                );
            }

            finishSpan();
        } catch (error) {
            // When there's an error processing a job in development, log an error so the
            // developer can see it in the console since they might not see it in the UI.
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
                span.addData({jobs: {willRetry: true}});
                span.addException(error);
                finishSpan();
            } else {
                this._processContext.tracer
                    .getTracer()
                    .getRoot()
                    .logException("Job parsing failed", error);
            }

            throw error;
        }
    }

    /**
     * Use one of the consumer's fibers to run an arbitrary action.
     *
     * `JobQueueConsumer` runs multiple fibers of execution concurrently (up to
     * `maxFiberCount`). Each fiber started by `JobQueueConsumer`:
     *
     * 1. Long polls SQS by running the `ReceiveMessage` command (waits up to 20
     *    seconds for messages).
     * 2. Processes each job. The fiber does not free up until all jobs finish
     *    processing.
     *
     * So if `maxFiberCount` is 10 and `maxFiberMessageCount` is 5 `JobQueueConsumer`
     * can run 10 fibers which each process at most 5 messages.
     *
     * You may use this function if you need to run some action in a job queue
     * processing service and want to share resources with `JobQueueConsumer`. If you
     * call `withFiber()` once (in our configuration of `maxFiberCount` = 10 and
     * `maxFiberMessageCount` = 5) then it consumes one fiber for the duration of the
     * action. So after calling `withFiber()` once there are only 9 fibers available to
     * process messages.
     *
     * If all fibers are being used to process messages then `withFiber()` will wait
     * until a fiber is available.
     *
     * IMPORTANT: Any fibers scheduled with `withFiber()` will run BEFORE
     * `JobQueueConsumer` gets to schedule new fibers to consume SQS messages. This can
     * lead to starvation issues where we never get to process SQS messages.
     */
    public readonly withFiber = <Modules extends {tracer: TracerContextModule}, Value>(
        context: Context<Modules>,
        action: () => Promise<Value>,
    ): Promise<Value> => {
        assert(!this._isStopped);

        const {span: fiberQueueSpan, finishSpan: finishFiberQueueSpan} = context.tracer.startSpan(
            `Waiting for JobQueueConsumer fiber (${this._queueName})`,
        );

        const promiseResolver = createPromiseResolver<Value>();

        const attempt = () => {
            if (this._fiberCount >= this._maxFiberCount) {
                this._pendingExternalFibers.enqueue(attempt);

                // If there's an idle `ReceiveMessage` command then abort it so we can run our
                // external fiber. If the command successfully aborts then `_afterFiberFinish()`
                // will be called which'll run our pending external fiber.
                for (const receiveMessageAbortController of this._receiveMessageAbortControllers) {
                    if (!receiveMessageAbortController.signal.aborted) {
                        receiveMessageAbortController.abort(
                            new AbortedError(
                                "Aborting idle `ReceiveMessage` action for external fiber",
                            ),
                        );
                    }
                    break;
                }
                return;
            }

            // End the span which states how long we spent in the fiber queue and start the
            // span for tracking our external fiber.
            finishFiberQueueSpan();

            const {span: fiberSpan, finishSpan: finishFiberSpan} = this._activitySpan.startSpan(
                `JobQueueConsumer fiber external (${this._queueName})`,
            );
            fiberSpan.link(
                `Execution: JobQueueConsumer fiber external (${this._queueName})`,
                fiberQueueSpan,
            );

            this._fiberCount++;

            const onResolve = (value: Value) => {
                this._fiberCount--;
                finishFiberSpan();
                this._afterFiberFinish();

                promiseResolver.resolve(value);
            };

            const onReject = (error: unknown) => {
                this._fiberCount--;
                finishFiberSpan();
                this._afterFiberFinish();

                promiseResolver.reject(error);
            };

            try {
                action().then(onResolve, onReject);
            } catch (error) {
                // Handle any synchronous errors from the `action()` function in case it throws
                // synchronously instead of returning a promise.
                onReject(error);
            }
        };

        attempt();

        return promiseResolver.promise;
    };
}
