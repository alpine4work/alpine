import {InboxEntryItem} from "~/server/notifications/data/internal/inbox_table.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

export function getPushNotificationThreadId(item: InboxEntryItem): string {
    switch (item.sortRangeType) {
        case "ChatEntry":
            return item.chatId;
        case "PostCommentsEntry":
            return item.postId;
        case "ChannelPostsEntry":
            return `${item.channelId}-${item.bucketGeneration}`;
        case "DocumentCommentThreadEntry":
            // `DocumentCommentThreadId` is only guaranteed to be unique within a document.
            // It may not be unique across documents. Which is why we include the
            // `DocumentId` in the thread ID.
            return `${item.documentId}-${item.commentThreadId}`;
        case "DocumentNewCommentThreadsEntry":
            return `${item.documentId}-${item.bucketGeneration}`;
        case "TaskEntry":
            return item.taskId;
        default:
            throw exhaustive(item);
    }
}
