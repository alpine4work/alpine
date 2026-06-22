import {
    ApiContentFileBlockElementResponseWithOptionalKeys,
    ApiContentPreviewBlockElementResponseWithOptionalKeys,
} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {
    computeFileRowWidths,
    fileRowBlockWidthPxForServerAndClipboard,
    fileRowDefaultPreviewHeightPx,
    fileRowMaxFileCount,
} from "~/shared/content/compute_file_row_widths.js";
import {getFileEntityPreviewHeight} from "~/shared/content/get_file_entity_preview_height.js";
import {getFilePreviewSizeForLayout} from "~/shared/content/get_file_preview_size.js";
import {FileContentType} from "~/shared/files/file_content_type.js";
import {FileId} from "~/shared/id/types/id_types.js";

export function computeApiContentFileRowWidths(
    elements: ReadonlyArray<
        | ApiContentFileBlockElementResponseWithOptionalKeys
        | ApiContentPreviewBlockElementResponseWithOptionalKeys
    >,
    options: {
        readonly getFileIfExists: (fileId: FileId) =>
            | {
                  contentType: FileContentType;
                  size?: {width: number | null; height: number; scale?: number} | null;
              }
            | undefined;
    },
): Array<number> {
    return computeFileRowWidths(
        elements.map(element => {
            if (element.type === "File" && element.id !== null) {
                const file = options.getFileIfExists(element.id);
                if (file) {
                    return getFilePreviewSizeForLayout({
                        contentType: file.contentType,
                        size: file.size,
                    });
                }
            }

            return {
                width: null,
                height: getFileEntityPreviewHeight({
                    fileCount: elements.length,
                    maxFileCount: fileRowMaxFileCount,
                    blockWidth: fileRowBlockWidthPxForServerAndClipboard,
                    defaultPreviewHeight: fileRowDefaultPreviewHeightPx,
                }),
            };
        }),
        {containerWidth: fileRowBlockWidthPxForServerAndClipboard},
    );
}
