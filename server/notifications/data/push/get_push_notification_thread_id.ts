import {InboxEntryItem} from "~/server/notifications/data/internal/inbox_table.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * Returns a string that is unique* for a given inbox entry item, limited to 32 characters so it
 * can be used as a topic for web push notifications.
 *
 * *Technically could be non-unique over a long enough timeframe or with a very unlucky combination
 *  of entity IDs. For practical purposes, it's unique.
 */
export function getPushNotificationThreadId(item: InboxEntryItem): string {
    let threadId: string;
    switch (item.sortRangeType) {
        case "ChatEntry":
            threadId = item.chatId;
            break;
        case "PostCommentsEntry":
            threadId = item.postId;
            break;
        case "ChannelPostsEntry":
            threadId = `${item.channelId}${truncateBucketGeneration(item.bucketGeneration, 6)}`;
            break;
        case "DocumentCommentThreadEntry":
            // `DocumentCommentThreadId` is only guaranteed to be unique within a document.
            // It may not be unique across documents. Which is why we include the
            // the first 6 characters of the `DocumentId` in the thread ID.
            threadId = `${item.documentId.slice(0, 6)}${item.commentThreadId}`;
            break;
        case "DocumentNewCommentThreadsEntry":
            threadId = `${item.documentId}${truncateBucketGeneration(item.bucketGeneration, 6)}`;
            break;
        case "TaskEntry":
            threadId = item.taskId;
            break;
        default:
            throw exhaustive(item);
    }
    // Apple's push service has a limit of 32 characters for the thread ID.
    assert(threadId.length <= 32, "Push notification thread ID must be fewer than 32 characters");
    // Apple's push service expects the thread ID to be a valid base64 string, so to ensure the
    // length is always a multiple of 4, we pad with 0s up to 32 characters.
    return threadId.padEnd(32, "0");
}

// The `% 10 ** 6` grabs only the last `maxDigits` digits of the bucket generation, which means it
// will wrap around after 10 ** `maxDigits` generations. Given that observing the inbox increments
// the generation by 2, a user would have to observe their inbox at least (10 ** `maxDigits`) / 2
// times before this would repeat.
//
// For example, with 6 digits, this truncates `12345678` to `345678` and it would wrap around after
// 1,000,000 generations.
function truncateBucketGeneration(bucketGeneration: number, maxDigits: number): number {
    return bucketGeneration % 10 ** maxDigits;
}
