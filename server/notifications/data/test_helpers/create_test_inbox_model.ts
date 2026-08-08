import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {InboxModel} from "~/shared/notifications/inbox_model.js";
import {defaultDigestNotificationSchedule} from "~/shared/notifications/notifications_schedule_schema.js";
import {ModelPartialDataType} from "~/shared/schema/model/model.js";

export function createTestInboxModel({
    accountId,
    spaceId,
    ...inboxModelOptions
}: ModelPartialDataType<InboxModel> & {
    accountId: AccountId;
    spaceId: SpaceId;
}) {
    return new InboxModel({
        accountId,
        spaceId,
        loudNotificationCount: 0,
        entryCount: 0,
        lastZeroEntryCountTime: null,
        digestNotificationsOptedOutTime: null,
        digestNotificationsSchedule: defaultDigestNotificationSchedule,
        ...inboxModelOptions,
    });
}
