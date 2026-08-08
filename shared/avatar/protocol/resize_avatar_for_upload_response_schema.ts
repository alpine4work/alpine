import {ErrorSchema} from "~/shared/error/error_schema.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

export const ResizeAvatarForUploadResponseSchema = Schema.result(
    Schema.object({
        ok: Schema.value(true),
        content: Schema.bytes,
    }),
    Schema.object({
        ok: Schema.value(false),
        error: ErrorSchema,
    }),
);
