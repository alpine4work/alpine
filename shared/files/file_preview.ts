import {FileCodePreviewContent} from "~/shared/files/file_code_preview_content.js";
import {FileContentTypeSchema} from "~/shared/files/file_content_type_schema.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileProcessorError, FileProcessorErrorSchema} from "~/shared/files/file_processor_error.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.open_source.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export type FileImagePreviewSize = SchemaType<typeof FileImagePreviewSizeSchema>;

/**
 * The size of the preview.
 *
 * - `width`: How wide is the preview?
 *
 * - `height`: How tall is the preview?
 *
 * - `scale`: Represents the scale at which the preview was rendered. Only really
 *   relevant for vector formats like `.pdf`. For example, we render the `.pdf`
 *   preview image at 2x the file's dimensions so we don't lose detail on retina
 *   screens. So `scale` is typically 2 for `.pdf`s. For images and other raster
 *   formats `scale` is basically always 1.
 *
 * - `hasAlpha`: Is there an alpha channel in the image?
 *
 *     Is sometimes true even if all pixels in the preview image have an alpha
 *     value of 1. True means an alpha channel is definitely present in the image
 *     even if it doesn't contribute to the image. If you want to check if the
 *     image has transparent pixels then one approach is to look at `placeholder`
 *     which averages the preview image's pixels together.
 */
export const FileImagePreviewSizeSchema = Schema.object({
    width: Schema.integer,
    height: Schema.integer,
    scale: Schema.float.default(1),
    hasAlpha: Schema.boolean.default(false),
});

/**
 * A visual preview image for the file. Previews are a scaled down, often
 * non-interactive, display of a file. For example files displayed in a document
 * image gallery are previews.
 *
 * If the user clicks on a file it then opens up a fullscreen file viewer where
 * they'll see their file in full resolution.
 *
 * Ideally, every file has a preview. But some files don't have a useful visual
 * representation. For example, audio files or unknown binary files. If a file
 * doesn't have a preview then this object will be null.
 *
 * File previews are immutable after the file has been processed. However, while
 * the file is uploading various attributes may be the string `"Processing"` as we
 * process the file. For example, `size` will be `"Processing"` until we parse the
 * file and figure out its dimensions.
 *
 * Documentation for each property:
 *
 * - `size`: The width/height of the preview image.
 *
 *     For images and videos, the dimensions in this object are the same as the
 *     underlying file's dimensions. For documents like a PDF, the dimensions in
 *     this object are the dimensions of the first page in the document.
 *
 *     We don't keep track of a file's dimensions outside the preview object since
 *     dimensions don't make sense for files which don't have a preview image (e.g.
 *     audio files or raw bytes).
 *
 * - `placeholder`: Before the preview image loads, we immediately show a blurred
 *   placeholder representing the preview image. The placeholder is <700 bytes so
 *   it's cheap to send over the network.
 *
 * - `content`: If the file isn't itself a web safe image (one of
 *   `WebSafeImageFileContentType`) or not an image at all (e.g. a video or PDF)
 *   then we need to generate a preview image. If the file is a web safe image then
 *   we display the image as the image's own preview.
 *
 *     If `content` exists that means the file has a preview image located in
 *     Cloudflare R2 at `${spaceId}/${fileId}-preview`. If `content` is
 *     `"Processing"` that means we will eventually have a preview image file in
 *     Cloudflare R2 eventually but not right now.
 *
 *     If `content` is non-null then `size` and `placeholder` refer to the
 *     `content` property.
 *
 *     `content.contentType` is the type of the preview image in Cloudflare R2 and
 *     `content.contentLength` is the size of the preview image in bytes in
 *     Cloudflare R2.
 *
 * - `videoDuration`: If the file is a video then this is the duration of the video
 *   in milliseconds. This property is only present on previews for videos.
 *
 * - `error`: If there was an acceptable error while processing the file then we
 *   finished uploading the file to Cloudflare R2 but we weren't able to generate a
 *   preview. So instead there's an error with a human readable `displayMessage` in
 *   this object.
 *
 *     An example of when you'll get an error here is if you upload a password
 *     protected PDF file. The PDF file successfully uploads but we can't show a
 *     preview because the file is encrypted.
 */
export type FileImagePreview = SchemaType<typeof FileImagePreviewSchema>;

export const FileImagePreviewSchema = Schema.booleanUnion(
    "isProcessing",
    Schema.object({
        type: Schema.value("Image"),
        isProcessing: Schema.value(true),
        size: processingSchema(FileImagePreviewSizeSchema),
        placeholder: processingSchema(FileImagePreviewPlaceholder.schema),
        content: processingSchema(
            Schema.object({
                contentType: FileContentTypeSchema,
                contentLength: Schema.integer,
            }),
        ).optional(),
        videoDuration: processingSchema(Schema.integer).optional(),
    }),
    Schema.result(
        Schema.object({
            type: Schema.value("Image"),
            isProcessing: Schema.value(false),
            ok: Schema.value(true),
            size: FileImagePreviewSizeSchema,
            placeholder: FileImagePreviewPlaceholder.schema,
            content: Schema.object({
                contentType: FileContentTypeSchema,
                contentLength: Schema.integer,
            }).optional(),
            videoDuration: Schema.integer.optional(),
        }),
        Schema.object({
            type: Schema.value("Image"),
            isProcessing: Schema.value(false),
            ok: Schema.value(false),
            error: FileProcessorErrorSchema,
            size: errorSchema(FileImagePreviewSizeSchema),
            placeholder: errorSchema(FileImagePreviewPlaceholder.schema),
            content: errorSchema(
                Schema.object({
                    contentType: FileContentTypeSchema,
                    contentLength: Schema.integer,
                }),
            ).optional(),
            videoDuration: errorSchema(Schema.integer).optional(),
        }),
    ),
).validation(
    "When `isProcessing` is true some preview data must be processing",
    preview =>
        !preview.isProcessing ||
        preview.size === "Processing" ||
        preview.placeholder === "Processing" ||
        preview.content === "Processing" ||
        preview.videoDuration === "Processing",
);

export type FileAudioPreviewMetadata = SchemaType<typeof FileAudioPreviewMetadataSchema>;

export const FileAudioPreviewMetadataSchema = Schema.object({
    title: Schema.string.nullable(),
    artist: Schema.string.nullable(),
    album: Schema.string.nullable(),
});

/**
 * Preview we display for audio files. For audio all we show is the duration of the
 * audio in the preview. That's all the relevant information there is to render
 * visually. This makes audio previews a lot simpler than `FileImagePreview`. The
 * duration is in milliseconds.
 */
export type FileAudioPreview = SchemaType<typeof FileAudioPreviewSchema>;

export const FileAudioPreviewSchema = Schema.booleanUnion(
    "isProcessing",
    Schema.object({
        type: Schema.value("Audio"),
        isProcessing: Schema.value(true),
        duration: processingSchema(Schema.integer),
        metadata: processingSchema(FileAudioPreviewMetadataSchema).optional(),
    }),
    Schema.result(
        Schema.object({
            type: Schema.value("Audio"),
            isProcessing: Schema.value(false),
            ok: Schema.value(true),
            duration: Schema.integer,
            metadata: FileAudioPreviewMetadataSchema.optional(),
        }),
        Schema.object({
            type: Schema.value("Audio"),
            isProcessing: Schema.value(false),
            ok: Schema.value(false),
            error: FileProcessorErrorSchema,
            duration: errorSchema(Schema.integer),
            metadata: errorSchema(FileAudioPreviewMetadataSchema).optional(),
        }),
    ),
).validation(
    "When `isProcessing` is true some preview data must be processing",
    preview =>
        !preview.isProcessing ||
        preview.duration === "Processing" ||
        preview.metadata === "Processing",
);

/**
 * Preview we display for code files. For code files we take the first few lines,
 * syntax highlight them, and include those in a preview.
 */
export type FileCodePreview = SchemaType<typeof FileCodePreviewSchema>;

export const FileCodePreviewSchema = Schema.booleanUnion(
    "isProcessing",
    Schema.object({
        type: Schema.value("Code"),
        isProcessing: Schema.value(true),
        content: processingSchema(FileCodePreviewContent.schema),
    }),
    Schema.result(
        Schema.object({
            type: Schema.value("Code"),
            isProcessing: Schema.value(false),
            ok: Schema.value(true),
            content: FileCodePreviewContent.schema,
        }),
        Schema.object({
            type: Schema.value("Code"),
            isProcessing: Schema.value(false),
            ok: Schema.value(false),
            error: FileProcessorErrorSchema,
            content: errorSchema(FileCodePreviewContent.schema),
        }),
    ),
).validation(
    "When `isProcessing` is true some preview data must be processing",
    preview => !preview.isProcessing || preview.content === "Processing",
);

export type FilePreview = SchemaType<typeof FilePreviewSchema>;

export const FilePreviewSchema = Schema.union({
    Image: FileImagePreviewSchema,
    Audio: FileAudioPreviewSchema,
    Code: FileCodePreviewSchema,
});

// All file previews must have a processing state, a finished processing state, and
// a failed processing state.
assertAssignableTypes<
    FilePreview,
    | {isProcessing: true}
    | {isProcessing: false; ok: true}
    | {isProcessing: false; ok: false; error: FileProcessorError}
>();

export type FileHasPreview = SchemaType<typeof FileHasPreviewSchema>;

export const FileHasPreviewSchema = Schema.union({
    Image: Schema.object({
        type: Schema.value("Image"),
        hasContent: Schema.boolean,
        hasVideoDuration: Schema.boolean,
    }),
    Audio: Schema.object({
        type: Schema.value("Audio"),
    }),
    Code: Schema.object({
        type: Schema.value("Code"),
    }),
});

/**
 * Take a schema and give it an explicit `"Processing"` state. Under the hood this
 * uses `schema.nullable()` so in the database processing is treated as null. In
 * our code you must explicitly deal with the `"Processing"` state.
 */
function processingSchema<Value>(schema: Schema<Value>): Schema<Value | "Processing"> {
    return schema.nullable().transform<Value | "Processing">({
        serialize: value => {
            // `value` must not be null or else the serialized value may be ambiguous.
            assert(value !== null);

            return value === "Processing" ? null : value;
        },
        deserialize: value => {
            // `value` must not be `"Processing"` or else the serialized value may be
            // ambiguous.
            assert(value !== "Processing");

            return value === null ? "Processing" : value;
        },
    });
}

/**
 * Take a schema and give it an explicit `"Error"` state. Under the hood this uses
 * `schema.nullable()` so in the database processing is treated as null. In our
 * code you must explicitly deal with the `"Error"` state.
 */
function errorSchema<Value>(schema: Schema<Value>): Schema<Value | "Error"> {
    return schema.nullable().transform<Value | "Error">({
        serialize: value => {
            // `value` must not be null or else the serialized value may be ambiguous.
            assert(value !== null);

            return value === "Error" ? null : value;
        },
        deserialize: value => {
            // `value` must not be `"Error"` or else the serialized value may be ambiguous.
            assert(value !== "Error");

            return value === null ? "Error" : value;
        },
    });
}
