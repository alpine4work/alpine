import {FileContentTypeSchema} from "~/shared/files/file_content_type.open_source.js";
import {FileProcessorErrorSchema} from "~/shared/files/file_processor_error.js";
import {Schema, SchemaType} from "~/shared/schema/schema.open_source.js";

export type FileAlternative = SchemaType<typeof FileAlternativeSchema>;

export const FileAlternativeSchema = Schema.booleanUnion(
    "isProcessing",
    Schema.object({
        isProcessing: Schema.value(true),
    }),
    Schema.result(
        Schema.object({
            isProcessing: Schema.value(false),
            ok: Schema.value(true),
            contentType: FileContentTypeSchema,
            contentLength: Schema.integer,
            isImagePreviewContent: Schema.boolean,
        }),
        Schema.object({
            isProcessing: Schema.value(false),
            ok: Schema.value(false),
            error: FileProcessorErrorSchema,
        }),
    ),
);
