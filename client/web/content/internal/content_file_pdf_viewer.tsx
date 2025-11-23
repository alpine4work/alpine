import {FileModelRegistryData} from "~/client/web/content/file_registry.js";
import {ContentFileProcessorError} from "~/client/web/content/internal/content_file_processor_error.js";
import {getContentFileViewerSrc} from "~/client/web/content/internal/load_content_file_viewer_data.js";
import {getFilePreviewSize} from "~/client/web/content/state/content_file_layout_computations.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {getFileContentTypeName} from "~/shared/content/code/get_file_content_type_name.js";

// TODO(calebmer): Currently we render PDFs using the browser's built in
// `<iframe>`. This is not the best user experience (e.g. the `<iframe>` traps
// keyboard events), it's inconsistent across browsers, and it gives us no
// rendering control so we can't add interactive features like comments in the
// future. We should find a different rendering solution for PDFs long term.
//
// NOTE(calebmer, #mobile-webkit-weirdness): Super annoying, mobile Safari only
// renders the first page of PDFs and won't render PDFs with a password.
export function ContentFilePdfViewer({
    file,
    viewerWidth,
    viewerHeight,
}: {
    file: FileModelRegistryData;
    viewerWidth: number;
    viewerHeight: number;
}) {
    if (file.alternative && !file.alternative.isProcessing && !file.alternative.ok) {
        throw new ContentFileProcessorError(file.contentType, file.alternative.error);
    }

    const clientInfo = useClientInfo();
    const platform = usePlatform();
    const {space} = useSpaceContext();

    const src = getContentFileViewerSrc({
        spaceId: space.id,
        file,
    });

    const viewerAspectRatio = viewerWidth / viewerHeight;

    const fileSize = getFilePreviewSize(file);
    const fileAspectRatio = fileSize.width / fileSize.height;

    let fileScale: number;
    if (fileAspectRatio > viewerAspectRatio) {
        const resizedFileWidth = viewerWidth;
        fileScale = resizedFileWidth / fileSize.width;
    } else {
        const resizedFileHeight = viewerHeight;
        fileScale = resizedFileHeight / fileSize.height;
    }

    return (
        <>
            {src && (
                <iframe
                    className={sprinkles({
                        boxShadow: "elevation-20-above-content-file-viewer-modal",
                    })}
                    title={getFileContentTypeName(file.contentType)}
                    src={src}
                    // In WebKit the PDF `<iframe>` has no toolbar or sidebar and the PDF is
                    // rendered to fill the available space. So render using our document's actual
                    // size. In other rendering engines give the PDF `<iframe>` the full width.
                    width={
                        clientInfo.renderingEngine === "WebKit" && platform !== "mobile"
                            ? fileSize.width * fileScale
                            : viewerWidth
                    }
                    height={
                        clientInfo.renderingEngine === "WebKit" && platform !== "mobile"
                            ? fileSize.height * fileScale
                            : viewerHeight
                    }
                />
            )}
        </>
    );
}
