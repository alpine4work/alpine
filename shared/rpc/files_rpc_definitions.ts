import {FileAttachmentTargetSchema} from "~/shared/files/file_attachment_target.js";
import {FileContentTypeSchema} from "~/shared/files/file_content_type.open_source.js";
import {FileEntityIdSchema} from "~/shared/files/file_entity_id.js";
import {FileEntityModelResultSchema} from "~/shared/files/file_entity_model.js";
import {FileModel} from "~/shared/files/file_model.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

export const startUploadingFile = defineRpc({
    name: "startUploadingFile",
    // Fails if the file already exists (when `fileId` is provided). Generates a new
    // `fileId` otherwise.
    isIdempotent: false,
    input: {
        spaceId: Schema.id<SpaceId>(),
        fileId: Schema.id<FileId>().nullable(),
        contentType: FileContentTypeSchema,
        contentLength: Schema.integer,
        attachTarget: FileAttachmentTargetSchema.nullable(),
    },
    output: {
        fileId: Schema.id<FileId>(),
    },
});

export const finishUploadingAndStartProcessingFile = defineRpc({
    name: "finishUploadingAndStartProcessingFile",
    // Fails if the file has already finished uploading.
    isIdempotent: false,
    input: {
        spaceId: Schema.id<SpaceId>(),
        fileId: Schema.id<FileId>(),
        validateContentLength: Schema.integer.optional(),
    },
    output: {
        signedUrlSearch: Schema.string,
        file: FileModel.schema,
    },
});

export const getFileAsUploader = defineRpc({
    name: "getFileAsUploader",
    isIdempotent: true,
    input: {
        fileId: Schema.id<FileId>(),
    },
    output: {
        signedUrlSearch: Schema.string,
        file: FileModel.schema,
    },
});

export const getFileFromAttachment = defineRpc({
    name: "getFileFromAttachment",
    isIdempotent: true,
    input: {
        fileId: Schema.id<FileId>(),
        target: FileAttachmentTargetSchema,
    },
    output: {
        signedUrlSearch: Schema.string,
        file: FileModel.schema,
    },
});

export const getFileWithoutSignedUrlAsUploader = defineRpc({
    name: "getFileWithoutSignedUrlAsUploader",
    isIdempotent: true,
    input: {
        fileId: Schema.id<FileId>(),
    },
    output: {
        file: FileModel.schema,
    },
});

export const getFileWithoutSignedUrlFromAttachment = defineRpc({
    name: "getFileWithoutSignedUrlFromAttachment",
    isIdempotent: true,
    input: {
        fileId: Schema.id<FileId>(),
        target: FileAttachmentTargetSchema,
    },
    output: {
        file: FileModel.schema,
    },
});

export const getFileSignedUrlAsUploader = defineRpc({
    name: "getFileSignedUrlAsUploader",
    isIdempotent: true,
    input: {
        fileId: Schema.id<FileId>(),
    },
    output: {
        signedUrlSearch: Schema.string,
    },
});

export const getFileSignedUrlFromAttachment = defineRpc({
    name: "getFileSignedUrlFromAttachment",
    isIdempotent: true,
    input: {
        fileId: Schema.id<FileId>(),
        target: FileAttachmentTargetSchema,
    },
    output: {
        signedUrlSearch: Schema.string,
    },
});

export const attachFileAsUploader = defineRpc({
    name: "attachFileAsUploader",
    isIdempotent: true,
    input: {
        fileId: Schema.id<FileId>(),
        target: FileAttachmentTargetSchema,
    },
    output: {
        signedUrlSearch: Schema.string,
        file: FileModel.schema,
    },
});

export const attachFileFromAttachment = defineRpc({
    name: "attachFileFromAttachment",
    isIdempotent: true,
    input: {
        fileId: Schema.id<FileId>(),
        fromTarget: FileAttachmentTargetSchema,
        toTarget: FileAttachmentTargetSchema,
    },
    output: {
        signedUrlSearch: Schema.string,
        file: FileModel.schema,
    },
});

export const attachFileToTargetAsBot = defineRpc({
    name: "attachFileToTargetAsBot",
    isIdempotent: true,
    input: {
        fileId: Schema.id<FileId>(),
        target: FileAttachmentTargetSchema,
    },
    output: {
        file: FileModel.schema,
    },
});

export const getFileEntityIfPossible = defineRpc({
    name: "getFileEntityIfPossible",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        fileEntityId: FileEntityIdSchema,
    },
    output: {
        fileEntityResult: FileEntityModelResultSchema,
    },
});
