import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {InboxEntryKeySchema} from "~/shared/notifications/inbox_model.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * A stub for tracking a subtle notification that has not been sent and will be
 * sent later in a batch with other subtle notifications.
 */
export const PendingSubtleNotificationStubSchema = Schema.object({
    eventAuthorId: Schema.id<AccountId>(),
    eventTime: Schema.date,
    inboxEntryKey: InboxEntryKeySchema,
});

export type PendingSubtleNotificationStub = SchemaType<typeof PendingSubtleNotificationStubSchema>;
