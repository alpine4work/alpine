import {ServerSessionActionContextWithPush} from "~/server/context/server_session_action_context_with_push.js";
import {updateInboxEntry} from "~/server/notifications/data/internal/update_inbox_entry.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.open_source.js";

export async function archiveInboxTaskEntryAfterSetTaskCommentReaction(
    context: ServerSessionActionContextWithPush,
    {
        spaceId,
        taskId,
        commentCount,
        commentIndex,
    }: {
        spaceId: SpaceId;
        taskId: TaskId;
        commentCount: number;
        commentIndex: number;
    },
) {
    await updateInboxEntry(
        context,
        context.actor.getAccountId(),
        {
            partitionType: "Inbox",
            sortRangeType: "TaskEntry",
            spaceId,
            accountId: context.actor.getAccountId(),
            taskId,
        },
        oldItem => {
            if (!oldItem) return "Noop";

            // Don't archive if a new comment was added after the `commentCount` we had at
            // reaction time. Since a new comment will unarchive the entry. This fixes
            // out-of-order event processing race conditions.
            const shouldArchive = commentCount >= (oldItem.latestComment?.index ?? -1);

            if (!shouldArchive) return oldItem;

            return {
                isArchived: true,
                loudNotificationCount: 0,
                latestComment: oldItem.latestComment.isStickyMention
                    ? {...oldItem.latestComment, isStickyMention: false}
                    : oldItem.latestComment,
                latestArchivingCommentIndex: !oldItem?.isArchived
                    ? commentIndex
                    : (oldItem?.latestArchivingCommentIndex ?? null),
                otherCommentAuthorId: oldItem.otherCommentAuthorId,
            };
        },
    );
}
