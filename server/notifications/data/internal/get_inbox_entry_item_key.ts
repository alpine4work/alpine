import {InboxEntryItemKey} from "~/server/notifications/data/internal/inbox_table.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {InboxEntryKey} from "~/shared/notifications/inbox_model.js";

export function getInboxEntryItemKey({
    spaceId,
    accountId,
    key,
}: {
    spaceId: SpaceId;
    accountId: AccountId;
    key: InboxEntryKey;
}): InboxEntryItemKey {
    switch (key.type) {
        case "Chat": {
            return {
                partitionType: "Inbox",
                sortRangeType: "ChatEntry",
                spaceId,
                accountId,
                chatId: key.chatId,
            };
        }
        case "PostComments": {
            return {
                partitionType: "Inbox",
                sortRangeType: "PostCommentsEntry",
                spaceId,
                accountId,
                postId: key.postId,
            };
        }
        case "ChannelPosts": {
            return {
                partitionType: "Inbox",
                sortRangeType: "ChannelPostsEntry",
                spaceId,
                accountId,
                channelId: key.channelId,
                bucketGeneration: key.bucketGeneration,
            };
        }
        case "DocumentCommentThread": {
            return {
                partitionType: "Inbox",
                sortRangeType: "DocumentCommentThreadEntry",
                spaceId,
                accountId,
                documentId: key.documentId,
                commentThreadId: key.commentThreadId,
            };
        }
        case "DocumentNewCommentThreads": {
            return {
                partitionType: "Inbox",
                sortRangeType: "DocumentNewCommentThreadsEntry",
                spaceId,
                accountId,
                documentId: key.documentId,
                bucketGeneration: key.bucketGeneration,
            };
        }
        case "Task": {
            return {
                partitionType: "Inbox",
                sortRangeType: "TaskEntry",
                spaceId,
                accountId,
                taskId: key.taskId,
            };
        }
        default:
            throw exhaustive(key);
    }
}
