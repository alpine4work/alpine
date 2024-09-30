import {FileAttachmentTargetSchema} from "~/shared/files/file_attachment_target.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";

export const getFilePreviewUrl = defineRpc({
    name: "getFilePreviewUrl",
    input: {
        spaceId: Schema.id<SpaceId>(),
        fileId: Schema.id<FileId>(),
        fromAttachmentTarget: FileAttachmentTargetSchema,
    },
    output: {
        previewUrlSearch: Schema.string.nullable(),
    },
});
