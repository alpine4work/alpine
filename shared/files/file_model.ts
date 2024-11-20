import {ErrorSchema} from "~/shared/error/error_schema.js";
import {FileAlternativeSchema} from "~/shared/files/file_alternative.js";
import {FileContentTypeSchema} from "~/shared/files/file_content_type.js";
import {FileHasPreview, FilePreviewSchema} from "~/shared/files/file_preview.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {FileId} from "~/shared/id/types/id_types.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * Maximum size for a file uploaded to our service: 1 GB. This is the same
 * maximum file size as Slack.
 */
export const maxFileContentLength = 1e9;

/**
 * If a file processor doesn't finish processing within this amount of time, we
 * abort the file processor.
 */
export const fileProcessorTimeoutMs = 1000 * 60 * 5;

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
    private _hasPreview?: FileHasPreview;

    public get hasPreview(): FileHasPreview | null {
        if (this.preview === null) return null;

        if (this._hasPreview === undefined) {
            switch (this.preview.type) {
                case "Image":
                    this._hasPreview = {
                        type: "Image",
                        hasContent: this.preview.content !== undefined,
                        hasVideoDuration: this.preview.videoDuration !== undefined,
                    };
                    break;
                case "Audio":
                    this._hasPreview = {type: "Audio"};
                    break;
                case "Code":
                    this._hasPreview = {type: "Code"};
                    break;
                default:
                    throw exhaustive(this.preview);
            }
        }

        return this._hasPreview;
    }

    /**
     * Get the file with the smaller number of loading components. If both files
     * have the same number of loading components then we return `file1`.
     *
     * Because files are immutable after upload this function also assumes the
     * `contentType` doesn't change, the `preview` type doesn't change, and that
     * components that were previously loading won't enter a loading state at any
     * point in the future.
     *
     * This is similar in purpose to `AccountModel.merge()` or `TaskModel.merge()`
     * (which is powered by CRDTs). If we have two `FileModel`s representing the
     * same file we need to merge their data together with whatever the latest data
     * is. However, this function doesn't transpose like our other `merge()`
     * functions (since we prefer `file1` in case of conflict). It also doesn't
     * merge data we assume to be immutable (e.g. `contentType`). So this function
     * doesn't work as a mathematically sound merge function but it doesn't have
     * to. Assuming files are immutable after all components are loaded this
     * function gets the job done.
     */
    public static minLoadingCount(file1: FileModel, file2: FileModel): FileModel {
        const loadingCount1 = file1._getLoadingCount();
        const loadingCount2 = file2._getLoadingCount();

        if (loadingCount1 < loadingCount2) return file1;
        if (loadingCount1 > loadingCount2) return file2;
        return file1;
    }

    /**
     * Is there a component of this file that's still loading?
     */
    public isLoading(): boolean {
        return this._getLoadingCount() > 0;
    }

    /**
     * Count the number of components in the `FileModel` that are currently
     * loading. Given `FileModel`s are immutable we use this to determine which of
     * two `FileModel`s is "newer". The number of loading components should always
     * decrease monotonically and never increase.
     */
    private _getLoadingCount(): number {
        let loadingCount = 0;

        if (this.isUploading) {
            loadingCount++;
        }

        if (this.alternative?.isProcessing) {
            loadingCount++;
        }

        if (this.preview) {
            switch (this.preview.type) {
                case "Audio": {
                    // TypeScript will error here if any keys are added to `preview`. If you add
                    // any keys that could be processing that probably means you want to update
                    // the loading count calculation.
                    assertEqualTypes<
                        keyof typeof this.preview,
                        "type" | "isProcessing" | "duration" | "metadata"
                    >();

                    if (this.preview.duration === "Processing") {
                        loadingCount++;
                    }

                    if (this.preview.metadata === "Processing") {
                        loadingCount++;
                    }
                    break;
                }
                case "Code": {
                    // TypeScript will error here if any keys are added to `preview`. If you add
                    // any keys that could be processing that probably means you want to update
                    // the loading count calculation.
                    assertEqualTypes<
                        keyof typeof this.preview,
                        "type" | "isProcessing" | "content"
                    >();

                    if (this.preview.content === "Processing") {
                        loadingCount++;
                    }
                    break;
                }
                case "Image": {
                    if (this.preview.isProcessing) {
                        // TypeScript will error here if any keys are added to `preview`. If you add
                        // any keys that could be processing that probably means you want to update
                        // the loading count calculation.
                        assertEqualTypes<
                            keyof typeof this.preview,
                            | "type"
                            | "isProcessing"
                            | "size"
                            | "placeholder"
                            | "content"
                            | "videoDuration"
                        >();

                        if (this.preview.size === "Processing") {
                            loadingCount++;
                        }

                        if (this.preview.placeholder === "Processing") {
                            loadingCount++;
                        }

                        if (this.preview.content === "Processing") {
                            loadingCount++;
                        }

                        if (this.preview.videoDuration === "Processing") {
                            loadingCount++;
                        }
                    }
                    break;
                }
                default:
                    throw exhaustive(this.preview);
            }
        }

        return loadingCount;
    }

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

export const UploadFileResponseSchema = Schema.result(
    Schema.object({
        ok: Schema.value(true),
        signedUrlSearch: Schema.string,
        file: FileModel.schema(),
    }),
    Schema.object({
        ok: Schema.value(false),
        error: ErrorSchema,
    }),
);
