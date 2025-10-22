import {
    InboxAttributesItem,
    initialInboxGeneration,
} from "~/server/notifications/data/internal/inbox_table.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {defaultDigestNotificationSchedule} from "~/shared/notifications/notifications_schedule_schema.js";

export function getInitialInboxItem(spaceId: SpaceId, accountId: AccountId): InboxAttributesItem {
    return {
        partitionType: "Account",
        sortRangeType: "InboxAttributes",
        spaceId,
        accountId,
        generation: initialInboxGeneration,
        loudNotificationCount: 0,
        entryCount: 0,
        lastEntryUpdatedTime: null,
        lastZeroEntryCountTime: null,
        digestNotificationsOptedOutTime: null,
        digestNotificationsSchedule: defaultDigestNotificationSchedule,
        digestNotificationsNextScheduledDateTime: null,
        digestNotificationsLastSentTime: null,
    };
}
