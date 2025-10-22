import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {
    MessageContentWithReferences,
    MessageContentWithReferencesSchema,
} from "~/shared/messaging/message_content_schema.js";
import {MessageContentPayloadContentUpdate} from "~/shared/messaging/message_schema.js";
import {ProsemirrorMappingSchema} from "~/shared/prosemirror/prosemirror_mapping_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export type MessageChange = SchemaType<typeof MessageChangeSchema>;

export const MessageUpdateContentChangeSchema = Schema.object({
    type: Schema.value("UpdateContent"),
    index: Schema.integer,
    content: MessageContentWithReferencesSchema,
    contentUpdatedTime: Schema.date,
    contentUpdateMappings: Schema.array(ProsemirrorMappingSchema).default(emptyArray),
}).transform<{
    readonly type: "UpdateContent";
    readonly index: number;
    readonly content: MessageContentWithReferences;
    readonly contentUpdate: MessageContentPayloadContentUpdate;
}>({
    serialize: change => ({
        type: change.type,
        index: change.index,
        content: change.content,
        contentUpdatedTime: change.contentUpdate.time,
        contentUpdateMappings: change.contentUpdate.mappings,
    }),
    deserialize: change => ({
        type: change.type,
        index: change.index,
        content: change.content,
        contentUpdate: {
            time: change.contentUpdatedTime,
            mappings: change.contentUpdateMappings,
        },
    }),
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
        | {
              readonly type: "UpdateContent";
              readonly contentUpdate: MessageContentPayloadContentUpdate;
          }
        | {
              readonly type: "Delete";
              readonly deletedTime: Date;
          },
): Date {
    switch (change.type) {
        case "UpdateContent":
            return change.contentUpdate.time;
        case "Delete":
            return change.deletedTime;
        default:
            throw exhaustive(change);
    }
}
