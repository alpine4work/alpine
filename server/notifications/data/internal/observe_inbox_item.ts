import {observeInboxGenerationIncrement} from "~/server/notifications/data/internal/inbox_generation_increments.js";
import {InboxAttributesItem} from "~/server/notifications/data/internal/inbox_table.js";

export function observeInboxItem(item: InboxAttributesItem): InboxAttributesItem {
    return {
        ...item,
        generation: item.generation + observeInboxGenerationIncrement,
        digestNotificationsNextScheduledDateTime: null,
    };
}
