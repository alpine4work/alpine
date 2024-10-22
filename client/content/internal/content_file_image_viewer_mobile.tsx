/* eslint-disable jsx-a11y/alt-text */

import classNames from "classnames";
import {DownloadSimple, SpinnerGap} from "phosphor-react";
import {CSSProperties, useEffect, useMemo, useRef, useState} from "react";
import {flushSync} from "react-dom";
import {getFilePreviewSize} from "~/client/content/internal/content_file_layout_computations.js";
import {
    contentFileViewerLargeProcessingIndicatorFontSize,
    contentFileViewerLargeProcessingIndicatorGap,
    contentFileViewerLargeProcessingIndicatorIconSize,
    contentFileViewerLargeProcessingIndicatorWeight,
} from "~/client/content/internal/content_file_viewer_shared_styles.js";
import {getContentFileImagePreviewViewerSrc} from "~/client/content/internal/load_content_file_viewer_data.js";
import {
    ContentFilePreviewExpirationTimers,
    getFileImagePreviewRenderingAdjustments,
    renderFileImagePreviewPlaceholder,
} from "~/client/content/internal/render_content_file_preview.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {perceivedAsInstantLimitMs} from "~/client/design/timing_constants.js";
import {isHtmlImageElementLoadedAndDecoded} from "~/client/helpers/elements/is_html_image_element_loaded_and_decoded.js";
import {useErrorState} from "~/client/helpers/use_error_state.js";
import {useStore} from "~/client/helpers/use_store.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {contentStyles, spinAnimationClassName, sprinkles} from "~/client/styles/styles.js";
import {fileClassName} from "~/shared/content/content_styles.js";
import {spacing} from "~/shared/design/spacing.js";
import {getErrorConstructorForCode} from "~/shared/error/get_error_constructor_for_code.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileModel} from "~/shared/files/file_model.js";
import {getFileContentTypeNoun} from "~/shared/files/get_file_content_type_noun.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {convertSvgToDataUrl} from "~/shared/helpers/html/convert_svg_to_data_url.js";
import {clamp} from "~/shared/helpers/number/clamp.js";

export function ContentFileImageViewerMobile({
    file,
    signedUrlSearch,
    attachmentTarget,
    expirationTimers,
    isModalAnimating,
    navigationBarSize,
    viewerSize,
    withZoom,
    onShare,
}: {
    file: FileModel;
    signedUrlSearch: string;
    attachmentTarget: FileAttachmentTarget;
    expirationTimers: ContentFilePreviewExpirationTimers;
    isModalAnimating: boolean;
    navigationBarSize: {width: number; height: number};
    viewerSize: {width: number; height: number};
    withZoom: boolean;
    onShare: () => Promise<void>;
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
                    color={{light: "grey-20-const", dark: "grey-30-const"}}
                    display="flex"
                    flexDirection="column"
                    alignItems="center"
                    gap={contentFileViewerLargeProcessingIndicatorGap}
                    fontSize={contentFileViewerLargeProcessingIndicatorFontSize}
                >
                    <SpinnerGap
                        className={spinAnimationClassName}
                        size={spacing[contentFileViewerLargeProcessingIndicatorIconSize.mobile]}
                        weight={contentFileViewerLargeProcessingIndicatorWeight.mobile}
                    />
                    Processing
                </Box>
            </Box>
        );
    }

    // TODO(calebmer): Support viewing large files. It's very frustrating but
    // WebKit grinds to a halt when trying to render a large file. Some ideas on
    // solutions:
    //
    // 1. Virtualize the image. Render the image in chunks, any chunks offscreen we
    //    don't render. When zoomed out we use a resized image WebKit can render.
    //
    // 2. Implement the image viewer natively. We can render a native view on top
    //    of our web view that can render large images effectively. This would also
    //    be nice since we can implement smoother zoom/pan gestures than trying to
    //    implement them in JavaScript.
    //
    // 2 is likely the best solution.
    if (file.preview.size.width * file.preview.size.height >= 35e6) {
        return (
            <Box
                width="full"
                height="full"
                display="flex"
                justifyContent="center"
                alignItems="center"
            >
                <Box display="flex" flexDirection="column" alignItems="center" gap="2">
                    <Box fontSize="100" color="grey-0-const">
                        Image is too large to view in app
                    </Box>
                    <Button
                        variant="neutral"
                        icon={<DownloadSimple />}
                        iconGap="1.5"
                        isDisabled={
                            file.alternative ? file.alternative.isProcessing : file.isUploading
                        }
                        pressErrorTitle={`Couldn’t download ${getFileContentTypeNoun(
                            file.contentType,
                        )}`}
                        onPress={onShare}
                    >
                        Download
                    </Button>
                </Box>
            </Box>
        );
    }

    return (
        <ContentFileImageMobileViewerInner
            file={file}
            filePreviewPlaceholder={file.preview.placeholder}
            signedUrlSearch={signedUrlSearch}
            attachmentTarget={attachmentTarget}
            expirationTimers={expirationTimers}
            isModalAnimating={isModalAnimating}
            navigationBarSize={navigationBarSize}
            viewerSize={viewerSize}
            withZoom={withZoom}
        />
    );
}

// Must import `hammerjs` lazily since it references `window` so it's not
// available on the server.
const hammerModulePromise = new Lazy(() => PromiseImmediate.resolve(import("hammerjs")));

class ContentFileImageMobileViewerTransformState {
    public static readonly minZoomScale = 1;
    public static readonly maxZoomScale = 128;

    public readonly measurements: {
        readonly viewerMarginTop: number;
        readonly viewerWidth: number;
        readonly viewerHeight: number;
        readonly width: number;
        readonly height: number;
    };
    public readonly zoomScale: number;
    public readonly panTranslateX: number;
    public readonly panTranslateY: number;

    constructor({
        measurements,
        zoomScale,
        panTranslateX,
        panTranslateY,
    }: {
        measurements: {
            readonly viewerMarginTop: number;
            readonly viewerWidth: number;
            readonly viewerHeight: number;
            readonly width: number;
            readonly height: number;
        };
        zoomScale: number;
        panTranslateX: number;
        panTranslateY: number;
    }) {
        const {minZoomScale, maxZoomScale} = ContentFileImageMobileViewerTransformState;

        this.measurements = measurements;

        this.zoomScale = clamp(minZoomScale, zoomScale, maxZoomScale);

        const minPanTranslateX = Math.min(
            0,
            -(this.measurements.width * this.zoomScale - this.measurements.viewerWidth) / 2,
        );
        const maxPanTranslateX = Math.max(
            0,
            (this.measurements.width * this.zoomScale - this.measurements.viewerWidth) / 2,
        );

        this.panTranslateX = clamp(minPanTranslateX, panTranslateX, maxPanTranslateX);

        const minPanTranslateY = Math.min(
            0,
            -(this.measurements.height * this.zoomScale - this.measurements.viewerHeight) / 2,
        );
        const maxPanTranslateY = Math.max(
            0,
            (this.measurements.height * this.zoomScale -
                (this.measurements.viewerHeight - this.measurements.viewerMarginTop * 2)) /
                2,
        );

        this.panTranslateY = clamp(minPanTranslateY, panTranslateY, maxPanTranslateY);
    }

    public clone({
        measurements,
        zoomScale,
        panTranslateX,
        panTranslateY,
    }: {
        measurements?: {
            readonly viewerMarginTop: number;
            readonly viewerWidth: number;
            readonly viewerHeight: number;
            readonly width: number;
            readonly height: number;
        };
        zoomScale?: number;
        panTranslateX?: number;
        panTranslateY?: number;
    }) {
        return new ContentFileImageMobileViewerTransformState({
            measurements: measurements ?? this.measurements,
            zoomScale: zoomScale ?? this.zoomScale,
            panTranslateX: panTranslateX ?? this.panTranslateX,
            panTranslateY: panTranslateY ?? this.panTranslateY,
        });
    }
}

function ContentFileImageMobileViewerInner({
    file,
    filePreviewPlaceholder,
    signedUrlSearch,
    expirationTimers,
    isModalAnimating,
    navigationBarSize,
    viewerSize,
    withZoom,
}: {
    file: FileModel;
    filePreviewPlaceholder: FileImagePreviewPlaceholder;
    signedUrlSearch: string;
    attachmentTarget: FileAttachmentTarget;
    expirationTimers: ContentFilePreviewExpirationTimers;
    isModalAnimating: boolean;
    navigationBarSize: {width: number; height: number};
    viewerSize: {width: number; height: number};
    withZoom: boolean;
}) {
    // If we're on the client, start loading `hammerjs`.
    if (withZoom && typeof window !== "undefined") void hammerModulePromise.get();

    const {space} = useSpaceContext();

    const containerRef = useRef<HTMLDivElement>(null);
    const imageRef = useRef<HTMLDivElement>(null);
    const imageContentRef = useRef<HTMLImageElement>(null);

    const fileSize = getFilePreviewSize(file);
    const fileAspectRatio = fileSize.width / fileSize.height;

    const viewerAspectRatio = viewerSize.width / viewerSize.height;

    let fileScale: number;
    if (fileAspectRatio > viewerAspectRatio) {
        const resizedFileWidth = Math.min(fileSize.width, viewerSize.width);
        fileScale = resizedFileWidth / fileSize.width;
    } else {
        const resizedFileHeight = Math.min(fileSize.height, viewerSize.height);
        fileScale = resizedFileHeight / fileSize.height;
    }

    const transformStateMeasurements = useMemo(
        () => ({
            viewerMarginTop: navigationBarSize.height,
            viewerWidth: viewerSize.width,
            viewerHeight: viewerSize.height,
            width: fileSize.width * fileScale,
            height: fileSize.height * fileScale,
        }),
        [
            fileScale,
            fileSize.height,
            fileSize.width,
            navigationBarSize.height,
            viewerSize.height,
            viewerSize.width,
        ],
    );

    const [transformStates, setTransformStates] = useState<{
        readonly old: ContentFileImageMobileViewerTransformState | null;
        readonly new: ContentFileImageMobileViewerTransformState;
    }>(() => ({
        old: null,
        new: new ContentFileImageMobileViewerTransformState({
            measurements: transformStateMeasurements,
            zoomScale: 1,
            panTranslateX: 0,
            panTranslateY: 0,
        }),
    }));

    if (
        transformStates.new.measurements !== transformStateMeasurements ||
        (transformStates.old && transformStates.old.measurements !== transformStateMeasurements)
    ) {
        setTransformStates({
            old: transformStates.old?.clone({measurements: transformStateMeasurements}) ?? null,
            new: transformStates.new.clone({measurements: transformStateMeasurements}),
        });
    } else if (
        !withZoom &&
        (transformStates.old ||
            transformStates.new.zoomScale !== 1 ||
            transformStates.new.panTranslateX !== 0 ||
            transformStates.new.panTranslateY !== 0)
    ) {
        setTransformStates({
            old: null,
            new: new ContentFileImageMobileViewerTransformState({
                measurements: transformStateMeasurements,
                zoomScale: 1,
                panTranslateX: 0,
                panTranslateY: 0,
            }),
        });
    }

    const scaledFileWidth = fileSize.width * fileScale * transformStates.new.zoomScale;

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
        if (isLoaded && !isModalAnimating && !isLoadedAndAnimated) {
            const timeout = createTimeout(() => {
                setIsLoadedAndAnimated(true);
                // Multiply duration by 2 for good measure.
            }, contentStyles.loadedFileImageAnimationDurationMs * 2);
            return () => {
                timeout.clear();
            };
        }
    }, [isLoaded, isLoadedAndAnimated, isModalAnimating]);

    const setErrorState = useErrorState();

    useEffect(() => {
        if (isSignedUrlSearchExpired) return;
        if (file.alternative && file.alternative.isProcessing) return;
        if (!file.alternative && file.isUploading) return;

        let hasCleanedUp = false;
        const contentElement = assertExists(imageContentRef.current);

        isHtmlImageElementLoadedAndDecoded(contentElement).then(
            () => {
                if (hasCleanedUp) return;
                setIsLoaded(true);
            },
            error => {
                if (hasCleanedUp) return;
                setErrorState(error);
            },
        );

        return () => {
            hasCleanedUp = true;
        };
    }, [file.alternative, file.isUploading, isSignedUrlSearchExpired, setErrorState]);

    // Use `hammerjs` to manage pinch to zoom. `hammerjs` is a little dated: You
    // have to access it through a global and you can't import `hammerjs` on the
    // server. But it's very popular and gets the job done so we use it.
    useEffect(() => {
        if (!withZoom) return;

        const containerElement = assertExists(containerRef.current);

        let hasCleanedUp = false;
        let cleanup: (() => void) | null = null;

        hammerModulePromise
            .get()
            .then(() => {
                if (hasCleanedUp) return;

                // `hammerjs` installs its export as a global. Lovely.
                const hammer = new Hammer(containerElement);

                hammer.get("tap").set({enable: false});
                hammer.get("press").set({enable: false});
                hammer.get("pinch").set({enable: true});

                let hasPinchRecentlyFinished = false;

                hammer.on("doubletap pan pinch panend pinchend", event => {
                    // Since we're in a touch interaction, synchronously flush any React updates to
                    // prevent input lag.
                    flushSync(() => {
                        switch (event.type) {
                            case "doubletap": {
                                setTransformStates(transformStates => ({
                                    old: null,
                                    new: transformStates.new.clone({
                                        zoomScale: transformStates.new.zoomScale === 1 ? 2 : 1,
                                        panTranslateX: 0,
                                        panTranslateY: 0,
                                    }),
                                }));
                                break;
                            }
                            case "pan": {
                                // NOTE(calebmer): I've found sometimes `hammerjs` emits a pan event right
                                // after a pinch with a nonsensical translation. Ignore pans right after
                                // pinches.
                                if (hasPinchRecentlyFinished) return;

                                const eventDeltaX = event.deltaX;
                                const eventDeltaY = event.deltaY;

                                setTransformStates(transformStates => {
                                    const oldTransformState =
                                        transformStates.old ?? transformStates.new;

                                    // Speed up panning as the user zooms in.
                                    const panScale = 1 + Math.log(oldTransformState.zoomScale) / 2;

                                    return {
                                        old: oldTransformState,
                                        new: oldTransformState.clone({
                                            panTranslateX:
                                                oldTransformState.panTranslateX +
                                                eventDeltaX * panScale,
                                            panTranslateY:
                                                oldTransformState.panTranslateY +
                                                eventDeltaY * panScale,
                                        }),
                                    };
                                });
                                break;
                            }
                            case "panend": {
                                // NOTE(calebmer): I've found sometimes `hammerjs` emits a pan event right
                                // after a pinch with a nonsensical translation. Ignore pans right after
                                // pinches.
                                if (hasPinchRecentlyFinished) return;

                                setTransformStates(transformStates => ({
                                    old: null,
                                    new: transformStates.new,
                                }));
                                break;
                            }
                            case "pinch": {
                                const eventScale = event.scale;

                                setTransformStates(transformStates => {
                                    const {minZoomScale, maxZoomScale} =
                                        ContentFileImageMobileViewerTransformState;

                                    const oldTransformState =
                                        transformStates.old ?? transformStates.new;

                                    const zoomScale = clamp(
                                        minZoomScale,
                                        oldTransformState.zoomScale * eventScale,
                                        maxZoomScale,
                                    );

                                    return {
                                        old: oldTransformState,
                                        new: oldTransformState.clone({
                                            zoomScale,
                                            panTranslateX:
                                                oldTransformState.panTranslateX *
                                                (zoomScale / oldTransformState.zoomScale),
                                            panTranslateY:
                                                oldTransformState.panTranslateY *
                                                (zoomScale / oldTransformState.zoomScale),
                                        }),
                                    };
                                });
                                break;
                            }
                            case "pinchend": {
                                setTransformStates(transformStates => ({
                                    old: null,
                                    new: transformStates.new,
                                }));

                                hasPinchRecentlyFinished = true;
                                setTimeout(() => {
                                    hasPinchRecentlyFinished = false;
                                }, perceivedAsInstantLimitMs);
                                break;
                            }
                        }
                    });
                });

                cleanup = () => {
                    hammer.destroy();
                };
            })
            .catch(scheduleUncaughtError);

        return () => {
            hasCleanedUp = true;
            cleanup?.();
        };
    }, [withZoom]);

    const imageContentStyle: CSSProperties = {
        // Re-enable `-webkit-touch-callout` for this preview image. So the user can
        // save and share on a long press.
        WebkitTouchCallout: "default",
        // Render at full file size then scale down so we don't zoom in on rendering
        // artifacts created by mobile Safari.
        width: fileSize.width,
        height: fileSize.height,
        maxWidth: "none",
        // Override positioning in `fileImagePreviewContentClassName`.
        top: "0",
        left: "0",
        transform: "initial",
        // When the user zooms all the way in we want to show them the image's pixels
        // instead of some interpolation.
        imageRendering: scaledFileWidth > fileSize.width ? "pixelated" : "auto",
    };

    const fileTranslateX = viewerSize.width / 2 - fileSize.width / 2;
    const fileTranslateY = viewerSize.height / 2 - fileSize.height / 2;

    const transform = `translate3d(${fileTranslateX + transformStates.new.panTranslateX}px, ${
        fileTranslateY + transformStates.new.panTranslateY
    }px, 0) scale3d(${fileScale * transformStates.new.zoomScale}, ${
        fileScale * transformStates.new.zoomScale
    }, 1)`;

    const src = getContentFileImagePreviewViewerSrc({
        spaceId: space.id,
        signedUrlSearch,
        file,
    });

    return (
        <Box ref={containerRef} position="relative" width="full" height="full">
            <div
                ref={imageRef}
                className={classNames(
                    fileClassName,
                    // Don't animate out placeholder until modal has finished animating. We've
                    // observed the animation stutter in Chrome if it needs to animate in the image
                    // while also animating the modal.
                    isLoaded && !isModalAnimating && contentStyles.loadedFileImagePreviewClassName,
                    contentStyles.fileViewerClassName,
                    sprinkles({
                        boxShadow: !adjustments.hasTransparentBackground
                            ? "elevation-20-above-content-file-viewer-modal"
                            : undefined,
                    }),
                )}
                style={{
                    width: fileSize.width,
                    height: fileSize.height,
                    transform,
                    willChange: "transform",
                    // I've seen this style recommended a couple places on the internet when
                    // dealing with CSS transforms and images. Not quite sure why we want it but
                    // here it is anyway.
                    //
                    // e.g. https://stackoverflow.com/questions/22269759/how-to-prevent-a-background-image-flickering-on-change
                    backfaceVisibility: "hidden",
                    WebkitBackfaceVisibility: "hidden",
                }}
            >
                {useMemo(
                    () =>
                        !isLoadedAndAnimated && (
                            <img
                                className={contentStyles.fileImagePreviewPlaceholderClassName}
                                style={{
                                    width: fileSize.width,
                                    height: fileSize.height,
                                }}
                                aria-hidden={true}
                                draggable={false}
                                src={convertSvgToDataUrl(
                                    renderFileImagePreviewPlaceholder(filePreviewPlaceholder),
                                )}
                            />
                        ),
                    [filePreviewPlaceholder, fileSize.height, fileSize.width, isLoadedAndAnimated],
                )}
                {!isSignedUrlSearchExpired && src && (
                    <img
                        ref={imageContentRef}
                        className={contentStyles.fileImagePreviewContentClassName}
                        style={imageContentStyle}
                        decoding="async"
                        draggable={false}
                        src={src}
                    />
                )}
            </div>
        </Box>
    );
}
