import {
    ApiContentFileBlockElementResponseWithOptionalKeys,
    ApiContentPreviewBlockElementResponseWithOptionalKeys,
} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {
    computeFileRowLayout,
    fileRowBlockWidthPxForClipboardAndApi,
    fileRowDefaultPreviewHeightPx,
    fileRowMaxFileCount,
} from "~/shared/content/compute_file_row_layout.js";
import {getFileEntityPreviewHeight} from "~/shared/content/get_file_entity_preview_height.js";
import {getFilePreviewSize} from "~/shared/content/get_file_preview_size.js";
import {FilePreview} from "~/shared/files/file_preview.js";
import {FileId} from "~/shared/id/types/id_types.js";

export function computeApiContentFileRowWidths(
    elements: ReadonlyArray<
        | ApiContentFileBlockElementResponseWithOptionalKeys
        | ApiContentPreviewBlockElementResponseWithOptionalKeys
    >,
    options: {
        readonly getFileIfExists: (fileId: FileId) => FilePreview | undefined;
    },
): Array<number> {
    const layouts = computeFileRowLayout(
        elements.map(element => {
            if (element.type === "File") {
                const file = options.getFileIfExists(element.id);
                return getFilePreviewSize(file);
            }

            return {
                width: null,
                height: getFileEntityPreviewHeight({
                    fileCount: elements.length,
                    maxFileCount: fileRowMaxFileCount,
                    blockWidth: fileRowBlockWidthPxForClipboardAndApi,
                    defaultPreviewHeight: fileRowDefaultPreviewHeightPx,
                }),
            };
        }),
        {
            containerWidth: fileRowBlockWidthPxForClipboardAndApi,
            spacingScale: "small",
        },
    );

    // Round each width to 2 decimal places.
    const widths = layouts.map(layout => Math.round(layout.widthFr * 100) / 100);

    // Ensure widths sum to exactly 1 by deriving the last value from the rest. This
    // avoids floating point drift from rounding each value independently.
    if (widths.length > 0) {
        let sum = 0;
        for (let i = 0; i < widths.length - 1; i++) {
            sum += widths[i]!;
        }
        widths[widths.length - 1] = Math.round((1 - sum) * 100) / 100;
    }

    return widths;
}
