import {MessageContentSchema} from "~/shared/content/message_content_schema.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * When sharing an entity with other people the user has the option to send a
 * notification to those other people. If they choose to send a notification it's
 * represented by this object. There's a list of recipient accounts and the
 * optional message content.
 */
export type ShareNotification = SchemaType<typeof ShareNotificationSchema>;

export const ShareNotificationSchema = Schema.object({
    accountIds: Schema.array(Schema.id<AccountId>()),
    content: MessageContentSchema,
    createdTimeZone: TimeZoneSchema,
});
