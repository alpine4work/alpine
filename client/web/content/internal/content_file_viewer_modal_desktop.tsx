import {
    DownloadSimple,
    FileDotted,
    Lock,
    MagnifyingGlassMinus,
    MagnifyingGlassPlus,
    SpinnerGap,
    X,
} from "phosphor-react";
import prettyBytes from "pretty-bytes";
import {useState} from "react";
import {FileModelRegistryData} from "~/client/web/content/file_registry.js";
import {ContentFileAudioViewerDesktop} from "~/client/web/content/internal/content_file_audio_viewer_desktop.js";
import {ContentFileCodeViewer} from "~/client/web/content/internal/content_file_code_viewer.js";
import {ContentFileImageViewerDesktop} from "~/client/web/content/internal/content_file_image_viewer_desktop.js";
import {ContentFilePdfViewer} from "~/client/web/content/internal/content_file_pdf_viewer.js";
import {handleDownloadContentFile} from "~/client/web/content/internal/content_file_preview.js";
import {ContentFileProcessorError} from "~/client/web/content/internal/content_file_processor_error.js";
import {ContentFileVideoViewerDesktop} from "~/client/web/content/internal/content_file_video_viewer_desktop.js";
import {
    contentFileViewerDesktopMarginBottom,
    contentFileViewerDesktopMarginTop,
    contentFileViewerDesktopMarginX,
    contentFileViewerLargeProcessingIndicatorColor,
    contentFileViewerLargeProcessingIndicatorFontSize,
    contentFileViewerLargeProcessingIndicatorGap,
    contentFileViewerLargeProcessingIndicatorIconSize,
    contentFileViewerLargeProcessingIndicatorWeight,
} from "~/client/web/content/internal/content_file_viewer_shared_styles.js";
import {ContentFileViewerLoaderData} from "~/client/web/content/internal/load_content_file_viewer_data.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {ErrorBodyRenderer} from "~/client/web/design/error_body_renderer.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {Modal} from "~/client/web/design/modal.js";
import {renderKeyboardShortcutHint} from "~/client/web/design/render_keyboard_shortcut_hint.js";
import {ErrorBoundary} from "~/client/web/helpers/error_boundary.js";
import {GlobalKeyDownEvent} from "~/client/web/helpers/global_key_down_event.js";
import {useResizeObserver} from "~/client/web/helpers/use_resize_observer.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {
    initialSelectionColorsClassName,
    invertLightSelectionColorsClassName,
    spinAnimationClassName,
} from "~/client/web/styles/styles.js";
import {getFileContentTypeName} from "~/shared/content/code/get_file_content_type_name.js";
import {convertRemLengthToPx, screenPaddingX, spacing} from "~/shared/design/core/spacing.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {isFileImageContentType} from "~/shared/files/file_content_type.js";
import {isFileModelDataLoading} from "~/shared/files/file_model.js";
import {getFileContentTypeNoun} from "~/shared/files/get_file_content_type_noun.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {clamp} from "~/shared/helpers/number/clamp.js";

/**
 * Render the provided file in a fullscreen modal on desktop platforms.
 *
 * IMPORTANT: If you make a change to preview rendering here you should also
 * consider making the same change to `renderContentFilePreview()` and
 * `<ContentFileViewerModalMobile>`. We have three renderers for every file type.
 * The inline preview, the fullscreen desktop modal, and the fullscreen mobile
 * modal. They should all look and behave about the same.
 */
export function ContentFileViewerModalDesktop({
    file,
    attachmentTarget,
    ownedByElement,
    loaderDataPromise,
    onClose,
}: {
    file: FileModelRegistryData;
    attachmentTarget: FileAttachmentTarget | "Uploader";
    ownedByElement: Element | null;
    loaderDataPromise: PromiseImmediate<ContentFileViewerLoaderData | null>;
    onClose: () => void;
}) {
    const clientInfo = useClientInfo();
    const {space} = useSpaceContext();

    const [viewerRef, viewerSize] = useResizeObserver();

    // Only allow zooming on image files that have finished loading.
    const withZoom =
        isFileImageContentType(file.contentType) &&
        file.preview?.type === "Image" &&
        (file.preview.isProcessing || file.preview.ok) &&
        file.preview.placeholder !== "Processing" &&
        file.preview.size !== "Processing";

    const initialZoomLevel = 0;
    const minZoomLevel = -3;
    const maxZoomLevel = 7;

    const [zoomLevel, setZoomLevel] = useState(initialZoomLevel);
    if (!withZoom && zoomLevel !== initialZoomLevel) setZoomLevel(initialZoomLevel);

    // Use an exponential scaling function for zoom. Each additional zoom needs to
    // reveal more detail than the last.
    const zoomScale = 2 ** zoomLevel;
    const maxZoomScale = 2 ** maxZoomLevel;

    const zoomIn = () => {
        setZoomLevel(zoomLevel => clamp(minZoomLevel, zoomLevel + 1, maxZoomLevel));
    };

    const zoomOut = () => {
        setZoomLevel(zoomLevel => clamp(minZoomLevel, zoomLevel - 1, maxZoomLevel));
    };

    const withProcessingIndicator =
        isFileModelDataLoading(file) &&
        // If the file has an image preview where the size or placeholder are processing
        // then we'll be showing a large spinner in the center of the entire modal so we
        // don't need to also show a small spinner here.
        !(
            file.preview?.type === "Image" &&
            (file.preview.size === "Processing" || file.preview.placeholder === "Processing")
        ) &&
        // If the file has a code preview where the preview is processing then we'll be
        // showing a large spinner in the center of the entire modal so we don't need to
        // also show a small spinner here.
        !(file.preview?.type === "Code" && file.preview.isProcessing);

    const fileContentTypeName = getFileContentTypeName(file.contentType);

    return (
        <Modal
            ownedByElement={ownedByElement}
            aria-label={fileContentTypeName}
            maxWidth="full"
            height="full"
            // More margin than `<SearchModal>` so when the two are overlapping on a narrow
            // screen they don't have the same width. Also gives the user more space to click
            // in the margins given the modal is otherwise width/height 100%.
            margin="7"
            // Background is a dark grey in both light and dark mode:
            //
            // 1. To bring focus to the content
            // 2. So content that's transparent and uses white or black is visible whether
            //    we're in light mode or dark mode
            backgroundColor={{light: "grey-70-opacity-80", dark: "grey-10-opacity-80"}}
            // As a fullscreen modal that almost completely covers the content below, we don't
            // benefit from using lighter grey colors in dark mode. Use the standard dark mode
            // shades in our content file viewer modal.
            withoutElevatedGrey
            borderRadius="2.5"
            // Given the attachment viewer opens in direct response to user interaction, it
            // feels faster to immediately open it without animation.
            withoutOpenAnimation
            withoutCloseButton
            withBlurBackdropFilter
            onClose={onClose}
        >
            <GlobalKeyDownEvent
                onGlobalKeyDown={event => {
                    if (
                        event.key === "=" &&
                        (clientInfo.isAppleDevice ? event.metaKey : event.ctrlKey)
                    ) {
                        event.preventDefault();
                        event.stopPropagation();
                        zoomIn();
                    }

                    if (
                        event.key === "-" &&
                        (clientInfo.isAppleDevice ? event.metaKey : event.ctrlKey)
                    ) {
                        event.preventDefault();
                        event.stopPropagation();
                        zoomOut();
                    }

                    if (
                        event.key === "0" &&
                        (clientInfo.isAppleDevice ? event.metaKey : event.ctrlKey)
                    ) {
                        event.preventDefault();
                        event.stopPropagation();
                        setZoomLevel(initialZoomLevel);
                    }
                }}
            >
                <Box
                    width="full"
                    height="full"
                    display="flex"
                    flexDirection="column"
                    overflow="hidden"
                    // By default use white for text. Make sure to invert our selection color in light
                    // mode since the default light mode selection color doesn't look good with white
                    // text.
                    color="grey-0-const"
                    className={invertLightSelectionColorsClassName}
                >
                    <Box
                        flexShrink="0"
                        height="12"
                        padding="2.5"
                        display="flex"
                        alignItems="center"
                    >
                        <Box
                            paddingLeft="2"
                            color={{light: "grey-20-const", dark: "grey-30-const"}}
                            display="flex"
                            alignItems="center"
                            gap="3"
                        >
                            <Box userSelect="text">
                                {fileContentTypeName} - {prettyBytes(file.contentLength)}
                            </Box>
                            {withProcessingIndicator && (
                                <Box
                                    display="flex"
                                    alignItems="center"
                                    gap="1"
                                    color={{light: "grey-30-const", dark: "grey-40-const"}}
                                    fontSize="50"
                                >
                                    <SpinnerGap
                                        className={spinAnimationClassName}
                                        size={spacing["4"]}
                                    />
                                    Processing
                                </Box>
                            )}
                        </Box>
                        <Box flexGrow="1" />
                        <Box display="flex" justifyContent="flex-end" alignItems="center" gap="2.5">
                            {withZoom && (
                                <>
                                    <IconButton
                                        variant="quiet-above-content-file-viewer-modal"
                                        description="Zoom in"
                                        tooltipPlacement="bottom"
                                        keyboardShortcutHint={renderKeyboardShortcutHint(
                                            clientInfo,
                                            "mod",
                                            "=",
                                        )}
                                        isDisabled={zoomLevel >= maxZoomLevel}
                                        onPress={zoomIn}
                                    >
                                        <MagnifyingGlassPlus />
                                    </IconButton>
                                    <IconButton
                                        variant="quiet-above-content-file-viewer-modal"
                                        description="Zoom out"
                                        tooltipPlacement="bottom"
                                        keyboardShortcutHint={renderKeyboardShortcutHint(
                                            clientInfo,
                                            "mod",
                                            "-",
                                        )}
                                        isDisabled={zoomLevel <= minZoomLevel}
                                        onPress={zoomOut}
                                    >
                                        <MagnifyingGlassMinus />
                                    </IconButton>
                                </>
                            )}
                            <Box paddingLeft="1">
                                <Button
                                    variant="neutral"
                                    icon={<DownloadSimple />}
                                    iconGap="1.5"
                                    isDisabled={file.isUploading}
                                    pressErrorTitle={`Couldn\u2019t download ${getFileContentTypeNoun(
                                        file.contentType,
                                    )}`}
                                    onPress={() => {
                                        handleDownloadContentFile({spaceId: space.id, file});
                                    }}
                                >
                                    Download
                                </Button>
                            </Box>
                            <IconButton
                                variant="quiet-above-content-file-viewer-modal"
                                description="Close"
                                withoutTooltip
                                onPress={onClose}
                            >
                                <X />
                            </IconButton>
                        </Box>
                    </Box>
                    <Box ref={viewerRef} flexGrow="1" overflow="hidden" position="relative">
                        <ErrorBoundary
                            fallback={({error}) => (
                                <Box
                                    width="full"
                                    height="full"
                                    paddingX={screenPaddingX}
                                    display="flex"
                                    justifyContent="center"
                                    alignItems="center"
                                >
                                    <Box maxWidth="96">
                                        <ErrorBodyRenderer
                                            icon={
                                                error instanceof ContentFileProcessorError &&
                                                error.cause.type === "PasswordProtected" ? (
                                                    <Lock weight="bold" />
                                                ) : undefined
                                            }
                                            title={
                                                error instanceof ContentFileProcessorError
                                                    ? error.title
                                                    : `Couldn\u2019t open ${getFileContentTypeNoun(
                                                          file.contentType,
                                                      )}`
                                            }
                                            error={error}
                                            colorSchemeOverride="dark"
                                        />
                                    </Box>
                                </Box>
                            )}
                        >
                            {viewerSize && (
                                <ContentFileDesktopViewer
                                    file={file}
                                    attachmentTarget={attachmentTarget}
                                    viewerSize={viewerSize}
                                    loaderDataPromise={loaderDataPromise}
                                    zoomScale={zoomScale}
                                    maxZoomScale={maxZoomScale}
                                />
                            )}
                        </ErrorBoundary>
                    </Box>
                </Box>
            </GlobalKeyDownEvent>
        </Modal>
    );
}

function ContentFileDesktopViewer(props: {
    file: FileModelRegistryData;
    attachmentTarget: FileAttachmentTarget | "Uploader";
    loaderDataPromise: PromiseImmediate<ContentFileViewerLoaderData | null>;
    viewerSize: {width: number; height: number};
    zoomScale: number;
    maxZoomScale: number;
}) {
    const {file, viewerSize} = props;

    const spacingScale = useSpacingScale();

    switch (props.file.contentType) {
        case "application/octet-stream": {
            return (
                <Box
                    width="full"
                    height="full"
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                >
                    <Box
                        display="flex"
                        flexDirection="column"
                        alignItems="center"
                        gap={contentFileViewerLargeProcessingIndicatorGap}
                        fontSize={contentFileViewerLargeProcessingIndicatorFontSize}
                        color={contentFileViewerLargeProcessingIndicatorColor}
                    >
                        <FileDotted
                            size={
                                spacing[contentFileViewerLargeProcessingIndicatorIconSize.desktop]
                            }
                            weight={contentFileViewerLargeProcessingIndicatorWeight.desktop}
                        />
                        <Box textAlign="center">
                            Unknown
                            <br />
                            {prettyBytes(props.file.contentLength)}
                        </Box>
                    </Box>
                </Box>
            );
        }
        case "image/apng":
        case "image/avif":
        case "image/gif":
        case "image/jpeg":
        case "image/png":
        case "image/svg+xml":
        case "image/webp":
        case "image/bmp":
        case "image/ico":
        case "image/tiff":
        case "image/heif": {
            return <ContentFileImageViewerDesktop {...props} />;
        }
        case "application/pdf":
        case "application/msword":
        case "application/vnd.ms-excel":
        case "application/vnd.ms-powerpoint":
        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        case "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
            return (
                <Box
                    width="full"
                    height="full"
                    paddingX={contentFileViewerDesktopMarginX}
                    paddingTop={contentFileViewerDesktopMarginTop}
                    paddingBottom={contentFileViewerDesktopMarginBottom}
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                    overflow="hidden"
                >
                    <ContentFilePdfViewer
                        file={file}
                        viewerWidth={
                            viewerSize.width -
                            convertRemLengthToPx(contentFileViewerDesktopMarginX, spacingScale) * 2
                        }
                        viewerHeight={
                            viewerSize.height -
                            convertRemLengthToPx(contentFileViewerDesktopMarginTop, spacingScale) -
                            convertRemLengthToPx(contentFileViewerDesktopMarginBottom, spacingScale)
                        }
                    />
                </Box>
            );
        }
        case "video/webm":
        case "video/mp4":
        case "video/quicktime":
        case "video/mpeg":
        case "video/x-matroska": {
            return <ContentFileVideoViewerDesktop {...props} />;
        }
        case "audio/mpeg":
        case "audio/wav":
        case "audio/webm":
        case "audio/ogg":
        case "audio/mp4": {
            return <ContentFileAudioViewerDesktop {...props} />;
        }
        case "text/plain":
        case "text/javascript":
        case "text/html":
        case "text/css":
        case "application/sql":
        case "text/x-python":
        case "text/x-typescript":
        case "application/x-sh":
        case "text/x-java":
        case "application/json":
        case "text/markdown":
        case "text/x-csharp":
        case "text/x-c++src":
        case "text/x-csrc":
        case "application/x-httpd-php":
        case "text/x-go":
        case "application/yaml":
        case "application/x-powershell":
        case "text/rust":
        case "text/x-kotlin":
        case "application/x-ruby":
        case "text/x-lua":
        case "application/xml":
        case "application/vnd.dart":
        case "text/x-swift":
        case "text/x-asm":
        case "application/wasm":
        case "text/x-scala":
        case "text/x-r":
        case "text/x-elixir":
        case "text/x-objcsrc":
        case "text/x-perl":
        case "text/x-haskell":
        case "text/x-solidity":
        case "text/x-clojure":
        case "text/x-erlang":
        case "text/x-ocaml": {
            return (
                <Box
                    width="full"
                    height="full"
                    paddingX={contentFileViewerDesktopMarginX}
                    paddingTop={contentFileViewerDesktopMarginTop}
                    paddingBottom={contentFileViewerDesktopMarginBottom}
                    userSelect={!file.preview?.isProcessing ? "text" : undefined}
                >
                    <Box
                        width="full"
                        height="full"
                        backgroundColor="grey-0"
                        boxShadow="elevation-20-above-content-file-viewer-modal"
                        borderRadius="1.5"
                        color="grey-100"
                        cursor={!file.preview?.isProcessing ? "text" : undefined}
                        overflow="hidden"
                        className={initialSelectionColorsClassName}
                    >
                        <ContentFileCodeViewer {...props} />
                    </Box>
                </Box>
            );
        }
        default:
            throw exhaustive(props.file.contentType);
    }
}
