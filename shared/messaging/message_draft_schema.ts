import {emptyContentReferences} from "~/shared/content/content_references.js";
import {
    MessageContentWithReferencesSchema,
    emptyMessageContent,
} from "~/shared/content/message_content_schema.js";
import {FileAttachmentTargetSchema} from "~/shared/files/file_attachment_target.js";
import {FileEntityIdSchema, FileIdOrFileEntityIdSchema} from "~/shared/files/file_entity_id.js";
import {FileEntityModelResultSchema} from "~/shared/files/file_entity_model.js";
import {FileModel} from "~/shared/files/file_model.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.open_source.js";
import {zeroHybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {FileId} from "~/shared/id/types/id_types.open_source.js";
import {MessageContentPayloadParentSchema} from "~/shared/messaging/message_schema.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export type MessageDraft = SchemaType<typeof MessageDraftSchema>;

export const MessageDraftSchema = Schema.object({
    content: MessageContentWithReferencesSchema,
    parent: MessageContentPayloadParentSchema.nullable(),
    fileIds: Schema.array(FileIdOrFileEntityIdSchema).default(emptyArray),
    version: HybridLogicalTimeSchema.default(zeroHybridLogicalTime),
});

export const emptyMessageDraft: MessageDraft = {
    content: {
        doc: emptyMessageContent,
        references: emptyContentReferences,
    },
    parent: null,
    fileIds: emptyArray,
    version: zeroHybridLogicalTime,
};

export type MessageDraftFile = SchemaType<typeof MessageDraftFileSchema>;

export const MessageDraftFileSchema = Schema.union({
    File: Schema.object({
        type: Schema.value("File"),
        fileId: Schema.id<FileId>(),
        attachmentTarget: FileAttachmentTargetSchema.nullable(),
        shouldAttachBeforeCreate: Schema.boolean,
        signedUrlSearch: Schema.string,
        file: FileModel.schema,
    }),
    FileEntity: Schema.object({
        type: Schema.value("FileEntity"),
        fileId: FileEntityIdSchema,
        fileEntityResult: FileEntityModelResultSchema,
    }),
});

export type MessageDraftWithFiles = SchemaType<typeof MessageDraftWithFilesSchema>;

export const MessageDraftWithFilesSchema = Schema.object({
    content: MessageContentWithReferencesSchema,
    parent: MessageContentPayloadParentSchema.nullable(),
    fileIds: Schema.array(FileIdOrFileEntityIdSchema).default(emptyArray),
    files: Schema.array(MessageDraftFileSchema).default(emptyArray),
    version: HybridLogicalTimeSchema.default(zeroHybridLogicalTime),
});

export const emptyMessageDraftWithFiles: MessageDraftWithFiles = {
    content: {
        doc: emptyMessageContent,
        references: emptyContentReferences,
    },
    parent: null,
    fileIds: emptyArray,
    files: emptyArray,
    version: zeroHybridLogicalTime,
};

/**
 * Whether a draft includes server-hydrated file models in addition to stored
 * `fileIds`.
 */
export function isMessageDraftWithHydratedFiles(
    draft: MessageDraft | MessageDraftWithFiles,
): draft is MessageDraftWithFiles {
    return "files" in draft;
}
