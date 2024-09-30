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
        withPreviewUrl: Schema.boolean.optional(),
    },
    output: {
        file: FileModel.schema(),
        previewUrlSearch: Schema.string.nullable(),
    },
});

export const getFilePreviewUrlFromAttachment = defineRpc({
    name: "getFilePreviewUrlFromAttachment",
    input: {
        spaceId: Schema.id<SpaceId>(),
        fileId: Schema.id<FileId>(),
        target: FileAttachmentTargetSchema,
    },
    output: {
        previewUrlSearch: Schema.string.nullable(),
    },
});
