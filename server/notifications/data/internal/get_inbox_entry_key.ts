import {InboxEntryItemKey} from "~/server/notifications/data/internal/inbox_table.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {InboxEntryKey} from "~/shared/notifications/inbox_model.js";

export function getInboxEntryKey(itemKey: InboxEntryItemKey): InboxEntryKey {
    switch (itemKey.sortRangeType) {
        case "ChatEntry": {
            return {
                type: "Chat",
                chatId: itemKey.chatId,
            };
        }
        case "PostCommentsEntry": {
            return {
                type: "PostComments",
                postId: itemKey.postId,
            };
        }
        case "ChannelPostsEntry": {
            return {
                type: "ChannelPosts",
                channelId: itemKey.channelId,
                bucketGeneration: itemKey.bucketGeneration,
            };
        }
        case "DocumentCommentThreadEntry": {
            return {
                type: "DocumentCommentThread",
                documentId: itemKey.documentId,
                commentThreadId: itemKey.commentThreadId,
            };
        }
        case "DocumentNewCommentThreadsEntry": {
            return {
                type: "DocumentNewCommentThreads",
                documentId: itemKey.documentId,
                bucketGeneration: itemKey.bucketGeneration,
            };
        }
        case "TaskEntry": {
            return {
                type: "Task",
                taskId: itemKey.taskId,
            };
        }
        default:
            throw exhaustive(itemKey);
    }
}
