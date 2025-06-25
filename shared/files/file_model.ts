import {FileAlternativeSchema} from "~/shared/files/file_alternative.js";
import {FileContentType, FileContentTypeSchema} from "~/shared/files/file_content_type.js";
import {FileHasPreview, FilePreviewSchema} from "~/shared/files/file_preview.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {FileId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export type FileModelData = SchemaType<typeof FileModelDataSchema>;

export const FileModelDataSchema = Schema.object({
    id: Schema.id<FileId>(),
    contentType: FileContentTypeSchema,
    contentLength: Schema.integer,
    isUploading: Schema.boolean,
    alternative: FileAlternativeSchema.nullable().default(null),
    preview: FilePreviewSchema.nullable(),
    // When `preview` is `"Image"` this is the base64 encoded image preview content
    // if it's under 100kb. So we can render the image content for small images
    // directly without needing to make a network request.
    imagePreviewContentIfSmall: Schema.string.optional(),
});

/**
 * The representation of a file in our system. Files are immutable after
 * they've been uploaded. Making a change to a file actually creates a new file
 * object. Files can be observed while they're uploading. A file where any of
 * `file.isProcessing`, `file.alternative.isProcessing`, or
 * `file.preview.isProcessing` are true means we're still actively uploading
 * and processing the file. The file will only be partially available if any of
 * these properties are true.
 *
 * File models store all their data which may change in an `initialData`
 * property. To access data on the client you should use `FileRegistry` in
 * order to get the latest data for a file. `FileRegistry` is also
 * responsible for polling a file while it's loading and refreshing file signed
 * URLs when they expire. Account models use a similar pattern (see
 * `AccountRegistry`).
 */
export class FileModel {
    // Immutable data for the file. Since this data doesn't change you don't have
    // to access it through `FileRegistry` or `initialData`.
    public readonly id: FileId;
    public readonly contentType: FileContentType;
    public readonly contentLength: number;

    /**
     * Don't use this property on the client! Use `FileRegistry` to get the
     * latest data for this file.
     */
    public readonly initialData: FileModelData;

    constructor(initialData: FileModelData) {
        this.id = initialData.id;
        this.contentType = initialData.contentType;
        this.contentLength = initialData.contentLength;
        this.initialData = initialData;
    }

    public static readonly schema = FileModelDataSchema.transform<FileModel>({
        serialize: account => account.initialData,
        deserialize: account => new FileModel(account),
    });

    private _hasPreview?: FileHasPreview;

    /**
     * Does this file have a preview? If so what type of preview does it have?
     * This object is immutable after a file has been created. Which is why you're
     * allowed to access it without going through `FileRegistry` or `initialData`.
     */
    public get hasPreview(): FileHasPreview | null {
        if (this.initialData.preview === null) return null;

        if (this._hasPreview === undefined) {
            switch (this.initialData.preview.type) {
                case "Image":
                    this._hasPreview = {
                        type: "Image",
                        hasContent: this.initialData.preview.content !== undefined,
                        hasVideoDuration: this.initialData.preview.videoDuration !== undefined,
                    };
                    break;
                case "Audio":
                    this._hasPreview = {type: "Audio"};
                    break;
                case "Code":
                    this._hasPreview = {type: "Code"};
                    break;
                default:
                    throw exhaustive(this.initialData.preview);
            }
        }

        return this._hasPreview;
    }

    public static minLoadingCount(file1: FileModel, file2: FileModel): FileModel {
        const fileData = minFileModelDataLoadingCount(file1.initialData, file2.initialData);
        if (fileData === file1.initialData) return file1;
        if (fileData === file2.initialData) return file2;
        return new FileModel(fileData);
    }
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
 * (which is powered by CRDTs). If we have two `FileModelData`s representing
 * the same file we need to merge their data together with whatever the latest
 * data is. However, this function doesn't transpose like our other `merge()`
 * functions (since we prefer `file1` in case of conflict). It also doesn't
 * merge data we assume to be immutable (e.g. `contentType`). So this function
 * doesn't work as a mathematically sound merge function but it doesn't have
 * to. Assuming files are immutable after all components are loaded this
 * function gets the job done.
 */
export function minFileModelDataLoadingCount(
    data1: FileModelData,
    data2: FileModelData,
): FileModelData {
    const loadingCount1 = getFileModelDataLoadingCount(data1);
    const loadingCount2 = getFileModelDataLoadingCount(data2);

    if (loadingCount1 < loadingCount2) {
        // We're returning `data1` but if `data2` has `imagePreviewContentIfSmall`
        // let's preserve that.
        if (!data1.imagePreviewContentIfSmall && data2.imagePreviewContentIfSmall)
            return {...data1, imagePreviewContentIfSmall: data2.imagePreviewContentIfSmall};

        return data1;
    }

    if (loadingCount1 > loadingCount2) {
        // We're returning `data2` but if `data1` has `imagePreviewContentIfSmall`
        // let's preserve that.
        if (!data2.imagePreviewContentIfSmall && data1.imagePreviewContentIfSmall)
            return {...data2, imagePreviewContentIfSmall: data1.imagePreviewContentIfSmall};

        return data2;
    }

    // We're returning `data1` but if `data2` has `imagePreviewContentIfSmall`
    // let's preserve that.
    if (!data1.imagePreviewContentIfSmall && data2.imagePreviewContentIfSmall)
        return {...data1, imagePreviewContentIfSmall: data2.imagePreviewContentIfSmall};

    return data1;
}

/**
 * Is there a component of this file that's still loading?
 */
export function isFileModelDataLoading(data: FileModelData): boolean {
    return getFileModelDataLoadingCount(data) > 0;
}

/**
 * Count the number of components in the `FileModel` that are currently
 * loading. Given `FileModel`s are immutable we use this to determine which of
 * two `FileModel`s is "newer". The number of loading components should always
 * decrease monotonically and never increase.
 */
function getFileModelDataLoadingCount(data: FileModelData): number {
    let loadingCount = 0;

    if (data.isUploading) {
        loadingCount++;
    }

    if (data.alternative?.isProcessing) {
        loadingCount++;
    }

    if (data.preview) {
        switch (data.preview.type) {
            case "Audio": {
                // TypeScript will error here if any keys are added to `preview`. If you add
                // any keys that could be processing that probably means you want to update
                // the loading count calculation.
                assertEqualTypes<
                    keyof typeof data.preview,
                    "type" | "isProcessing" | "duration" | "metadata"
                >();

                if (data.preview.duration === "Processing") {
                    loadingCount++;
                }

                if (data.preview.metadata === "Processing") {
                    loadingCount++;
                }
                break;
            }
            case "Code": {
                // TypeScript will error here if any keys are added to `preview`. If you add
                // any keys that could be processing that probably means you want to update
                // the loading count calculation.
                assertEqualTypes<keyof typeof data.preview, "type" | "isProcessing" | "content">();

                if (data.preview.content === "Processing") {
                    loadingCount++;
                }
                break;
            }
            case "Image": {
                if (data.preview.isProcessing) {
                    // TypeScript will error here if any keys are added to `preview`. If you add
                    // any keys that could be processing that probably means you want to update
                    // the loading count calculation.
                    assertEqualTypes<
                        keyof typeof data.preview,
                        | "type"
                        | "isProcessing"
                        | "size"
                        | "placeholder"
                        | "content"
                        | "videoDuration"
                    >();

                    if (data.preview.size === "Processing") {
                        loadingCount++;
                    }

                    if (data.preview.placeholder === "Processing") {
                        loadingCount++;
                    }

                    if (data.preview.content === "Processing") {
                        loadingCount++;
                    }

                    if (data.preview.videoDuration === "Processing") {
                        loadingCount++;
                    }
                }
                break;
            }
            default:
                throw exhaustive(data.preview);
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
export function getFileModelDataAttachReadiness(
    data: FileModelData,
): "Ready" | "PreviewPartiallyAvailable" | "PreviewUnavailable" {
    if (data.preview === null) return "Ready";

    switch (data.preview.type) {
        case "Image": {
            if (!data.preview.isProcessing) return "Ready";

            if (
                data.preview.size !== "Processing" &&
                data.preview.placeholder !== "Processing" &&
                data.preview.videoDuration !== "Processing"
            ) {
                return "Ready";
            }

            if (data.preview.size !== "Processing") {
                return "PreviewPartiallyAvailable";
            }

            return "PreviewUnavailable";
        }
        case "Audio": {
            return data.preview.duration !== "Processing" ? "Ready" : "PreviewUnavailable";
        }
        case "Code": {
            return data.preview.content !== "Processing" ? "Ready" : "PreviewUnavailable";
        }
        default:
            throw exhaustive(data.preview);
    }
}
