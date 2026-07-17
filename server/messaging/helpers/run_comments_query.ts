import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {
    CommentQueryItem,
    CommentQueryStreamItem,
    CommentQueryStreamPartItem,
    processCommentsQuery,
} from "~/server/messaging/helpers/process_comments_query.js";
import {MessageItem} from "~/server/messaging/helpers/process_messages_query.js";

export async function* runCommentsQuery(
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
                sortRangeType: "Comments";
                commentIndex: number;
            };
            endSortKey: {
                sortRangeType: "Comments#StreamPart";
                commentIndex: number;
                partIndex: number;
            };
        }) => AsyncIterable<CommentQueryItem | CommentQueryStreamItem | CommentQueryStreamPartItem>;
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
                sortRangeType: "Comments",
                commentIndex: uncachedStartIndex,
            },
            endSortKey: {
                sortRangeType: "Comments#StreamPart",
                commentIndex: uncachedEndIndex,
                partIndex: Number.MAX_SAFE_INTEGER,
            },
        });

        for (const cachedMessagePromise of cachedMessagePromisesFromStart) {
            const message = await cachedMessagePromise;
            if (!message) return;
            yield message;
        }

        for await (const message of processCommentsQuery(queryIterable)) {
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
