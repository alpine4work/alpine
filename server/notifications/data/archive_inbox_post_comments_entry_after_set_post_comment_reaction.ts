import {ServerSessionActionContextWithPush} from "~/server/context/server_session_action_context_with_push.js";
import {updateInboxPostCommentsEntry} from "~/server/notifications/data/internal/update_inbox_post_comments_entry.js";
import {PostId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

export async function archiveInboxPostCommentsEntryAfterSetPostCommentReaction(
    context: ServerSessionActionContextWithPush,
    {
        spaceId,
        postId,
        commentCount,
        commentIndex,
    }: {
        spaceId: SpaceId;
        postId: PostId;
        commentCount: number;
        commentIndex: number | null;
    },
) {
    await updateInboxPostCommentsEntry(
        context,
        context.actor.getAccountId(),
        {
            spaceId,
            accountId: context.actor.getAccountId(),
            postId,
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
                postCreatedTime: oldItem.postCreatedTime,
                isForPostContentMention: oldItem.isForPostContentMention,
                latestComment: oldItem.latestComment?.isStickyMention
                    ? {...oldItem.latestComment, isStickyMention: false}
                    : oldItem.latestComment,
                latestArchivingCommentIndex: !oldItem.isArchived
                    ? commentIndex
                    : (oldItem.latestArchivingCommentIndex ?? null),
                otherCommentAuthorId: oldItem.otherCommentAuthorId,
            };
        },
    );
}
