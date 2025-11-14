import {ServerSessionActionContextWithApns} from "~/server/context/server_session_action_context_with_apns.js";
import {
    sendPushNotificationToAccountDevices,
    shouldSendPushNotification,
} from "~/server/notifications/data/internal/send_push_notification_to_account_devices.js";
import {updateInboxPostCommentsEntry} from "~/server/notifications/data/internal/update_inbox_post_comments_entry.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {PostId, SpaceId} from "~/shared/id/types/id_types.js";

export async function archiveInboxPostCommentsEntryAfterSetPostCommentReaction(
    context: ServerSessionActionContextWithApns,
    {
        spaceId,
        postId,
        commentCount,
        commentIndex,
    }: {
        spaceId: SpaceId;
        postId: PostId;
        commentCount: number;
        commentIndex: number;
    },
) {
    const result = await updateInboxPostCommentsEntry(
        context,
        context.actor.getAccountId(),
        {
            spaceId,
            accountId: context.actor.getAccountId(),
            postId,
        },
        oldItem => {
            if (!oldItem) return null;

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
                    : oldItem.latestArchivingCommentIndex ?? null,
                otherCommentAuthorId: oldItem.otherCommentAuthorId,
            };
        },
    );

    // If we're archiving an entry with loud notifications, we need to send an
    // alert to Apple devices to update the badge count.
    if (result && result.loudNotificationCountDifference !== 0) {
        if (shouldSendPushNotification()) {
            // NOTE(calebmer): Consider turning this into a job on the job queue to
            // guarantee notification delivery.
            context.process.waitUntil(
                sendPushNotificationToAccountDevices(context, {
                    accountId: context.actor.getAccountId(),
                    eventId: generateChronologicalId(),
                    newInboxEntryItem: result.newInboxEntryItem,
                    loudNotificationCountDifference: result.loudNotificationCountDifference,
                }),
            );
        }
    }
}
