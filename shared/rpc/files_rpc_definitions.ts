import {FileAttachmentTargetSchema} from "~/shared/files/file_attachment_target.js";
import {FileModel} from "~/shared/files/file_model.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";

export const getFileFromAttachment = defineRpc({
    name: "getFileFromAttachment",
    input: {
        spaceId: Schema.id<SpaceId>(),
        fileId: Schema.id<FileId>(),
        target: FileAttachmentTargetSchema,
    },
    output: {
        signedUrlSearch: Schema.string,
        file: FileModel.schema(),
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
        file: FileModel.schema(),
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
        file: FileModel.schema(),
    },
});
