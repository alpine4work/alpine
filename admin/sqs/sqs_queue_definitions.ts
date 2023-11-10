// Naming convention: Pascal case function name. Function names typically start
// with a verb/adverb like `getThing()`, `createThing()`, or
// `dangerouslyUpdateThing()`. Our convention for queue names is similar. Start
// them with a verb but use pascal case for the naming.
export const sqsQueueDefinitionByKey = {
    IndexSearchEntity: {
        // Configure this queue to use long polling. Long polling is almost always
        // preferable to short polling.
        //
        // https://stackoverflow.com/questions/51475944/is-sqs-short-polling-ever-preferable-to-long-polling
        //
        // Note that the “When you poll multiple queues in a single thread” exception
        // for short polling in the above answer does not apply to Node.js. Because of
        // Node.js's asynchronous programming model we can await multiple long polling
        // `ReceiveMessages` calls without blocking the main thread.
        receiveMessageWaitTimeSeconds: 20,

        // We configure a dead letter queue even though we don't currently monitor it
        // to avoid poison-pill messages. Messages that can't be processed so are
        // retried indefinitely consuming resources.
        // https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html#sqs-dead-letter-queues-when-to-use
        deadLetterQueue: {
            queue: {},
            maxReceiveCount: 3,
        },
    },
} satisfies {[key: string]: SqsQueueDefinition};

/**
 * Definition of an [SQS queue][1]. We use the definition to create the queue
 * via the CDK in production or [ElasticMQ][2] in development.
 *
 * Right now, all of our SQS queues are standard queues. We have not added the
 * capability to add [FIFO queues][3]. FIFO queues are 25% more expensive so
 * prefer using standard queues.
 *
 * [1]: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_CreateQueue.html
 * [2]: https://github.com/softwaremill/elasticmq
 * [3]: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-fifo-queues.html
 */
export type SqsQueueDefinition = {
    /**
     * The number of days that Amazon SQS retains a message.
     *
     * You can specify an integer value from 60 seconds (1 minute) to 14 days.
     *
     * @default 4
     */
    readonly retentionPeriodDays?: number;

    /**
     * The time in seconds that the delivery of all messages in the queue is
     * delayed.
     *
     * You can specify an integer value of 0 to 900 (15 minutes). The default
     * value is 0.
     *
     * @default 0
     */
    readonly deliveryDelaySeconds?: number;

    /**
     * The limit of how many bytes that a message can contain before Amazon SQS
     * rejects it.
     *
     * You can specify an integer value from 1024 bytes (1 KiB) to 262144 bytes
     * (256 KiB). The default value is 262144 (256 KiB).
     *
     * @default 256KiB
     */
    readonly maxMessageSizeBytes?: number;

    /**
     * Default wait time for ReceiveMessage calls.
     *
     * Does not wait if set to 0, otherwise waits this amount of seconds
     * by default for messages to arrive.
     *
     * For more information, see Amazon SQS Long Poll.
     *
     *  @default 0
     */
    readonly receiveMessageWaitTimeSeconds?: number;

    /**
     * Timeout of processing a single message.
     *
     * After dequeuing, the processor has this much time to handle the message
     * and delete it from the queue before it becomes visible again for dequeueing
     * by another processor.
     *
     * Values must be from 0 to 43200 seconds (12 hours).
     *
     * @default 30
     */
    readonly visibilityTimeoutSeconds?: number;

    /**
     * Send messages to this queue if they were unsuccessfully dequeued a number
     * of times.
     */
    readonly deadLetterQueue?: {
        /**
         * The dead-letter queue to which Amazon SQS moves messages after the value of
         * `maxReceiveCount` is exceeded.
         *
         * Will create a new queue with a name derived from the current queue's name.
         */
        readonly queue: SqsQueueDefinition;

        /**
         * The number of times a message can be unsuccessfully dequeued before being
         * moved to the dead-letter queue.
         */
        readonly maxReceiveCount: number;
    };
};
