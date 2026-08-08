import {ServerActionContext} from "~/server/context/server_action_context.js";
import {NotificationsTable} from "~/server/notifications/data/internal/notifications_table.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

export async function clearPendingSubtleNotificationsForInbox(
    context: ServerActionContext,
    {accountId, spaceId}: {accountId: AccountId; spaceId: SpaceId},
) {
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
            return {
                ...item,
                hasPendingSubtleNotifications: false,
                pendingSubtleNotifications: new Map(),
                lastUpdatedTime: new Date(),
            };
        },
    );
}
