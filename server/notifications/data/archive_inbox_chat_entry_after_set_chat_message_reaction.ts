import {ServerSessionActionContextWithPush} from "~/server/context/server_session_action_context_with_push.js";
import {updateInboxEntry} from "~/server/notifications/data/internal/update_inbox_entry.js";
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
    await updateInboxEntry(
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
                    : (oldItem?.latestArchivingMessageIndex ?? null),
                otherAccountId: oldItem.otherAccountId,
            };
        },
    );
}
