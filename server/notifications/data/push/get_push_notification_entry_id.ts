import {InboxEntryItem} from "~/server/notifications/data/internal/inbox_table.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/**
 * Returns a string that is unique for a specific inbox notification event and does
 * not group together related notifications into a single entry (e.g. not all
 * messages in a chat or all comments on a post).
 */
export function getPushNotificationEntryId(item: InboxEntryItem): string {
    let id: string;
    switch (item.sortRangeType) {
        case "ChatEntry":
            id = `${item.sortRangeType.toLowerCase()}-${item.chatId}-${item.latestMessage.index}`;
            break;
        case "PostCommentsEntry":
            id = `${item.sortRangeType.toLowerCase()}-${item.postId}-${item.latestComment?.index}`;
            break;
        case "ChannelPostsEntry":
            id = `${item.sortRangeType.toLowerCase()}-${item.channelId}-${item.bucketGeneration}`;
            break;
        case "DocumentCommentThreadEntry":
            // `DocumentCommentThreadId` is only guaranteed to be unique within a document. It
            // may not be unique across documents.
            id = `${item.sortRangeType.toLowerCase()}-${item.documentId}-${item.commentThreadId}`;
            break;
        case "DocumentNewCommentThreadsEntry":
            id = `${item.sortRangeType.toLowerCase()}-${item.documentId}-${item.bucketGeneration}`;
            break;
        case "TaskEntry":
            id = `${item.sortRangeType.toLowerCase()}-${item.taskId}-${item.latestComment.index}`;
            break;
        default:
            throw exhaustive(item);
    }
    return id;
}
