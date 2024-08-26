import {FileContentTypeSchema} from "~/shared/files/file_content_type.js";
import {FilePreviewPlaceholder} from "~/shared/files/file_preview_placeholder.js";
import {FileId} from "~/shared/id/types/id_types.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema} from "~/shared/schema/schema.js";

// TODO(calebmer, #files): Adding this since I think we'll need it but do we
// actually use `FileModel`s on the client? Right now they're only used in
// tests.
export class FileModel extends Model(
    Schema.object({
        id: Schema.id<FileId>(),
        contentType: FileContentTypeSchema,
        contentLength: Schema.integer,
        isUploading: Schema.boolean,
        preview: Schema.booleanUnion(
            "isProcessing",
            Schema.object({
                isProcessing: Schema.value(true),
                size: Schema.object({
                    width: Schema.integer,
                    height: Schema.integer,
                }).nullable(),
                placeholder: FilePreviewPlaceholder.schema.nullable(),
            }),
            Schema.object({
                isProcessing: Schema.value(false),
                size: Schema.object({
                    width: Schema.integer,
                    height: Schema.integer,
                }),
                placeholder: FilePreviewPlaceholder.schema,
            }),
        ).nullable(),
    }),
) {}
