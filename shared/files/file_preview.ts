import {getErrorCodes} from "~/shared/error/error_code.js";
import {ErrorDisplayMessageSchema} from "~/shared/error/error_schema.js";
import {FileContentTypeSchema} from "~/shared/files/file_content_type.js";
import {FilePreviewPlaceholder} from "~/shared/files/file_preview_placeholder.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * A visual preview image for the file. Previews are a scaled down, often
 * non-interactive, display of a file. For example files displayed in a
 * document image gallery are previews.
 *
 * If the user clicks on a file it then opens up a fullscreen file viewer where
 * they'll see their file in full resolution.
 *
 * Ideally, every file has a preview. But some files don't have a useful visual
 * representation. For example, audio files or unknown binary files. If a file
 * doesn't have a preview then this object will be null.
 *
 * File previews are immutable after the file has been processed. However,
 * while the file is uploading various attributes may be the string
 * `"Processing"` as we process the file. For example, `size` will be
 * `"Processing"` until we parse the file and figure out its dimensions.
 *
 * Documentation for each property:
 *
 * - `size`: The width/height of the preview image.
 *
 *   For images and videos, the dimensions in this object are the same as the
 *   underlying file's dimensions. For documents like a PDF, the dimensions in
 *   this object are the dimensions of the first page in the document.
 *
 *   We don't keep track of a file's dimensions outside the preview object
 *   since dimensions don't make sense for files which don't have a preview
 *   image (e.g. audio files or raw bytes).
 *
 *   If our preview image is a scaled version of the original file, we'll include
 *   a `scale` property to record how much the source file was scaled. For
 *   example, PDF preview images are scaled up from the original PDF's dimensions
 *   to preserve detail in a rasterized image format. If the preview image doesn't
 *   really correspond with the source file's dimensions this value will be 1.
 *
 * - `placeholder`: Before the preview image loads, we immediately show a
 *   blurred placeholder representing the preview image. The placeholder is
 *   <700 bytes so it's cheap to send over the network.
 *
 * - `image`: If the file isn't itself a web safe image (one of
 *   `WebSafeImageFileContentType`) or not an image at all (e.g. a video or
 *   PDF) then we need to generate a preview image. If the file is a web safe
 *   image then we display the image as the image's own preview.
 *
 *   If `image` exists that means the file has a preview image located in
 *   Cloudflare R2 at `${spaceId}/${fileId}.preview`. If `image` is
 *   `"Processing"` that means we will eventually have a preview image file in
 *   Cloudflare R2 eventually but not right now.
 *
 *   If `image` is non-null then `size` and `placeholder` refer to the `image`
 *   property.
 *
 *   `image.contentType` is the type of the preview image in Cloudflare R2 and
 *   `image.contentLength` is the size of the preview image in bytes in
 *   Cloudflare R2.
 *
 * - `error`: If there was an acceptable error while processing the file then
 *   we finished uploading the file to Cloudflare R2 but we weren't able to
 *   generate a preview. So instead there's an error with a human readable
 *   `displayMessage` in this object.
 *
 *   An example of when you'll get an error here is if you upload a password
 *   protected PDF file. The PDF file successfully uploads but we can't show a
 *   preview because the file is encrypted.
 */
export type FilePreview = SchemaType<typeof FilePreviewSchema>;

export const FilePreviewSchema = Schema.booleanUnion(
    "isProcessing",
    Schema.object({
        isProcessing: Schema.value(true),
        size: processingSchema(
            Schema.object({
                width: Schema.integer,
                height: Schema.integer,
                scale: Schema.integer.default(1),
            }),
        ),
        placeholder: processingSchema(FilePreviewPlaceholder.schema),
        image: processingSchema(
            Schema.object({
                contentType: FileContentTypeSchema,
                contentLength: Schema.integer,
            }),
        ).optional(),
    }),
    Schema.result(
        Schema.object({
            isProcessing: Schema.value(false),
            ok: Schema.value(true),
            size: Schema.object({
                width: Schema.integer,
                height: Schema.integer,
                scale: Schema.integer.default(1),
            }),
            placeholder: FilePreviewPlaceholder.schema,
            image: Schema.object({
                contentType: FileContentTypeSchema,
                contentLength: Schema.integer,
            }).optional(),
        }),
        Schema.object({
            isProcessing: Schema.value(false),
            ok: Schema.value(false),
            // Not a full `ErrorSchema` since we store this in the database. Storing
            // properties like the stack trace, `original` trace, and `cause` don't
            // make sense for a persisted error.
            error: Schema.object({
                code: Schema.enum(getErrorCodes()),
                displayMessage: ErrorDisplayMessageSchema,
            }),
        }),
    ),
);

/**
 * Take a schema and give it an explicit `"Processing"` state. Under the hood
 * this uses `schema.nullable()` so in the database processing is treated as
 * null. In our code you must explicitly deal with the `"Processing"` state.
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
