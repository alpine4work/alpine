import {DynamoItem} from "~/server/dynamo/core/dynamo_table_schema.js";
import {observeInboxGenerationIncrement} from "~/server/notifications/data/internal/inbox_generation_increments.js";
import {InboxAttributesItem} from "~/server/notifications/data/internal/inbox_table.js";

export function observeInboxItem(
    item: DynamoItem<InboxAttributesItem>,
): DynamoItem<InboxAttributesItem> {
    return item.update({
        generation: item.generation + observeInboxGenerationIncrement,
        digestNotificationsNextScheduledDateTime: null,
    });
}
