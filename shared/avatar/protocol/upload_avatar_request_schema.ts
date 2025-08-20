import {Schema} from "~/shared/schema/schema.js";

const RequestSchemaBase = Schema.object({
    contentType: Schema.string,
    content: Schema.bytes,
});

export const UploadAvatarRequestSchema = Schema.union({
    UploadSpaceAvatar: RequestSchemaBase.merge(
        Schema.object({
            type: Schema.value("UploadSpaceAvatar"),
            // TODO(#add-space-avatar-support): add a light/dark mode variant
        }),
    ),
    UploadAccountAvatar: RequestSchemaBase.merge(
        Schema.object({
            type: Schema.value("UploadAccountAvatar"),
        }),
    ),
});
