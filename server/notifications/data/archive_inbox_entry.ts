import {ServerSessionActionContextWithApns} from "~/server/context/server_session_action_context_with_apns.js";
import {getInboxEntryItemKey} from "~/server/notifications/data/internal/get_inbox_entry_item_key.js";
import {
    sendPushNotificationToAccountDevices,
    shouldSendPushNotification,
} from "~/server/notifications/data/internal/send_push_notification_to_account_devices.js";
import {updateInboxEntry} from "~/server/notifications/data/internal/update_inbox_entry.js";
import {NotFoundError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {InboxEntryKey} from "~/shared/notifications/inbox_model.js";

/**
 * Archives an inbox entry, moving it out of the account's primary inbox and
 * into an archive. The user can still manually revive archived inbox entries
 * if desired.
 *
 * If the user sends a message to a chat and that implicitly archives the inbox
 * entry, that doesn't happen through this function. Instead it happens through
 * `processNotificationEvent()`.
 */
export async function archiveInboxEntry(
    context: ServerSessionActionContextWithApns,
    {spaceId, key}: {spaceId: SpaceId; key: InboxEntryKey},
): Promise<{archiveTime: Date}> {
    const result = await updateInboxEntry(
        context,
        context.actor.getAccountId(),
        getInboxEntryItemKey({spaceId, accountId: context.actor.getAccountId(), key}),
        item => {
            if (!item) throw new NotFoundError("Inbox entry not found");

            item = {
                ...item,
                isArchived: true,
                // Archiving an entry clears all of its loud notifications.
                loudNotificationCount: 0,
            };

            // Clear out the `isStickyMention` property for messaging entries.
            if ("latestMessage" in item && item.latestMessage.isStickyMention) {
                item = {
                    ...item,
                    latestMessage: {
                        ...item.latestMessage,
                        isStickyMention: false,
                    },
                };
            }

            // Clear out the `isStickyMention` property for messaging entries.
            if ("latestComment" in item && item.latestComment?.isStickyMention) {
                item = {
                    ...item,
                    latestComment: {
                        ...item.latestComment,
                        isStickyMention: false,
                    },
                };
            }

            // When archiving a channel posts entry, all `PostId`s in the entry are now
            // considered archived.
            if (
                item.sortRangeType === "ChannelPostsEntry" &&
                item.archivedPostIds.size !== item.postIds.size
            ) {
                item = {
                    ...item,
                    archivedPostIds: item.postIds,
                };
            }

            // When archiving a new comment threads entry, all `DocumentCommentThreadId`s
            // in the entry are now considered archived.
            if (
                item.sortRangeType === "DocumentNewCommentThreadsEntry" &&
                item.archivedCommentThreadIds.size !== item.commentThreadIds.size
            ) {
                item = {
                    ...item,
                    archivedCommentThreadIds: item.commentThreadIds,
                };
            }

            return item;
        },
    );

    // The inbox entry should always be updated so `result` must be non-null.
    assert(result);
    assert(result.newInboxEntryItem.isArchived);

    // If we're archiving an entry with loud notifications, we need to send an
    // alert to Apple devices to update the badge count.
    if (result.loudNotificationCountDifference !== 0) {
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

    return {archiveTime: result.newInboxEntryItem.enteredTime};
}
