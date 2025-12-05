import {ServerSessionActionContextWithPush} from "~/server/context/server_session_action_context_with_push.js";
import {sendPushNotificationToAccountTargets} from "~/server/notifications/data/internal/push/send_push_notification_to_account_targets.js";
import {updateInboxDocumentCommentThreadEntry} from "~/server/notifications/data/internal/update_inbox_document_comment_thread_entry.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {DocumentCommentThreadId, DocumentId, SpaceId} from "~/shared/id/types/id_types.js";

export async function archiveDocumentCommentThreadEntryAfterSetDocumentCommentReaction(
    context: ServerSessionActionContextWithPush,
    {
        spaceId,
        documentId,
        commentThreadId,
        commentCount,
        commentIndex,
    }: {
        spaceId: SpaceId;
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        commentCount: number;
        commentIndex: number;
    },
) {
    const result = await updateInboxDocumentCommentThreadEntry(
        context,
        context.actor.getAccountId(),
        {
            spaceId,
            accountId: context.actor.getAccountId(),
            documentId,
            commentThreadId,
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
                firstCommentAuthorId: oldItem.firstCommentAuthorId,
                latestComment: oldItem.latestComment.isStickyMention
                    ? {...oldItem.latestComment, isStickyMention: false}
                    : oldItem.latestComment,
                latestArchivingCommentIndex: !oldItem.isArchived
                    ? commentIndex
                    : oldItem.latestArchivingCommentIndex ?? null,
                otherCommentAuthorId: oldItem.otherCommentAuthorId,
                isFromNewCommentThread: oldItem.isFromNewCommentThread,
            };
        },
    );

    // If we're archiving an entry with loud notifications, we need to send an
    // alert to Apple devices to update the badge count.
    if (result && result.loudNotificationCountDifference !== 0) {
        // NOTE(calebmer): Consider turning this into a job on the job queue to
        // guarantee notification delivery.
        context.process.waitUntil(
            sendPushNotificationToAccountTargets(context, {
                accountId: context.actor.getAccountId(),
                eventId: generateChronologicalId(),
                newInboxEntryItem: result.newInboxEntryItem,
                loudNotificationCountDifference: result.loudNotificationCountDifference,
            }),
        );
    }
}
