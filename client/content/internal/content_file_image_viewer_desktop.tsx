/* eslint-disable jsx-a11y/alt-text */

import classNames from "classnames";
import {SpinnerGap} from "phosphor-react";
import {Schema as ProsemirrorSchema} from "prosemirror-model";
import {useEffect, useMemo, useRef, useState} from "react";
import {getFilePreviewSize} from "~/client/content/internal/content_file_layout_computations.js";
import {
    contentFileViewerDesktopMarginBottom,
    contentFileViewerDesktopMarginTop,
    contentFileViewerDesktopMarginX,
    contentFileViewerLargeProcessingIndicatorColor,
    contentFileViewerLargeProcessingIndicatorFontSize,
    contentFileViewerLargeProcessingIndicatorGap,
    contentFileViewerLargeProcessingIndicatorIconSize,
    contentFileViewerLargeProcessingIndicatorWeight,
} from "~/client/content/internal/content_file_viewer_shared_styles.js";
import {ContentFileViewerLoaderData} from "~/client/content/internal/load_content_file_viewer_data.js";
import {
    ContentFilePreviewExpirationTimers,
    getFileImagePreviewRenderingAdjustments,
    handleCopyContentFile,
    handleDownloadContentFile,
    renderFileImagePreviewPlaceholder,
} from "~/client/content/internal/render_content_file_preview.js";
import {Box} from "~/client/design/box.js";
import {ContextMenuActions} from "~/client/design/context_menu.js";
import {useRemPx} from "~/client/design/helpers/use_rem_px.js";
import {MenuAction} from "~/client/design/menu.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useErrorState} from "~/client/helpers/use_error_state.js";
import {usePromise} from "~/client/helpers/use_promise.js";
import {useStore} from "~/client/helpers/use_store.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {contentStyles, spinAnimationClassName, sprinkles} from "~/client/styles/styles.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {contentBaseProsemirrorSchemaSpec} from "~/shared/content/content_schema.js";
import {createContentFileProsemirrorNodeSpecs} from "~/shared/content/content_schema_extra.js";
import {fileClassName} from "~/shared/content/content_styles.js";
import {convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
import {getErrorConstructorForCode} from "~/shared/error/get_error_constructor_for_code.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileModel} from "~/shared/files/file_model.js";
import {getFileContentTypeNoun} from "~/shared/files/get_file_content_type_noun.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {convertSvgToDataUrl} from "~/shared/helpers/html/convert_svg_to_data_url.js";

export function ContentFileImageViewerDesktop({
    file,
    signedUrlSearch,
    attachmentTarget,
    expirationTimers,
    loaderDataPromise,
    viewerSize,
    zoomScale,
    maxZoomScale,
}: {
    file: FileModel;
    signedUrlSearch: string;
    attachmentTarget: FileAttachmentTarget;
    expirationTimers: ContentFilePreviewExpirationTimers;
    loaderDataPromise: PromiseImmediate<ContentFileViewerLoaderData | null>;
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
        if (!file.preview.isProcessing && !file.preview.ok) {
            const ErrorConstructor = getErrorConstructorForCode(file.preview.error.code);
            throw new ErrorConstructor("Couldn't process file", {
                displayMessage: file.preview.error.displayMessage,
            });
        }

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
                    <SpinnerGap
                        className={spinAnimationClassName}
                        size={spacing[contentFileViewerLargeProcessingIndicatorIconSize.desktop]}
                        weight={contentFileViewerLargeProcessingIndicatorWeight.desktop}
                    />
                    Processing
                </Box>
            </Box>
        );
    }

    return (
        <ContentFileImageDesktopViewerInner
            file={file}
            filePreviewPlaceholder={file.preview.placeholder}
            signedUrlSearch={signedUrlSearch}
            attachmentTarget={attachmentTarget}
            expirationTimers={expirationTimers}
            loaderDataPromise={loaderDataPromise}
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
    loaderDataPromise,
    viewerSize,
    zoomScale,
    maxZoomScale,
}: {
    file: FileModel;
    filePreviewPlaceholder: FileImagePreviewPlaceholder;
    signedUrlSearch: string;
    attachmentTarget: FileAttachmentTarget;
    expirationTimers: ContentFilePreviewExpirationTimers;
    loaderDataPromise: PromiseImmediate<ContentFileViewerLoaderData | null>;
    viewerSize: {width: number; height: number};
    zoomScale: number;
    maxZoomScale: number;
}) {
    const remPx = useRemPx();
    const {space} = useSpaceContext();

    const containerRef = useRef<HTMLDivElement>(null);
    const imageRef = useRef<HTMLDivElement>(null);

    const fileSize = getFilePreviewSize(file);
    const fileAspectRatio = fileSize.width / fileSize.height;

    const viewerAspectRatio = viewerSize.width / viewerSize.height;
    const viewerMarginXPx = convertRemLengthToPx(spacing[contentFileViewerDesktopMarginX], remPx);
    const viewerMarginTopPx = convertRemLengthToPx(
        spacing[contentFileViewerDesktopMarginTop],
        remPx,
    );
    const viewerMarginBottomPx = convertRemLengthToPx(
        spacing[contentFileViewerDesktopMarginBottom],
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

    const setErrorState = useErrorState();

    const fileContentTypeNoun = getFileContentTypeNoun(file.contentType);

    const contextMenuActions: Array<Array<MenuAction>> = [
        [
            {
                label: `Copy ${fileContentTypeNoun}`,
                isDisabled: file.isUploading,
                pressErrorTitle: `Couldn’t copy ${fileContentTypeNoun}`,
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
                label: `Download ${fileContentTypeNoun}`,
                isDisabled: file.isUploading,
                pressErrorTitle: `Couldn’t download ${fileContentTypeNoun}`,
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

    const loaderDataResult = usePromise(loaderDataPromise);

    const [isLoaded, setIsLoaded] = useState(!loaderDataResult.isPending);
    const [isLoadedAndAnimated, setIsLoadedAndAnimated] = useState(!loaderDataResult.isPending);

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

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isSignedUrlSearchExpired) return;

        if (loaderDataResult.isPending) return;
        assert(loaderDataResult.value?.type === "Image");

        const imageElement = assertExists(imageRef.current);

        const imageContentElement = loaderDataResult.value.image;
        if (!imageContentElement) return;

        imageContentElement.className = contentStyles.fileImagePreviewContentClassName;
        // TODO(calebmer): Support drag events with the same code we use for content
        // previews.
        imageContentElement.draggable = false;

        // My theory here is we'll get better zoom performance if we render the image
        // at it's maximum size then scale down since the browser prepares the image at
        // its maximum size. There's no evidence to support this theory.
        imageContentElement.style.width = `${maxScaledFileWidth}px`;
        imageContentElement.style.height = `${maxScaledFileHeight}px`;
        imageContentElement.style.maxWidth = "none";

        // Override positioning in `fileImagePreviewContentClassName`.
        imageContentElement.style.top = "0";
        imageContentElement.style.left = "0";

        // When the user zooms all the way in we want to show them the image's pixels
        // instead of some interpolation.
        imageContentElement.style.imageRendering = "auto";

        // Use `transform: scale()` to GPU accelerate zooming. `will-change: transform`
        // improves zooming performance in Chrome.
        imageContentElement.style.transformOrigin = "top left";
        imageContentElement.style.transform = "scale(1)";
        imageContentElement.style.willChange = "transform";

        imageElement.appendChild(imageContentElement);

        // Wait for the browser to paint before calling `setIsLoaded(true)`. That way
        // the CSS transition will perform the CSS cross fade animation correctly.
        // `isLoaded` will already be true if the image was loaded when our component
        // mounted.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                setIsLoaded(true);
            });
        });

        return () => {
            imageContentElement.remove();
        };
    }, [
        isSignedUrlSearchExpired,
        loaderDataResult,
        maxScaledFileHeight,
        maxScaledFileWidth,
        setErrorState,
    ]);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isSignedUrlSearchExpired) return;

        if (loaderDataResult.isPending) return;
        assert(loaderDataResult.value?.type === "Image");

        const imageContentElement = loaderDataResult.value.image;
        if (!imageContentElement) return;

        // When the user zooms all the way in we want to show them the image's pixels
        // instead of some interpolation.
        imageContentElement.style.imageRendering =
            scaledFileWidth > fileSize.width ? "pixelated" : "auto";

        // Use `transform: scale()` to GPU accelerate zooming. `will-change: transform`
        // improves zooming performance in Chrome.
        imageContentElement.style.transform = `scale(${zoomScale / maxZoomScale})`;
    }, [
        fileSize.width,
        isSignedUrlSearchExpired,
        loaderDataResult,
        maxZoomScale,
        scaledFileWidth,
        zoomScale,
    ]);

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
                paddingX={contentFileViewerDesktopMarginX}
                paddingTop={contentFileViewerDesktopMarginTop}
                paddingBottom={contentFileViewerDesktopMarginBottom}
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
                    </div>
                </ContextMenuActions>
            </Box>
        </Box>
    );
}
