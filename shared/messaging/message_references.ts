import {ContentReferencedIdsSchema} from "~/shared/content/content_referenced_ids.js";
import {ContentReferencesSchema} from "~/shared/content/content_references.js";
import {FileIdOrFileEntityIdSchema} from "~/shared/files/file_entity_id.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {MessageContentPayloadModelFileSchema} from "~/shared/messaging/message_model.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export type MessageReferencedIds = SchemaType<typeof MessageReferencedIdsSchema>;

export const MessageReferencedIdsSchema = Schema.object({
    authorId: Schema.id<AccountId>().nullable(),
    contentReferencedIds: ContentReferencedIdsSchema,
    fileIds: Schema.set(FileIdOrFileEntityIdSchema),
});

export type MessageReferences = SchemaType<typeof MessageReferencesSchema>;

export const MessageReferencesSchema = Schema.object({
    author: AccountModel.schema.nullable(),
    contentReferences: ContentReferencesSchema,
    fileById: Schema.map(FileIdOrFileEntityIdSchema, MessageContentPayloadModelFileSchema),
});
