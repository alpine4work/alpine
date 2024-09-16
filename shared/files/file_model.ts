import {FileContentTypeSchema} from "~/shared/files/file_content_type.js";
import {FilePreviewSchema} from "~/shared/files/file_preview.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {FileId} from "~/shared/id/types/id_types.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema} from "~/shared/schema/schema.js";

export const FileAlternativeSchema = Schema.booleanUnion(
    "isProcessing",
    Schema.object({
        isProcessing: Schema.value(true),
    }),
    Schema.object({
        isProcessing: Schema.value(false),
        contentType: FileContentTypeSchema,
        contentLength: Schema.integer,
        isImagePreviewContent: Schema.boolean,
    }),
);

/**
 * The representation of a file in our system. Files are immutable after
 * they've been uploaded. Making a change to a file actually creates a new file
 * object. Files can be observed while they're uploading. A file where any of
 * `file.isProcessing`, `file.alternative.isProcessing`, or
 * `file.preview.isProcessing` are true means we're still actively uploading
 * and processing the file. The file will only be partially available if any of
 * these properties are true.
 */
export class FileModel extends Model(
    Schema.object({
        id: Schema.id<FileId>(),
        contentType: FileContentTypeSchema,
        contentLength: Schema.integer,
        isUploading: Schema.boolean,
        alternative: FileAlternativeSchema.nullable().default(null),
        preview: FilePreviewSchema.nullable(),
    }),
) {
    /**
     * Get whether the file is ready to be attached to whatever content the user
     * is editing.
     *
     * - `Ready`: The file is ready to be attached.
     *
     * - `PreviewUnavailable`: The file is not ready to be attached since we don't
     *   have a good preview for the file yet. While it's technically possible to
     *   attach a file while its preview is unavailable the experience won't be
     *   great for the user since they won't be able to preview the file. The
     *   layout of the file in the user's content may also shift once we process
     *   the file's size.
     *
     * - `PreviewPartiallyAvailable`: The fast parts of our file's preview have
     *   finished processing but other components of the file's preview haven't
     *   finished processing. If a client receives this value they should wait
     *   `delayLoadingIndicatorLimitMs` and if the file doesn't become `Ready`
     *   during that time then show the preview anyway with a loading spinner.
     */
    public getAttachReadiness(): "Ready" | "PreviewPartiallyAvailable" | "PreviewUnavailable" {
        if (this.preview === null) return "Ready";

        switch (this.preview.type) {
            case "Image": {
                if (!this.preview.isProcessing) return "Ready";

                if (
                    this.preview.size !== "Processing" &&
                    this.preview.placeholder !== "Processing" &&
                    this.preview.videoDuration !== "Processing"
                ) {
                    return "Ready";
                }

                if (this.preview.size !== "Processing") {
                    return "PreviewPartiallyAvailable";
                }

                return "PreviewUnavailable";
            }
            case "Audio": {
                return this.preview.duration !== "Processing" ? "Ready" : "PreviewUnavailable";
            }
            case "Code": {
                return this.preview.content !== "Processing" ? "Ready" : "PreviewUnavailable";
            }
            default:
                throw exhaustive(this.preview);
        }
    }
}
