import classNames from "classnames";
import {FileModelRegistryData} from "~/client/content/file_registry.js";
import {
    addContentFileVideoAndAudioPlayerControlsBehavior,
    formatContentFileVideoAndAudioPlayerDurationString,
    renderContentFileVideoAndAudioPlayerControls,
} from "~/client/content/internal/content_file_video_and_audio_player_controls.js";
import {transparentImageDataUrl} from "~/client/content/internal/helpers/transparent_image_data_url.js";
import {getContentFileViewerSrc} from "~/client/content/internal/load_content_file_viewer_data.js";
import {addUnfocusableButtonBehaviorToElement} from "~/client/content/state/add_unfocusable_button_behavior_to_element.js";
import {Reporter} from "~/client/design/reporter.js";
import {cornersInIconSvg} from "~/client/icons/corners_in_icon_svg.js";
import {cornersOutIconSvg} from "~/client/icons/corners_out_icon_svg.js";
import {createSvgHtmlGenerator} from "~/client/icons/create_svg_html_generator.js";
import {playIconSvg} from "~/client/icons/play_icon_svg.js";
import {spinnerGapIconSvg} from "~/client/icons/spinner_gap_icon_svg.js";
import {
    contentFileVideoPlayerStyles,
    spinAnimationClassName,
    sprinkles,
} from "~/client/styles/styles.js";
import {Platform} from "~/shared/design/core/platform.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {getFileContentTypeNoun} from "~/shared/files/get_file_content_type_noun.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {
    HtmlContainerGenerator,
    HtmlElementGenerator,
    HtmlTextGenerator,
} from "~/shared/helpers/html/html_generator.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Render the elements needed for a content video player. You must also use
 * `addContentFileVideoPlayerBehavior()` to add event listeners for the content
 * video player. See that function's documentation for more information.
 *
 * The provided container HTML must have the class
 * `contentFileVideoPlayerStyles.containerClassName` and
 * `greyElevated2ClassName`. We will append to the container element.
 */
export function renderContentFileVideoPlayer(
    containerHtml: HtmlContainerGenerator,
    {
        spaceId,
        file,
        durationMs,
        layout,
        platform,
        isInitialAppRender,
        withoutInteractivity,
    }: {
        spaceId: SpaceId;
        file: FileModelRegistryData;
        durationMs: number;
        layout: {width: number; height: number} | null;
        platform: Platform;
        isInitialAppRender: boolean;
        withoutInteractivity: boolean;
    },
) {
    const videoSrc = getContentFileViewerSrc({spaceId, file});

    if (videoSrc === null) {
        const processingHtml = new HtmlElementGenerator("div");
        containerHtml.appendChild(processingHtml);
        processingHtml.setAttribute(
            "class",
            classNames(
                contentFileVideoPlayerStyles.processingClassName,
                sprinkles({fontSize: layout !== null && layout.width < 150 ? "25" : "50"}),
            ),
        );

        processingHtml.appendChild(
            createSvgHtmlGenerator(
                spinnerGapIconSvg({
                    className: `${spinAnimationClassName} ${sprinkles({
                        width: "6",
                        height: "6",
                    })}`,
                }),
            ),
        );

        const processingNoteHtml = new HtmlElementGenerator("div");
        processingHtml.appendChild(processingNoteHtml);

        processingNoteHtml.appendChild(
            new HtmlTextGenerator(`Processing ${getFileContentTypeNoun(file.contentType)}`),
        );

        const processingNodeSpacerHtml = new HtmlElementGenerator("div");
        processingNoteHtml.appendChild(processingNodeSpacerHtml);
        processingNodeSpacerHtml.setAttribute("class", sprinkles({width: "0.5", height: "0.5"}));

        processingNoteHtml.appendChild(new HtmlTextGenerator("This may take a few minutes…"));
        return;
    }

    const durationString = formatContentFileVideoAndAudioPlayerDurationString(
        durationMs,
        durationMs,
    );

    {
        const playIndicatorHtml = new HtmlElementGenerator("div");
        containerHtml.appendChild(playIndicatorHtml);
        playIndicatorHtml.setAttribute(
            "class",
            classNames(
                contentFileVideoPlayerStyles.playIndicatorClassName,
                layout !== null &&
                    layout.width < 150 &&
                    contentFileVideoPlayerStyles.smallPlayIndicatorClassName,
            ),
        );
        playIndicatorHtml.appendChild(createSvgHtmlGenerator(playIconSvg({weight: "fill"})));
        playIndicatorHtml.appendChild(
            createSvgHtmlGenerator(spinnerGapIconSvg({className: spinAnimationClassName})),
        );
    }

    // If we don't have enough space then don't render the duration preview.
    if (layout === null || !(layout.width < 175 && layout.height < 175)) {
        const durationPreviewHtml = new HtmlElementGenerator("div");
        containerHtml.appendChild(durationPreviewHtml);

        durationPreviewHtml.setAttribute(
            "class",
            contentFileVideoPlayerStyles.durationPreviewClassName,
        );

        durationPreviewHtml.appendChild(new HtmlTextGenerator(durationString));
    }

    // Only render the `<video>` element inline if the area is large enough.
    // Otherwise a press should open our file viewer where you'll be able to watch
    // the video.
    if (
        withoutInteractivity ||
        platform === "mobile" ||
        (layout !== null && (layout.width < 250 || layout.height < 150))
    ) {
        return;
    }

    {
        const videoHtml = new HtmlElementGenerator("video");
        containerHtml.appendChild(videoHtml);
        videoHtml.setAttribute("class", contentFileVideoPlayerStyles.videoClassName);
        videoHtml.setAttribute("playsinline", "");

        // We already have a poster for the video, the preview image. Don't load the
        // video just to display the first frame.
        videoHtml.setAttribute("poster", transparentImageDataUrl);

        // We already have the video's metadata (length) in
        // `filePreview.videoDuration`. We don't need to load from the server until the
        // user hits play.
        videoHtml.setAttribute("preload", "none");

        videoHtml.setAttribute("src", videoSrc);
    }

    {
        const controlsContainerHtml = new HtmlElementGenerator("div");
        containerHtml.appendChild(controlsContainerHtml);
        controlsContainerHtml.setAttribute(
            "class",
            contentFileVideoPlayerStyles.controlsContainerClassName,
        );

        const controlsHtml = renderContentFileVideoAndAudioPlayerControls({
            durationMs,
            isInitialAppRender,
            platform,
        });
        controlsContainerHtml.appendChild(controlsHtml);

        {
            const fullscreenButtonHtml = new HtmlElementGenerator("div");
            controlsHtml.appendChild(fullscreenButtonHtml);
            fullscreenButtonHtml.setAttribute(
                "class",
                contentFileVideoPlayerStyles.fullscreenButtonClassName,
            );

            fullscreenButtonHtml.appendChild(createSvgHtmlGenerator(cornersOutIconSvg()));
            fullscreenButtonHtml.appendChild(createSvgHtmlGenerator(cornersInIconSvg()));
        }
    }
}

let stillPointerTimeoutByContentFileVideoPlayerContainerElement:
    | WeakMap<Element, Timeout>
    | undefined;

/**
 * Add interactions to the content file video player rendered by
 * `renderContentFileVideoPlayer()`. The provided container element must have
 * the class `contentFileVideoPlayerStyles.containerClassName`.
 *
 * IMPORTANT: Read the following implementation notes before making changes.
 *
 * ## Implementation notes
 *
 * The code for our video player is styled after React. We have a functional
 * render function (`renderContentFileVideoPlayer()`) and setup interactivity
 * with an effect (`addContentFileVideoPlayerBehavior()`). We'd love to use
 * React directly but we can't because our video player is rendered in a
 * ProseMirror `contenteditable`. So we need to build the video player's
 * interactivity by directly attaching DOM events.
 *
 * Our behavior function MUST NOT edit the DOM by adding or removing DOM nodes.
 * This will mess up `HtmlElementGenerator.patchNode()` if ProseMirror needs to
 * re-render our video player. Instead you may only add/remove classes and
 * attributes that `renderContentFileVideoPlayer()` doesn't know about. Since
 * `HtmlElementGenerator.patchNode()` leaves these alone.
 */
export function addContentFileVideoPlayerBehavior(
    containerElement: Element,
    {
        durationMs,
        isInitialAppRender,
        getReporter,
        onOpenViewer,
    }: {
        durationMs: number;
        isInitialAppRender: boolean;
        getReporter: () => Reporter;
        onOpenViewer?: () => void;
    },
): {
    onPress: () => {preventDefault: boolean} | void;
    cleanup: () => void;
} {
    /* ========================================================================== *\
     *                                 Initialize                                 *
    \* ========================================================================== */

    assert(containerElement.classList.contains(contentFileVideoPlayerStyles.containerClassName));

    const videoElement = containerElement.getElementsByTagName("video")[0] ?? null;

    const controlsContainerElement = (containerElement.getElementsByClassName(
        contentFileVideoPlayerStyles.controlsContainerClassName,
    )[0] ?? null) as HTMLDivElement | null;

    const fullscreenButtonElement = (containerElement.getElementsByClassName(
        contentFileVideoPlayerStyles.fullscreenButtonClassName,
    )[0] ?? null) as HTMLDivElement | null;

    const cleanupFunctions: Array<() => void> = [];

    /* ========================================================================== *\
     *                              Control buttons                               *
    \* ========================================================================== */

    if (controlsContainerElement !== null) {
        const handleControlsContainerPointerDown = (event: PointerEvent) => {
            // When clicking on the control bar:
            //
            // - Don't perform the default press logic (don't show press highlight for
            //   instance)
            // - Don't allow browser drag to start from the control bar
            //
            // This pointer event is on the control container element instead of the
            // control element so we disable clicking in the margins below and to the
            // left/right area as well. Having your cursor change between pointer and
            // default when moving through that space feels janky so we disable pointer
            // events there.
            event.preventDefault();
        };

        const handleControlsContainerClick = (event: MouseEvent) => {
            // When clicking on the control bar prevent default so we don't perform the
            // default click logic (don't pause/play).
            event.preventDefault();
        };

        controlsContainerElement.addEventListener(
            "pointerdown",
            handleControlsContainerPointerDown,
        );
        controlsContainerElement.addEventListener("click", handleControlsContainerClick);

        cleanupFunctions.push(() => {
            controlsContainerElement.removeEventListener(
                "pointerdown",
                handleControlsContainerPointerDown,
            );
            controlsContainerElement.removeEventListener("click", handleControlsContainerClick);
        });

        cleanupFunctions.push(
            addUnfocusableButtonBehaviorToElement(assertExists(fullscreenButtonElement), {
                defaultClassName: sprinkles({
                    color: "grey-70",
                }),
                hoverClassName: sprinkles({
                    color: "grey-70",
                    backgroundColor: "grey-5",
                }),
                pressClassName: sprinkles({
                    color: "grey-100",
                    backgroundColor: "grey-10",
                }),
                onPress: () => {
                    if (!document.fullscreenElement) {
                        containerElement.requestFullscreen({navigationUI: "hide"}).catch(error => {
                            getReporter().displayError(
                                "Couldn’t fullscreen video",
                                new PermissionDeniedError(
                                    error instanceof Error ? error.message : String(error),
                                    {
                                        displayMessage: errorDisplayMessage`Your browser blocked this video from being fullscreened. Try checking your browser’s permissions for this website.`,
                                    },
                                ),
                            );
                        });
                    } else {
                        document.exitFullscreen().catch(error => {
                            getReporter().logErrorWithoutDisplaying(
                                "Couldn’t exit video fullscreen",
                                error,
                            );
                        });
                    }
                },
            }),
        );
    }

    /* ========================================================================== *\
     *                            Controls visibility                             *
    \* ========================================================================== */

    const stillPointerTimeoutMs = 5000;

    /**
     * Update our still pointer timeout state. If we should have a still pointer
     * timeout and one hasn't already started then we'll start the timeout. If we
     * shouldn't have a still pointer timeout then we'll clear the existing
     * timeout.
     */
    const updateStillPointerTimeout = () => {
        // If the video is paused, the pointer isn't hovering our video, or the pointer
        // is hovering our controls then we won't ever consider the pointer to be
        // still.
        if (!videoElement || videoElement.paused || !isPointerOver || isPointerOverControls) {
            const stillPointerTimeout =
                stillPointerTimeoutByContentFileVideoPlayerContainerElement?.get(containerElement);
            if (stillPointerTimeout) {
                stillPointerTimeout.clear();
                stillPointerTimeoutByContentFileVideoPlayerContainerElement?.delete(
                    containerElement,
                );
            }

            if (
                containerElement.classList.contains(
                    contentFileVideoPlayerStyles.stillPointerClassName,
                )
            ) {
                containerElement.classList.remove(
                    contentFileVideoPlayerStyles.stillPointerClassName,
                );
            }
            return;
        }

        // Still pointer class has already been added, don't start a new timeout.
        if (
            containerElement.classList.contains(contentFileVideoPlayerStyles.stillPointerClassName)
        ) {
            return;
        }

        stillPointerTimeoutByContentFileVideoPlayerContainerElement ??= new WeakMap();

        // We add our still timeout to a weak map so it persists across this behavior
        // function mounting/unmounting.
        getOrSetDefaultMapValue(
            stillPointerTimeoutByContentFileVideoPlayerContainerElement,
            containerElement,
            () => {
                return createTimeout(() => {
                    containerElement.classList.add(
                        contentFileVideoPlayerStyles.stillPointerClassName,
                    );
                }, stillPointerTimeoutMs);
            },
        );
    };

    /**
     * If there's a running still pointer timeout then clear the timeout and start
     * a new one. We call this whenever the pointer moves for instance. If we've
     * added the still pointer class then this will also remove the still pointer
     * class.
     */
    const resetStillPointerTimeout = () => {
        if (
            containerElement.classList.contains(contentFileVideoPlayerStyles.stillPointerClassName)
        ) {
            containerElement.classList.remove(contentFileVideoPlayerStyles.stillPointerClassName);
            updateStillPointerTimeout();
            return;
        }

        const stillPointerTimeout =
            stillPointerTimeoutByContentFileVideoPlayerContainerElement?.get(containerElement);

        if (!stillPointerTimeout) return;

        stillPointerTimeout.clear();

        stillPointerTimeoutByContentFileVideoPlayerContainerElement?.set(
            containerElement,
            createTimeout(() => {
                containerElement.classList.add(contentFileVideoPlayerStyles.stillPointerClassName);
            }, stillPointerTimeoutMs),
        );
    };

    // If this behavior function unmounts/remounts in response to some change,
    // check our hover state by looking at the DOM.
    let isPointerOver = containerElement.classList.contains(
        contentFileVideoPlayerStyles.hoveredClassName,
    );
    let isPointerOverControls =
        controlsContainerElement !== null &&
        controlsContainerElement.classList.contains(
            contentFileVideoPlayerStyles.hoveredControlsClassName,
        );

    if (controlsContainerElement !== null) {
        const handleContainerPointerMove = () => {
            resetStillPointerTimeout();
        };

        const handleContainerPointerEnter = () => {
            const wasPointerOver = isPointerOver;
            isPointerOver = true;

            if (!wasPointerOver) {
                containerElement.classList.add(contentFileVideoPlayerStyles.hoveredClassName);
            }

            updateStillPointerTimeout();
        };

        const handleContainerPointerLeave = () => {
            const wasPointerOver = isPointerOver;
            isPointerOver = false;

            if (wasPointerOver) {
                containerElement.classList.remove(contentFileVideoPlayerStyles.hoveredClassName);
            }

            updateStillPointerTimeout();
        };

        const handleControlsContainerPointerEnter = () => {
            const wasPointerOverControls = isPointerOverControls;
            isPointerOverControls = true;

            if (!wasPointerOverControls) {
                controlsContainerElement.classList.add(
                    contentFileVideoPlayerStyles.hoveredControlsClassName,
                );
            }

            updateStillPointerTimeout();
        };

        const handleControlsContainerPointerLeave = () => {
            const wasPointerOverControls = isPointerOverControls;
            isPointerOverControls = false;

            if (wasPointerOverControls) {
                controlsContainerElement.classList.remove(
                    contentFileVideoPlayerStyles.hoveredControlsClassName,
                );
            }

            updateStillPointerTimeout();
        };

        containerElement.addEventListener("pointermove", handleContainerPointerMove);
        containerElement.addEventListener("pointerenter", handleContainerPointerEnter);
        containerElement.addEventListener("pointerleave", handleContainerPointerLeave);
        controlsContainerElement.addEventListener(
            "pointerenter",
            handleControlsContainerPointerEnter,
        );
        controlsContainerElement.addEventListener(
            "pointerleave",
            handleControlsContainerPointerLeave,
        );

        cleanupFunctions.push(() => {
            containerElement.removeEventListener("pointermove", handleContainerPointerMove);
            containerElement.removeEventListener("pointerenter", handleContainerPointerEnter);
            containerElement.removeEventListener("pointerleave", handleContainerPointerLeave);
            controlsContainerElement.removeEventListener(
                "pointerenter",
                handleControlsContainerPointerEnter,
            );
            controlsContainerElement.removeEventListener(
                "pointerleave",
                handleControlsContainerPointerLeave,
            );
        });
    }

    // Must be initialized after `isPointerOver`.
    updateStillPointerTimeout();

    /* ========================================================================== *\
     *                                 Fullscreen                                 *
    \* ========================================================================== */

    {
        const handleFullscreenChange = () => {
            if (document.fullscreenElement === containerElement) {
                containerElement.classList.add(contentFileVideoPlayerStyles.fullscreenClassName);
            } else {
                containerElement.classList.remove(contentFileVideoPlayerStyles.fullscreenClassName);
            }

            resetStillPointerTimeout();
        };

        handleFullscreenChange();

        document.addEventListener("fullscreenchange", handleFullscreenChange);

        cleanupFunctions.push(() => {
            document.removeEventListener("fullscreenchange", handleFullscreenChange);
        });
    }

    /* ========================================================================== *\
     *                              Shared behavior                               *
    \* ========================================================================== */

    let togglePlay: () => void;
    let cleanupControls: () => void;

    if (videoElement === null || controlsContainerElement === null) {
        togglePlay = noop;
        cleanupControls = noop;
    } else {
        ({togglePlay, cleanup: cleanupControls} = addContentFileVideoAndAudioPlayerControlsBehavior(
            {
                durationMs,
                containerElement,
                mediaElement: videoElement,
                isInitialAppRender,
                getReporter,
                onPlay: updateStillPointerTimeout,
                onPause: updateStillPointerTimeout,
                onHasPlayed: updateStillPointerTimeout,
                onOpenViewer,
            },
        ));
    }

    return {
        onPress: () => {
            if (!videoElement) return;

            togglePlay();
            return {preventDefault: true};
        },
        cleanup: () => {
            cleanupControls();

            for (const cleanup of cleanupFunctions) {
                cleanup();
            }
        },
    };
}
