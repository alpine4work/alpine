/* eslint-disable jsx-a11y/alt-text */

import classNames from "classnames";
import {DownloadSimple, MagnifyingGlassMinus, MagnifyingGlassPlus, X} from "phosphor-react";
import prettyBytes from "pretty-bytes";
import {Schema as ProsemirrorSchema} from "prosemirror-model";
import {CSSProperties, useEffect, useMemo, useRef, useState} from "react";
import {getFilePreviewSize} from "~/client/content/internal/content_file_layout_computations.js";
import {getFileContentTypeName} from "~/client/content/internal/get_file_content_type_name.js";
import {
    ContentFilePreviewExpirationTimers,
    getFileImagePreviewRenderingAdjustments,
    handleCopyContentFile,
    handleDownloadContentFile,
    renderFileImagePreviewPlaceholder,
} from "~/client/content/internal/render_content_file_preview.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {ContextMenuActions} from "~/client/design/context_menu.js";
import {useRemPx} from "~/client/design/helpers/use_rem_px.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuAction} from "~/client/design/menu.js";
import {Modal} from "~/client/design/modal.js";
import {isHtmlImageElementLoaded} from "~/client/helpers/elements/is_html_image_element_loaded.js";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useResizeObserver} from "~/client/helpers/use_resize_observer.js";
import {useStore} from "~/client/helpers/use_store.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    contentStyles,
    invertLightSelectionColorsClassName,
    sprinkles,
} from "~/client/styles/styles.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {contentBaseProsemirrorSchemaSpec} from "~/shared/content/content_schema.js";
import {createContentFileProsemirrorNodeSpecs} from "~/shared/content/content_schema_extra.js";
import {fileClassName} from "~/shared/content/content_styles.js";
import {convertRemLengthToPx, spacing} from "~/shared/design/spacing.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileModel} from "~/shared/files/file_model.js";
import {getFileContentTypeNoun} from "~/shared/files/get_file_content_type_noun.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {convertSvgToDataUrl} from "~/shared/helpers/html/convert_svg_to_data_url.js";
import {clamp} from "~/shared/helpers/number/clamp.js";

export function ContentFileDesktopViewerModal({
    file,
    signedUrlSearch,
    attachmentTarget,
    expirationTimers,
    onClose,
}: {
    file: FileModel;
    signedUrlSearch: string;
    attachmentTarget: FileAttachmentTarget;
    expirationTimers: ContentFilePreviewExpirationTimers;
    onClose: () => void;
}) {
    const {isAppleDevice} = useClientInfo();
    const {space} = useSpaceContext();

    const [viewerRef, viewerSize] = useResizeObserver({
        // Don't use the `getBoundingClientRect` method because the dimensions will be
        // affected by the modal's fade in animation which scales the modal element.
        method: "clientWidthAndHeight",
    });

    const initialZoomLevel = 0;
    const minZoomLevel = -3;
    const maxZoomLevel = 7;

    const [zoomLevel, setZoomLevel] = useState(initialZoomLevel);

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

    return (
        <Modal
            aria-label="File"
            maxWidth="full"
            height="full"
            // More margin than `<SearchModal>` so when the two are overlapping on a narrow
            // screen they don't have the same width. Also gives the user more space to
            // click in the margins given the modal is otherwise width/height 100%.
            margin="7"
            // Background is a dark grey in both light and dark mode:
            //
            // 1. To bring focus to the content
            // 2. So content that's transparent and uses white or black is visible whether
            //    we're in light mode or dark mode
            backgroundColor="grey-content-file-viewer-modal"
            // As a fullscreen modal that almost completely covers the content below, we
            // don't benefit from using lighter grey colors in dark mode. Use the standard
            // dark mode shades in our content file viewer modal.
            withoutElevatedGrey
            borderRadius="2"
            withoutCloseButton
            onClose={onClose}
        >
            <GlobalKeyDownEvent
                onGlobalKeyDown={event => {
                    if (event.key === "=" && (isAppleDevice ? event.metaKey : event.ctrlKey)) {
                        event.preventDefault();
                        event.stopPropagation();
                        zoomIn();
                    }

                    if (event.key === "-" && (isAppleDevice ? event.metaKey : event.ctrlKey)) {
                        event.preventDefault();
                        event.stopPropagation();
                        zoomOut();
                    }

                    if (event.key === "0" && (isAppleDevice ? event.metaKey : event.ctrlKey)) {
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
                    // By default use white for text. Make sure to invert our selection color in
                    // light mode since the default light mode selection color doesn't look good
                    // with white text.
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
                            userSelect="text"
                        >
                            {getFileContentTypeName(file.contentType)} -{" "}
                            {prettyBytes(file.contentLength)}
                        </Box>
                        <Box flexGrow="1" />
                        <Box display="flex" justifyContent="flex-end" alignItems="center" gap="2.5">
                            <IconButton
                                variant="quiet-above-content-file-viewer-modal"
                                description="Zoom in"
                                tooltipPlacement="bottom"
                                keyboardShortcutHint={isAppleDevice ? "⌘+=" : "Ctrl+="}
                                isDisabled={zoomLevel >= maxZoomLevel}
                                onPress={zoomIn}
                            >
                                <MagnifyingGlassPlus />
                            </IconButton>
                            <IconButton
                                variant="quiet-above-content-file-viewer-modal"
                                description="Zoom out"
                                tooltipPlacement="bottom"
                                keyboardShortcutHint={isAppleDevice ? "⌘+-" : "Ctrl+-"}
                                isDisabled={zoomLevel <= minZoomLevel}
                                onPress={zoomOut}
                            >
                                <MagnifyingGlassMinus />
                            </IconButton>
                            <Box paddingLeft="1">
                                <Button
                                    variant="neutral"
                                    icon={<DownloadSimple />}
                                    iconGap="1.5"
                                    onPress={() => {
                                        handleDownloadContentFile({
                                            spaceId: space.id,
                                            file,
                                            signedUrlSearch,
                                        });
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
                        {viewerSize && (
                            <ContentFileDesktopViewer
                                file={file}
                                signedUrlSearch={signedUrlSearch}
                                attachmentTarget={attachmentTarget}
                                viewerSize={viewerSize}
                                expirationTimers={expirationTimers}
                                zoomScale={zoomScale}
                                maxZoomScale={maxZoomScale}
                            />
                        )}
                    </Box>
                </Box>
            </GlobalKeyDownEvent>
        </Modal>
    );
}

const contentFileDesktopViewerMarginX = "12";
const contentFileDesktopViewerMarginTop = "10";
const contentFileDesktopViewerMarginBottom = contentFileDesktopViewerMarginX;

function ContentFileDesktopViewer(props: {
    file: FileModel;
    signedUrlSearch: string;
    attachmentTarget: FileAttachmentTarget;
    expirationTimers: ContentFilePreviewExpirationTimers;
    viewerSize: {width: number; height: number};
    zoomScale: number;
    maxZoomScale: number;
}) {
    switch (props.file.contentType) {
        case "application/octet-stream": {
            // TODO(calebmer, #files): Implement
            return null;
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
            return <ContentFileImageDesktopViewer {...props} />;
        }
        case "application/pdf":
        case "application/msword":
        case "application/vnd.ms-excel":
        case "application/vnd.ms-powerpoint":
        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        case "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
            // TODO(calebmer, #files): Implement
            return null;
        }
        case "video/webm":
        case "video/mp4":
        case "video/quicktime":
        case "video/mpeg":
        case "video/x-matroska": {
            // TODO(calebmer, #files): Implement
            return null;
        }
        case "audio/mpeg":
        case "audio/wav":
        case "audio/webm":
        case "audio/ogg":
        case "audio/mp4": {
            // TODO(calebmer, #files): Implement
            return null;
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
            // TODO(calebmer, #files): Implement
            return null;
        }
        default:
            throw exhaustive(props.file.contentType);
    }
}

function ContentFileImageDesktopViewer({
    file,
    signedUrlSearch,
    attachmentTarget,
    expirationTimers,
    viewerSize,
    zoomScale,
    maxZoomScale,
}: {
    file: FileModel;
    signedUrlSearch: string;
    attachmentTarget: FileAttachmentTarget;
    expirationTimers: ContentFilePreviewExpirationTimers;
    viewerSize: {width: number; height: number};
    zoomScale: number;
    maxZoomScale: number;
}) {
    assert(file.preview?.type === "Image");

    if (
        (!file.preview.isProcessing && !file.preview.ok) ||
        file.preview.placeholder === "Processing" ||
        file.preview.size === "Processing"
    ) {
        // TODO(calebmer, #files): Implement
        return null;
    }

    return (
        <ContentFileImageDesktopViewerInner
            file={file}
            filePreviewPlaceholder={file.preview.placeholder}
            signedUrlSearch={signedUrlSearch}
            attachmentTarget={attachmentTarget}
            expirationTimers={expirationTimers}
            viewerSize={viewerSize}
            zoomScale={zoomScale}
            maxZoomScale={maxZoomScale}
        />
    );
}

function ContentFileImageDesktopViewerInner({
    file,
    filePreviewPlaceholder,
    signedUrlSearch,
    attachmentTarget,
    expirationTimers,
    viewerSize,
    zoomScale,
    maxZoomScale,
}: {
    file: FileModel;
    filePreviewPlaceholder: FileImagePreviewPlaceholder;
    signedUrlSearch: string;
    attachmentTarget: FileAttachmentTarget;
    expirationTimers: ContentFilePreviewExpirationTimers;
    viewerSize: {width: number; height: number};
    zoomScale: number;
    maxZoomScale: number;
}) {
    const remPx = useRemPx();
    const {space} = useSpaceContext();

    const containerRef = useRef<HTMLDivElement>(null);
    const imageRef = useRef<HTMLDivElement>(null);
    const imageContentRef = useRef<HTMLImageElement>(null);

    const fileSize = getFilePreviewSize(file);
    const fileAspectRatio = fileSize.width / fileSize.height;

    const viewerAspectRatio = viewerSize.width / viewerSize.height;
    const viewerMarginXPx = convertRemLengthToPx(spacing[contentFileDesktopViewerMarginX], remPx);
    const viewerMarginTopPx = convertRemLengthToPx(
        spacing[contentFileDesktopViewerMarginTop],
        remPx,
    );
    const viewerMarginBottomPx = convertRemLengthToPx(
        spacing[contentFileDesktopViewerMarginBottom],
        remPx,
    );

    let fileScale: number;
    if (fileAspectRatio > viewerAspectRatio) {
        const resizedFileWidth = Math.min(fileSize.width, viewerSize.width - viewerMarginXPx * 2);
        fileScale = resizedFileWidth / fileSize.width;
    } else {
        const resizedFileHeight = Math.min(
            fileSize.height,
            viewerSize.height - (viewerMarginTopPx + viewerMarginBottomPx),
        );
        fileScale = resizedFileHeight / fileSize.height;
    }

    const scaledFileWidth = fileSize.width * fileScale * zoomScale;
    const scaledFileHeight = fileSize.height * fileScale * zoomScale;
    const maxScaledFileWidth = fileSize.width * fileScale * maxZoomScale;
    const maxScaledFileHeight = fileSize.height * fileScale * maxZoomScale;

    const adjustments = useMemo(
        () => getFileImagePreviewRenderingAdjustments(filePreviewPlaceholder),
        [filePreviewPlaceholder],
    );

    const isSignedUrlSearchExpired = useStore(
        expirationTimers.getExpiredTimerStore(signedUrlSearch),
    );

    const [isLoaded, setIsLoaded] = useState(false);
    const [isLoadedAndAnimated, setIsLoadedAndAnimated] = useState(false);

    if (!isLoaded && isLoadedAndAnimated) setIsLoadedAndAnimated(false);

    useEffect(() => {
        if (isLoaded && !isLoadedAndAnimated) {
            const timeout = createTimeout(() => {
                setIsLoadedAndAnimated(true);
                // Multiply duration by 2 for good measure.
            }, contentStyles.loadedFileImageAnimationDurationMs * 2);
            return () => {
                timeout.clear();
            };
        }
    }, [isLoaded, isLoadedAndAnimated]);

    useEffect(() => {
        if (isSignedUrlSearchExpired) return;
        if (file.alternative && file.alternative.isProcessing) return;
        if (!file.alternative && file.isUploading) return;

        let hasCleanedUp = false;
        const contentElement = assertExists(imageContentRef.current);

        isHtmlImageElementLoaded(contentElement).then(
            () => {
                if (hasCleanedUp) return;
                setIsLoaded(true);
            },
            error => {
                if (hasCleanedUp) return;
                scheduleUncaughtError(error);
            },
        );

        return () => {
            hasCleanedUp = true;
        };
    }, [file.alternative, file.isUploading, isSignedUrlSearchExpired]);

    const contextMenuActions: Array<Array<MenuAction>> = [
        [
            {
                label: `Copy ${getFileContentTypeNoun(file.contentType)}`,
                pressErrorTitle: `Couldn’t copy ${getFileContentTypeNoun(file.contentType)}`,
                onPress: async () => {
                    const element = assertExists(imageRef.current);

                    // Create a temporary schema we can use for constructing a `file` node we
                    // can copy.
                    const schema = new ProsemirrorSchema({
                        nodes: {
                            ...contentBaseProsemirrorSchemaSpec.nodes,
                            ...createContentFileProsemirrorNodeSpecs({}),
                        },
                        marks: contentBaseProsemirrorSchemaSpec.marks,
                    });

                    await handleCopyContentFile(element, {
                        spaceId: space.id,
                        node: schema.node("file", {fileId: file.id}),
                        references: {
                            ...emptyContentReferences,
                            fileById: new Map([[file.id, {file, signedUrlSearch}]]),
                        },
                        attachmentTarget,
                    });
                },
            },
            {
                label: `Download ${getFileContentTypeNoun(file.contentType)}`,
                onPress: () => {
                    handleDownloadContentFile({
                        spaceId: space.id,
                        file,
                        signedUrlSearch,
                    });
                },
            },
        ],
    ];

    const lastScrollLeftPercentRef = useRef(0);
    const lastScrollTopPercentRef = useRef(0);
    const lastZoomScaleRef = useRef(zoomScale);

    // Initialize our last scroll position refs.
    useLayoutEffectWithoutServerSideWarning(() => {
        const containerElement = assertExists(containerRef.current);

        lastScrollLeftPercentRef.current =
            (containerElement.scrollLeft + containerElement.clientWidth / 2) /
            containerElement.scrollWidth;

        lastScrollTopPercentRef.current =
            (containerElement.scrollTop + containerElement.clientHeight / 2) /
            containerElement.scrollHeight;
    }, []);

    // Whenever the zoom changes, we want to adjust our `scrollTop` and
    // `scrollLeft` so that the center of our image stays in the same place as it
    // was before the zoom.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (lastZoomScaleRef.current === zoomScale) return;
        lastZoomScaleRef.current = zoomScale;

        const containerElement = assertExists(containerRef.current);

        containerElement.scrollLeft =
            lastScrollLeftPercentRef.current * containerElement.scrollWidth -
            containerElement.clientWidth / 2;

        containerElement.scrollTop =
            lastScrollTopPercentRef.current * containerElement.scrollHeight -
            containerElement.clientHeight / 2;
    }, [zoomScale]);

    const imageContentStyle: CSSProperties = {
        // My theory here is we'll get better zoom performance if we render the image
        // at it's maximum size then scale down since the browser prepares the image at
        // its maximum size. There's no evidence to support this theory.
        width: maxScaledFileWidth,
        height: maxScaledFileHeight,
        maxWidth: "none",
        // Override positioning in `fileImagePreviewContentClassName`.
        top: "0",
        left: "0",
        // When the user zooms all the way in we want to show them the image's pixels
        // instead of some interpolation.
        imageRendering: scaledFileWidth > fileSize.width ? "pixelated" : "auto",
        // Use `transform: scale()` to GPU accelerate zooming. `will-change: transform`
        // improves zooming performance in Chrome.
        transformOrigin: "top left",
        transform: `scale(${zoomScale / maxZoomScale})`,
        willChange: "transform",
    };

    return (
        <Box
            ref={containerRef}
            width="full"
            height="full"
            overflow="auto"
            // We don't have support for horizontal scrollbars at the moment. So we choose
            // to disable scrollbars entirely for now in the file viewer.
            //
            // TODO(calebmer): Implement horizontal scrollbars and use them here.
            data-scrollbar="false"
            onScroll={event => {
                const containerElement = event.currentTarget;

                lastScrollLeftPercentRef.current =
                    (containerElement.scrollLeft + containerElement.clientWidth / 2) /
                    containerElement.scrollWidth;

                lastScrollTopPercentRef.current =
                    (containerElement.scrollTop + containerElement.clientHeight / 2) /
                    containerElement.scrollHeight;
            }}
        >
            <Box
                position="relative"
                paddingX={contentFileDesktopViewerMarginX}
                paddingTop={contentFileDesktopViewerMarginTop}
                paddingBottom={contentFileDesktopViewerMarginBottom}
                style={{
                    width: "min-content",
                    height: "min-content",
                    left: Math.max(
                        0,
                        viewerSize.width / 2 - (scaledFileWidth + viewerMarginXPx * 2) / 2,
                    ),
                    top: Math.max(
                        0,
                        viewerSize.height / 2 -
                            (scaledFileHeight + viewerMarginTopPx + viewerMarginBottomPx) / 2,
                    ),
                }}
            >
                <ContextMenuActions actions={contextMenuActions}>
                    <div
                        ref={imageRef}
                        className={classNames(
                            fileClassName,
                            isLoaded && contentStyles.loadedFileImagePreviewClassName,
                            contentStyles.fileViewerClassName,
                            sprinkles({
                                boxShadow: !adjustments.hasTransparentBackground
                                    ? "elevation-20-above-content-file-viewer-modal"
                                    : undefined,
                            }),
                        )}
                        style={{width: scaledFileWidth, height: scaledFileHeight}}
                    >
                        {useMemo(
                            () =>
                                !isLoadedAndAnimated && (
                                    <img
                                        className={
                                            contentStyles.fileImagePreviewPlaceholderClassName
                                        }
                                        style={{
                                            width: scaledFileWidth,
                                            height: scaledFileHeight,
                                        }}
                                        aria-hidden={true}
                                        draggable={false}
                                        src={convertSvgToDataUrl(
                                            renderFileImagePreviewPlaceholder(
                                                filePreviewPlaceholder,
                                            ),
                                        )}
                                    />
                                ),
                            [
                                filePreviewPlaceholder,
                                isLoadedAndAnimated,
                                scaledFileHeight,
                                scaledFileWidth,
                            ],
                        )}
                        {!isSignedUrlSearchExpired &&
                            (file.alternative
                                ? !file.alternative.isProcessing && (
                                      <img
                                          ref={imageContentRef}
                                          className={contentStyles.fileImagePreviewContentClassName}
                                          style={imageContentStyle}
                                          // TODO(calebmer): Support drag events with the same code we use for content
                                          // previews.
                                          draggable={false}
                                          src={`/files/${space.id}/${
                                              file.id
                                          }${signedUrlSearch}&variant=${
                                              file.alternative.isImagePreviewContent
                                                  ? "preview"
                                                  : "alternative"
                                          }`}
                                      />
                                  )
                                : !file.isUploading && (
                                      <img
                                          ref={imageContentRef}
                                          className={contentStyles.fileImagePreviewContentClassName}
                                          style={imageContentStyle}
                                          // TODO(calebmer): Support drag events with the same code we use for content
                                          // previews.
                                          draggable={false}
                                          src={`/files/${space.id}/${file.id}${signedUrlSearch}`}
                                      />
                                  ))}
                    </div>
                </ContextMenuActions>
            </Box>
        </Box>
    );
}
