import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {MessageContentWithReferencesSchema} from "~/shared/models/message_model";
import {Schema, SchemaType} from "~/shared/schema/schema";

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

export function getMessageChangeTime(change: MessageChange): Date {
    switch (change.type) {
        case "UpdateContent":
            return change.contentUpdatedTime;
        case "Delete":
            return change.deletedTime;
        default:
            throw exhaustive(change);
    }
}
