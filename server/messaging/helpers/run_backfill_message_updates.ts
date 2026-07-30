import {subDays} from "date-fns/subDays";
import {subMinutes} from "date-fns/subMinutes";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {MessageItem} from "~/server/messaging/helpers/process_messages_query.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {isDatePossiblyLessThanWithUncertaintyWindow} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {MessageModel} from "~/shared/messaging/message_model.js";
import {MessageUpdatesBackfillResult} from "~/shared/messaging/messaging_realtime_protocol.js";
import {
    ServerSynchronizationCheckpoint,
    generateServerSynchronizationCheckpoint,
} from "~/shared/web_socket/server_synchronization_checkpoint.js";

export const messagingEventExpirationDays = 7;
export const messagingBackfillSafetyWindowMinutes = 3;

export async function runBackfillMessageUpdates<Message extends MessageModel>(
    context: ServerActionContext,
    {
        checkpoint,
        queryMessageUpdates,
        getMessageIfExists,
        createMessageModelFromItem,
    }: {
        checkpoint: ServerSynchronizationCheckpoint;
        queryMessageUpdates: (
            context: ServerActionContext,
            options: {
                startSortKey: {
                    sortRangeType: "MessageUpdates";
                    eventTime: Date;
                    messageIndex: number;
                    version: number;
                };
                endSortKey: {
                    sortRangeType: "MessageUpdates";
                    eventTime: Date;
                    messageIndex: number;
                    version: number;
                };
                limit: "All";
                consistency: "Strong";
            },
        ) => AsyncIterableIterator<{
            sortRangeType: "MessageUpdates";
            eventTime: Date;
            messageIndex: number;
            version: number;
        }>;
        getMessageIfExists: (
            context: ServerActionContext,
            messageIndex: number,
            options: {consistency: DynamoReadConsistency},
        ) => Promise<MessageItem | null>;
        createMessageModelFromItem: (
            context: ServerActionContext,
            item: MessageItem,
        ) => Promise<Message>;
    },
): Promise<MessageUpdatesBackfillResult<Message>> {
    // `checkpoint` may be for an eventually consistent read. Eventually consistent
    // reads may contain stale data. So here we backfill events that happened a short
    // window before our `checkpoint` in case the read returned stale data.
    //
    // [DynamoDB says][1] reads are usually consistent "within one second or less". So
    // three minutes should be a sufficient window for backfilling realtime events
    // before the checkpoint.
    //
    // This also defends against clock skew. In case the server that generated the
    // checkpoint has a clock a couple seconds ahead of the rest of our fleet.
    //
    // [1]:
    //     https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html
    checkpoint = subMinutes(checkpoint, messagingBackfillSafetyWindowMinutes);

    // We have deleted events before this time to reduce our storage needs. That means
    // we can't backfill reads that occurred before this time.
    //
    // Use `Date.now()` so tests can mock the `Date.now()` function.
    const expiredEventsTime = subDays(new Date(Date.now()), messagingEventExpirationDays);

    // If our read happened before the expiration time, we may be missing some events
    // that happened between the read and now. The client should fully reload their
    // query in response.
    if (isDatePossiblyLessThanWithUncertaintyWindow(checkpoint, expiredEventsTime))
        return {type: "Unavailable"};

    // We backfill realtime updates to `newCheckpoint` so it should be before the data
    // is read from the database to avoid missing realtime updates.
    const newCheckpoint = generateServerSynchronizationCheckpoint();

    // We send only one event per item key in our backfill. The client does not need to
    // see the update history for an item. Only the latest value...
    const versionByMessageIndex = new Map<number, number>();

    for await (const event of queryMessageUpdates(context, {
        startSortKey: {
            sortRangeType: "MessageUpdates",
            eventTime: DynamoKeyAttributeSchema.date.maxValue,
            // Setting these to 0 means `startSortKey` is effectively exclusive for this query
            // instead of inclusive but that's fine given if time has advanced to
            // `date.maxValue` we'll have much bigger issues.
            messageIndex: 0,
            version: 0,
        },
        endSortKey: {
            sortRangeType: "MessageUpdates",
            eventTime: checkpoint,
            messageIndex: 0,
            version: 0,
        },
        limit: "All",
        // Use a strong read consistency when backfilling events!
        consistency: "Strong",
    })) {
        const previousVersion = versionByMessageIndex.get(event.messageIndex);
        if (previousVersion === undefined || event.version > previousVersion) {
            versionByMessageIndex.set(event.messageIndex, event.version);
        }
    }

    const messages = await runAllPromises(
        mapIterable(versionByMessageIndex, async ([messageIndex, version]) => {
            let hasAlreadyAttempted = false;

            return await retryWithExponentialBackoff(async retry => {
                const isInitialAttempt = !hasAlreadyAttempted;
                hasAlreadyAttempted = true;

                // On the first attempt, try reading with eventual consistency since it's cheaper.
                // If we observe eventual consistency lag (item version is behind event version
                // from strong consistency query) then we'll retry with strong consistency.
                const options: {consistency: DynamoReadConsistency} = isInitialAttempt
                    ? {consistency: "Eventual"}
                    : {consistency: "Strong"};

                const message = await getMessageIfExists(context, messageIndex, options);

                // If the item doesn't exist, then there may be some eventual consistency lag. The
                // next read will use strong consistency.
                if (message === null) throw retry();

                // If our item's version is less than the version expected by our realtime event
                // we're likely seeing an eventual consistency lag. Try reading again. The next
                // read will use strong consistency.
                if (message.version < version) throw retry();

                return await createMessageModelFromItem(context, message);
            });
        }),
    );

    return {
        type: "Available",
        checkpoint: newCheckpoint,
        messages,
    };
}
