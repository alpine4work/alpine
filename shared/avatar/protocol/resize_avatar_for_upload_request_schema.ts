import {AvatarEntityPathSchema} from "~/shared/avatar/avatar_entity_path.js";
import {FileImageContentTypeSchema} from "~/shared/files/file_content_type.js";
import {AvatarId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

export const ResizeAvatarForUploadRequestSchema = Schema.object({
    avatarEntityPath: AvatarEntityPathSchema,
    avatarId: Schema.id<AvatarId>(),
    contentType: FileImageContentTypeSchema,
    size: Schema.integer,
    maxContentLength: Schema.integer,
});
