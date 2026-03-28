import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {
    MessageItem,
    MessageQueryItem,
    MessageQueryStreamItem,
    MessageQueryStreamPartItem,
    processMessagesQuery,
} from "~/server/messaging/helpers/process_messages_query.js";
import {assert} from "~/shared/helpers/control/assert.js";

export async function* runMessagesQuery(
    context: ServerActionContext,
    {
        cache,
        cacheKeyPrefix,
        consistency = "Eventual",
        startIndex,
        endIndex,
        query,
    }: {
        cache: DynamoContextCache<`${string}:${number}`, MessageItem | null>;
        cacheKeyPrefix: string;
        consistency: DynamoCacheReadConsistency | undefined;
        startIndex: number;
        endIndex: number;
        query: (options: {
            consistency: DynamoCacheReadConsistency;
            limit: "All";
            startSortKey: {
                sortRangeType: "Messages";
                messageIndex: number;
            };
            endSortKey: {
                sortRangeType: "Messages#StreamPart";
                messageIndex: number;
                partIndex: number;
            };
        }) => AsyncIterable<MessageQueryItem | MessageQueryStreamItem | MessageQueryStreamPartItem>;
    },
): AsyncIterableIterator<MessageItem> {
    if (startIndex > endIndex) return;

    let uncachedStartIndex = startIndex;
    let uncachedEndIndex = endIndex;

    const cachedMessagePromisesFromStart: Array<Promise<MessageItem | null>> = [];
    const cachedMessagePromisesFromEnd: Array<Promise<MessageItem | null>> = [];

    for (let index = startIndex; index < endIndex + 1; index++) {
        const messagePromise = cache.getIfExists(
            context,
            consistency,
            `${cacheKeyPrefix}:${index}`,
        );
        if (!messagePromise) break;

        uncachedStartIndex = index + 1;
        cachedMessagePromisesFromStart.push(messagePromise);
    }

    for (let index = endIndex; index > uncachedStartIndex; index--) {
        const messagePromise = cache.getIfExists(
            context,
            consistency,
            `${cacheKeyPrefix}:${index}`,
        );
        if (!messagePromise) break;

        uncachedEndIndex = index - 1;
        cachedMessagePromisesFromEnd.push(messagePromise);
    }

    // Put messages in the right order.
    void cachedMessagePromisesFromEnd.reverse();

    if (!(uncachedStartIndex <= uncachedEndIndex)) {
        for (const cachedMessagePromise of cachedMessagePromisesFromStart) {
            const message = await cachedMessagePromise;
            if (!message) return;
            yield message;
        }

        for (const cachedMessagePromise of cachedMessagePromisesFromEnd) {
            const message = await cachedMessagePromise;
            if (!message) return;
            yield message;
        }
    } else {
        const queryIterable = query({
            consistency,
            limit: "All",
            startSortKey: {
                sortRangeType: "Messages",
                messageIndex: uncachedStartIndex,
            },
            endSortKey: {
                sortRangeType: "Messages#StreamPart",
                messageIndex: uncachedEndIndex,
                partIndex: Number.MAX_SAFE_INTEGER,
            },
        });

        for (const cachedMessagePromise of cachedMessagePromisesFromStart) {
            const message = await cachedMessagePromise;
            if (!message) return;
            yield message;
        }

        for await (const message of processMessagesQuery(queryIterable)) {
            cache.set(
                context,
                consistency,
                `${cacheKeyPrefix}:${message.index}`,
                Promise.resolve(message),
            );
            yield message;
        }

        for (const cachedMessagePromise of cachedMessagePromisesFromEnd) {
            const message = await cachedMessagePromise;
            if (!message) return;
            yield message;
        }
    }
}
