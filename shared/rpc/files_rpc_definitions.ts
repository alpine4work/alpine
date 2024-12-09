import {FileAttachmentTargetSchema} from "~/shared/files/file_attachment_target.js";
import {FileContentTypeSchema} from "~/shared/files/file_content_type.js";
import {FileModel} from "~/shared/files/file_model.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";

export const startUploadingFile = defineRpc({
    name: "startUploadingFile",
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
    input: {
        spaceId: Schema.id<SpaceId>(),
        fileId: Schema.id<FileId>(),
    },
    output: {
        signedUrlSearch: Schema.string,
        file: FileModel.schema,
    },
});

export const getFileFromAttachment = defineRpc({
    name: "getFileFromAttachment",
    input: {
        spaceId: Schema.id<SpaceId>(),
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
    input: {
        spaceId: Schema.id<SpaceId>(),
        fileId: Schema.id<FileId>(),
    },
    output: {
        file: FileModel.schema,
    },
});

export const getFileWithoutSignedUrlFromAttachment = defineRpc({
    name: "getFileWithoutSignedUrlFromAttachment",
    input: {
        spaceId: Schema.id<SpaceId>(),
        fileId: Schema.id<FileId>(),
        target: FileAttachmentTargetSchema,
    },
    output: {
        file: FileModel.schema,
    },
});

export const getFileSignedUrlAsUploader = defineRpc({
    name: "getFileSignedUrlAsUploader",
    input: {
        spaceId: Schema.id<SpaceId>(),
        fileId: Schema.id<FileId>(),
    },
    output: {
        signedUrlSearch: Schema.string,
    },
});

export const getFileSignedUrlFromAttachment = defineRpc({
    name: "getFileSignedUrlFromAttachment",
    input: {
        spaceId: Schema.id<SpaceId>(),
        fileId: Schema.id<FileId>(),
        target: FileAttachmentTargetSchema,
    },
    output: {
        signedUrlSearch: Schema.string,
    },
});

export const attachFileAsUploader = defineRpc({
    name: "attachFileAsUploader",
    input: {
        spaceId: Schema.id<SpaceId>(),
        fileId: Schema.id<FileId>(),
        target: FileAttachmentTargetSchema,
    },
    output: {},
});

export const attachFileFromAttachment = defineRpc({
    name: "attachFileFromAttachment",
    input: {
        spaceId: Schema.id<SpaceId>(),
        fileId: Schema.id<FileId>(),
        fromTarget: FileAttachmentTargetSchema,
        toTarget: FileAttachmentTargetSchema,
    },
    output: {
        signedUrlSearch: Schema.string,
        file: FileModel.schema,
    },
});
