import {FileContentTypeSchema} from "~/shared/files/file_content_type.js";
import {FilePreviewSchema} from "~/shared/files/file_preview.js";
import {FileId} from "~/shared/id/types/id_types.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema} from "~/shared/schema/schema.js";

export const FileAlternativeSchema = Schema.booleanUnion(
    "isUploading",
    Schema.object({
        isUploading: Schema.value(true),
    }),
    Schema.object({
        isUploading: Schema.value(false),
        contentType: FileContentTypeSchema,
        contentLength: Schema.integer,
        isPreviewImage: Schema.boolean,
    }),
);

// TODO(calebmer, #files): Adding this since I think we'll need it but do we
// actually use `FileModel`s on the client? Right now they're only used in
// tests.
export class FileModel extends Model(
    Schema.object({
        id: Schema.id<FileId>(),
        contentType: FileContentTypeSchema,
        contentLength: Schema.integer,
        isUploading: Schema.boolean,
        alternative: FileAlternativeSchema.nullable().default(null),
        preview: FilePreviewSchema.nullable(),
    }),
) {}
