import {ServerSessionActionContextWithPush} from "~/server/context/server_session_action_context_with_push.js";
import {sendPushNotificationToAccountTargets} from "~/server/notifications/data/internal/push/send_push_notification_to_account_targets.js";
import {updateInboxEntry} from "~/server/notifications/data/internal/update_inbox_entry.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {ChatId, SpaceId} from "~/shared/id/types/id_types.js";

export async function archiveInboxChatEntryAfterSetChatMessageReaction(
    context: ServerSessionActionContextWithPush,
    {
        spaceId,
        chatId,
        messageCount,
        messageIndex,
    }: {
        spaceId: SpaceId;
        chatId: ChatId;
        messageCount: number;
        messageIndex: number;
    },
) {
    const result = await updateInboxEntry(
        context,
        context.actor.getAccountId(),
        {
            partitionType: "Inbox",
            sortRangeType: "ChatEntry",
            spaceId,
            accountId: context.actor.getAccountId(),
            chatId,
        },
        oldItem => {
            if (!oldItem) return "Noop";

            // Don't archive if a new message was added after the `messageCount` we had at
            // reaction time. Since a new message will unarchive the entry. This fixes
            // out-of-order event processing race conditions.
            const shouldArchive = messageCount >= (oldItem.latestMessage?.index ?? -1);

            if (!shouldArchive) return oldItem;

            return {
                isArchived: true,
                loudNotificationCount: 0,
                lastLoudNotificationCountTime: oldItem.lastLoudNotificationCountTime,
                latestMessage: oldItem.latestMessage.isStickyMention
                    ? {...oldItem.latestMessage, isStickyMention: false}
                    : oldItem.latestMessage,
                latestArchivingMessageIndex: !oldItem?.isArchived
                    ? messageIndex
                    : oldItem?.latestArchivingMessageIndex ?? null,
                otherAccountId: oldItem.otherAccountId,
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
