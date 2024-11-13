import {getErrorCodes} from "~/shared/error/error_code.js";
import {ErrorDisplayMessageSchema, ErrorSchema} from "~/shared/error/error_schema.js";
import {FileCodePreviewContent} from "~/shared/files/file_code_preview_content.js";
import {FileContentTypeSchema} from "~/shared/files/file_content_type.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {
    FileAudioPreviewMetadataSchema,
    FileHasPreviewSchema,
    FileImagePreviewSizeSchema,
} from "~/shared/files/file_preview.js";
import {FileId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * If a file upload doesn't complete within this amount of time, we abort the
 * file upload.
 */
export const uploadFileTimeoutMs = 1000 * 60 * 5;

/**
 * An event sent to the client by `FileUploadService`'s upload route.
 */
export type UploadFileEvent = SchemaType<typeof UploadFileEventSchema>;

export const UploadFileEventSchema = Schema.union({
    Start: Schema.object({
        type: Schema.value("Start"),
        fileId: Schema.id<FileId>(),
        hasAlternative: Schema.boolean,
        hasPreview: FileHasPreviewSchema.nullable(),
        signedUrlSearch: Schema.string,
    }),
    Finish: Schema.object({
        type: Schema.value("Finish"),
    }),
    Alternative: Schema.object({
        type: Schema.value("Alternative"),
        contentType: FileContentTypeSchema,
        contentLength: Schema.integer,
        isImagePreviewContent: Schema.boolean,
    }),
    ImagePreviewSize: Schema.object({
        type: Schema.value("ImagePreviewSize"),
        size: FileImagePreviewSizeSchema,
    }),
    ImagePreviewPlaceholder: Schema.object({
        type: Schema.value("ImagePreviewPlaceholder"),
        placeholder: FileImagePreviewPlaceholder.schema,
    }),
    ImagePreviewContent: Schema.object({
        type: Schema.value("ImagePreviewContent"),
        contentType: FileContentTypeSchema,
        contentLength: Schema.integer,
    }),
    ImagePreviewVideoDuration: Schema.object({
        type: Schema.value("ImagePreviewVideoDuration"),
        videoDuration: Schema.integer,
    }),
    AudioPreviewDuration: Schema.object({
        type: Schema.value("AudioPreviewDuration"),
        duration: Schema.integer,
    }),
    AudioPreviewMetadata: Schema.object({
        type: Schema.value("AudioPreviewMetadata"),
        metadata: FileAudioPreviewMetadataSchema,
    }),
    CodePreviewContent: Schema.object({
        type: Schema.value("CodePreviewContent"),
        content: FileCodePreviewContent.schema,
    }),
    PreviewError: Schema.object({
        type: Schema.value("PreviewError"),
        error: Schema.object({
            code: Schema.enum(getErrorCodes()),
            displayMessage: ErrorDisplayMessageSchema,
        }),
    }),
    Error: Schema.object({
        type: Schema.value("Error"),
        error: ErrorSchema,
    }),
});
