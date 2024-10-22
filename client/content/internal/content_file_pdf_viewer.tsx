import {getFilePreviewSize} from "~/client/content/internal/content_file_layout_computations.js";
import {getFileContentTypeName} from "~/client/content/internal/get_file_content_type_name.js";
import {getContentFileViewerSrc} from "~/client/content/internal/load_content_file_viewer_data.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {sprinkles} from "~/client/styles/styles.js";
import {FileModel} from "~/shared/files/file_model.js";

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
    signedUrlSearch,
    viewerWidth,
    viewerHeight,
}: {
    file: FileModel;
    signedUrlSearch: string;
    viewerWidth: number;
    viewerHeight: number;
}) {
    const clientInfo = useClientInfo();
    const isMobile = useIsMobile();
    const {space} = useSpaceContext();

    const src = getContentFileViewerSrc({spaceId: space.id, signedUrlSearch, file});

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
                    // Customize the PDF view based on arguments supported by various rendering
                    // engines:
                    // https://tinytip.co/tips/html-pdf-params
                    src={
                        clientInfo.renderingEngine === "Blink"
                            ? `${src}#view=Fit`
                            : clientInfo.renderingEngine === "Gecko"
                            ? `${src}#zoom=${Math.round(Math.min(1, fileScale) * 100)}`
                            : src
                    }
                    // In WebKit the PDF `<iframe>` has no toolbar or sidebar and the PDF is
                    // rendered to fill the available space. So render using our document's actual
                    // size. In other rendering engines give the PDF `<iframe>` the full width.
                    width={
                        clientInfo.renderingEngine === "WebKit" && !isMobile
                            ? fileSize.width * fileScale
                            : viewerWidth
                    }
                    height={
                        clientInfo.renderingEngine === "WebKit" && !isMobile
                            ? fileSize.height * fileScale
                            : viewerHeight
                    }
                />
            )}
        </>
    );
}
