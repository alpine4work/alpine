import {ServerActionContext} from "~/server/context/server_action_context.js";
import type {NotificationEvent} from "~/server/notifications/core/notification_event.js";
import {getInboxEntryKey} from "~/server/notifications/data/internal/get_inbox_entry_key.js";
import {InboxEntryItem} from "~/server/notifications/data/internal/inbox_table.js";
import {NotificationsTable} from "~/server/notifications/data/internal/notifications_table.js";
import {getPushNotificationEntryId} from "~/server/notifications/data/push/get_push_notification_entry_id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

export async function queuePendingSubtleNotification(
    context: ServerActionContext,
    {
        accountId,
        spaceId,
        notificationEvent,
        inboxEntry,
    }: {
        accountId: AccountId;
        spaceId: SpaceId;
        notificationEvent: NotificationEvent;
        inboxEntry: InboxEntryItem;
    },
) {
    const inboxEntryKey = getInboxEntryKey(inboxEntry);

    const subtleNotificationStub = {
        eventAuthorId: notificationEvent.authorId,
        eventTime: notificationEvent.createdTime,
        inboxEntryKey,
    };

    await NotificationsTable.updateItem(
        context,
        {
            partitionType: "Inbox",
            sortRangeType: "PendingSubtleNotifications",
            spaceId,
            accountId,
        },
        item => {
            item ??= {
                partitionType: "Inbox",
                sortRangeType: "PendingSubtleNotifications",
                spaceId,
                accountId,
                hasPendingSubtleNotifications: false,
                lastUpdatedTime: null,
                pendingSubtleNotifications: new Map(),
            };
            const updatedPendingSubtleNotifications = new Map(
                item?.pendingSubtleNotifications ?? [],
            );
            updatedPendingSubtleNotifications.set(
                getPushNotificationEntryId(inboxEntry),
                subtleNotificationStub,
            );
            return {
                ...item,
                hasPendingSubtleNotifications: true,
                pendingSubtleNotifications: updatedPendingSubtleNotifications,
                lastUpdatedTime: new Date(),
            };
        },
    );
}
