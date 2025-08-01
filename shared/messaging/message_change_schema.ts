import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {MessageContentWithReferencesSchema} from "~/shared/messaging/message_content_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export type MessageChange = SchemaType<typeof MessageChangeSchema>;

export const MessageUpdateContentChangeSchema = Schema.object({
    type: Schema.value("UpdateContent"),
    index: Schema.integer,
    content: MessageContentWithReferencesSchema,
    contentUpdatedTime: Schema.date,
});

export const MessageDeleteChangeSchema = Schema.object({
    type: Schema.value("Delete"),
    index: Schema.integer,
    deletedTime: Schema.date,
});

export const MessageChangeSchema = Schema.union({
    UpdateContent: MessageUpdateContentChangeSchema,
    Delete: MessageDeleteChangeSchema,
});

export function getMessageChangeTime(
    change:
        | {readonly type: "UpdateContent"; readonly contentUpdatedTime: Date}
        | {readonly type: "Delete"; readonly deletedTime: Date},
): Date {
    switch (change.type) {
        case "UpdateContent":
            return change.contentUpdatedTime;
        case "Delete":
            return change.deletedTime;
        default:
            throw exhaustive(change);
    }
}
