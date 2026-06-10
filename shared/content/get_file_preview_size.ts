import {minAspectRatioIfNotSingleFileRow} from "~/shared/content/compute_file_row_widths.js";
import {contentLargeFallbackFileWidthPx} from "~/shared/design/core/content_shared_styles.js";
import {FileContentType, isFileCodeContentType} from "~/shared/files/file_content_type.js";
import {FileModelData} from "~/shared/files/file_model.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * The maximum width:height aspect ratio we support when rendering images. Images
 * with a wider aspect ratio will be cropped. Super wide image start to look bad
 * with our layout engine since they start shrinking (to stay within the document's
 * bounds) until there's barely any visible height.
 *
 * It's the inverse of `minAspectRatioIfNotSingleFileRow`. Wider images may look
 * better than taller images so we could consider increasing this if there's a good
 * use case.
 */
const maxAspectRatioIfNotSingleFileRow = minAspectRatioIfNotSingleFileRow ** -1;

/**
 * The fallback file aspect ratio we use when we don't have a way to preview the
 * file. For example binary files or files with an error message.
 */
const fallbackFileAspectRatio = 3 / 2;

const smallFallbackFileWidth = 200;
const smallFallbackFileHeight = smallFallbackFileWidth / fallbackFileAspectRatio;
const smallFallbackFileSize = {width: smallFallbackFileWidth, height: smallFallbackFileHeight};

/**
 * Get the original size of the file's preview in pixels. When laying out files
 * we'll try to preserve the width/height aspect ratio from this function. We also
 * won't grow the file to a size larger than the width/height returned by this
 * function but we will shrink files to fit in our available space if necessary.
 */
export function getFilePreviewSize(file: FileModelData | null): {
    width: number;
    height: number;
} {
    const largeFallbackWidth = contentLargeFallbackFileWidthPx;
    const largeFallbackHeight = largeFallbackWidth / fallbackFileAspectRatio;
    const largeFallbackSize = {width: largeFallbackWidth, height: largeFallbackHeight};

    if (!file?.preview) {
        return smallFallbackFileSize;
    }

    switch (file.preview.type) {
        case "Audio": {
            // Use the larger `remPx` size (mobile). The file will be scaled down as necessary.
            const width = largeFallbackWidth;
            const height = width / maxAspectRatioIfNotSingleFileRow;
            return {width, height};
        }
        case "Code": {
            // Pick an aspect ratio that shows all 16 lines of code and a line width of almost
            // exactly 80 characters (at font size 75).
            const aspectRatio = 63 / 32;

            // Use the larger `remPx` size (mobile) and the larger block max width (mobile).
            // The file will be scaled down as necessary.
            const width = largeFallbackWidth;
            const height = largeFallbackWidth / aspectRatio;
            return {width, height};
        }
        case "Image": {
            if (file.preview.size === "Processing") return largeFallbackSize;
            if (file.preview.size === "Error") return smallFallbackFileSize;

            return {
                width:
                    file.preview.size.width /
                    // We render PDFs at 2x their actual width/height so they look good on retina
                    // displays at their proper size.
                    Math.max(1, file.preview.size.scale),
                height:
                    file.preview.size.height /
                    // We render PDFs at 2x their actual width/height so they look good on retina
                    // displays at their proper size.
                    Math.max(1, file.preview.size.scale),
            };
        }
        default:
            throw exhaustive(file.preview);
    }
}

/**
 * Get the preview size for a file based on its content type and optional
 * dimensions. This is the simplified version of `getFilePreviewSize` for use when
 * only `FileContentType` and optional dimensions are available (e.g. in the API
 * layer) rather than a full `FileModelData` with preview metadata.
 *
 * When laying out files we'll try to preserve the width/height aspect ratio from
 * this function. We also won't grow the file to a size larger than the
 * width/height returned by this function but we will shrink files to fit in our
 * available space if necessary.
 */
export function getFilePreviewSizeForLayout(file: {
    contentType: FileContentType;
    size?: {width: number | null; height: number; scale?: number} | null;
}): {width: number; height: number} {
    const largeFallbackWidth = contentLargeFallbackFileWidthPx;
    const largeFallbackHeight = largeFallbackWidth / fallbackFileAspectRatio;
    const largeFallbackSize = {width: largeFallbackWidth, height: largeFallbackHeight};

    if (file.contentType.startsWith("audio/")) {
        // Use the larger `remPx` size (mobile). The file will be scaled down as necessary.
        const width = largeFallbackWidth;
        const height = width / maxAspectRatioIfNotSingleFileRow;
        return {width, height};
    }

    if (isFileCodeContentType(file.contentType)) {
        // Pick an aspect ratio that shows all 16 lines of code and a line width of almost
        // exactly 80 characters (at font size 75).
        const aspectRatio = 63 / 32;

        // Use the larger `remPx` size (mobile) and the larger block max width (mobile).
        // The file will be scaled down as necessary.
        const width = largeFallbackWidth;
        const height = largeFallbackWidth / aspectRatio;
        return {width, height};
    }

    if (file.size != null) {
        if (file.size.width == null) {
            return largeFallbackSize;
        }

        return {
            width:
                file.size.width /
                // We render PDFs at 2x their actual width/height so they look good on retina
                // displays at their proper size.
                Math.max(1, file.size.scale ?? 1),
            height:
                file.size.height /
                // We render PDFs at 2x their actual width/height so they look good on retina
                // displays at their proper size.
                Math.max(1, file.size.scale ?? 1),
        };
    }

    return smallFallbackFileSize;
}
