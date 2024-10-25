import classNames from "classnames";
import {addUnfocusableButtonBehaviorToElement} from "~/client/content/internal/helpers/add_unfocusable_button_behavior_to_element.js";
import {transparentImageDataUrl} from "~/client/content/internal/helpers/transparent_image_data_url.js";
import {getContentFileViewerSrc} from "~/client/content/internal/load_content_file_viewer_data.js";
import {Reporter} from "~/client/design/reporter.js";
import {
    addResizeListenerForElement,
    removeResizeListenerForElement,
} from "~/client/helpers/use_resize_observer.js";
import {cornersInIconSvg} from "~/client/icons/corners_in_icon_svg.js";
import {cornersOutIconSvg} from "~/client/icons/corners_out_icon_svg.js";
import {createSvgHtmlGenerator} from "~/client/icons/create_svg_html_generator.js";
import {pauseIconSvg} from "~/client/icons/pause_icon_svg.js";
import {playIconSvg} from "~/client/icons/play_icon_svg.js";
import {spinnerGapIconSvg} from "~/client/icons/spinner_gap_svg.js";
import {
    contentFileVideoPlayerStyles,
    greyElevated2ClassName,
    spinAnimationClassName,
    sprinkles,
} from "~/client/styles/styles.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {FileModel} from "~/shared/files/file_model.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {HtmlElementGenerator, HtmlTextGenerator} from "~/shared/helpers/html/html_generator.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Render the elements needed for a content video player. You must also use
 * `addContentFileVideoPlayerBehavior()` to add event listeners for the content
 * video player. See that function's documentation for more information.
 *
 * The provided container HTML must have the class
 * `contentFileVideoPlayerStyles.containerClassName`. We will append to the
 * container element.
 */
export function renderContentFileVideoPlayer(
    containerHtml: HtmlElementGenerator,
    {
        spaceId,
        signedUrlSearch,
        file,
        durationMs,
        layout,
    }: {
        spaceId: SpaceId;
        signedUrlSearch: string;
        file: FileModel;
        durationMs: number;
        layout: {width: number; height: number};
    },
) {
    containerHtml.setAttribute(
        "class",
        classNames(containerHtml.getAttribute("class"), greyElevated2ClassName),
    );

    const durationString = formatDurationString(durationMs, durationMs);

    {
        const playIndicatorHtml = new HtmlElementGenerator("div");
        containerHtml.appendChild(playIndicatorHtml);
        playIndicatorHtml.setAttribute(
            "class",
            contentFileVideoPlayerStyles.playIndicatorClassName,
        );
        playIndicatorHtml.appendChild(createSvgHtmlGenerator(playIconSvg({weight: "fill"})));
        playIndicatorHtml.appendChild(
            createSvgHtmlGenerator(spinnerGapIconSvg({className: spinAnimationClassName})),
        );
    }

    {
        const durationPreviewHtml = new HtmlElementGenerator("div");
        containerHtml.appendChild(durationPreviewHtml);

        durationPreviewHtml.setAttribute(
            "class",
            contentFileVideoPlayerStyles.durationPreviewClassName,
        );

        durationPreviewHtml.appendChild(new HtmlTextGenerator(durationString));
    }

    const videoSrc = getContentFileViewerSrc({spaceId, signedUrlSearch, file});

    if (videoSrc === null) {
        const processingNoteHtml = new HtmlElementGenerator("div");
        containerHtml.appendChild(processingNoteHtml);
        processingNoteHtml.setAttribute(
            "class",
            contentFileVideoPlayerStyles.processingNoteClassName,
        );

        processingNoteHtml.appendChild(
            new HtmlTextGenerator("Processing video, this may take a few minutes"),
        );

        const processingNoteEllipsisHtml = new HtmlElementGenerator("span");
        processingNoteHtml.appendChild(processingNoteEllipsisHtml);
        processingNoteEllipsisHtml.setAttribute(
            "class",
            contentFileVideoPlayerStyles.processingNoteEllipsisClassName,
        );
        processingNoteEllipsisHtml.appendChild(new HtmlTextGenerator("…"));
    }
    // Only render the `<video>` element inline if the area is large enough.
    // Otherwise a press should open our file viewer where you'll be able to watch
    // the video.
    else if (layout.width > 250 && layout.height > 150) {
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

        const controlsHtml = new HtmlElementGenerator("div");
        controlsContainerHtml.appendChild(controlsHtml);
        controlsHtml.setAttribute("class", contentFileVideoPlayerStyles.controlsClassName);

        {
            const playButtonHtml = new HtmlElementGenerator("div");
            controlsHtml.appendChild(playButtonHtml);
            playButtonHtml.setAttribute("class", contentFileVideoPlayerStyles.playButtonClassName);

            playButtonHtml.appendChild(createSvgHtmlGenerator(playIconSvg({weight: "fill"})));
            playButtonHtml.appendChild(createSvgHtmlGenerator(pauseIconSvg({weight: "fill"})));
        }

        {
            const durationProgressHtml = new HtmlElementGenerator("div");
            controlsHtml.appendChild(durationProgressHtml);
            durationProgressHtml.setAttribute(
                "class",
                contentFileVideoPlayerStyles.durationProgressClassName,
            );

            {
                const durationProgressCurrentHtml = new HtmlElementGenerator("div");
                durationProgressHtml.appendChild(durationProgressCurrentHtml);
                durationProgressCurrentHtml.setAttribute(
                    "class",
                    contentFileVideoPlayerStyles.durationProgressCurrentClassName,
                );
            }

            {
                const durationProgressDividerHtml = new HtmlElementGenerator("div");
                durationProgressHtml.appendChild(durationProgressDividerHtml);
                durationProgressDividerHtml.appendChild(new HtmlTextGenerator("/"));
            }

            {
                const durationProgressTotalHtml = new HtmlElementGenerator("div");
                durationProgressHtml.appendChild(durationProgressTotalHtml);
                durationProgressTotalHtml.appendChild(new HtmlTextGenerator(durationString));
            }
        }

        {
            const scrubberContainerHtml = new HtmlElementGenerator("div");
            controlsHtml.appendChild(scrubberContainerHtml);
            scrubberContainerHtml.setAttribute(
                "class",
                contentFileVideoPlayerStyles.scrubberContainerClassName,
            );

            {
                const scrubberHtml = new HtmlElementGenerator("div");
                scrubberContainerHtml.appendChild(scrubberHtml);
                scrubberHtml.setAttribute("class", contentFileVideoPlayerStyles.scrubberClassName);

                {
                    const scrubberThumbIndicatorHtml = new HtmlElementGenerator("div");
                    scrubberHtml.appendChild(scrubberThumbIndicatorHtml);
                    scrubberThumbIndicatorHtml.setAttribute(
                        "class",
                        contentFileVideoPlayerStyles.scrubberThumbIndicatorClassName,
                    );
                }

                {
                    const scrubberThumbTargetHtml = new HtmlElementGenerator("div");
                    scrubberHtml.appendChild(scrubberThumbTargetHtml);
                    scrubberThumbTargetHtml.setAttribute(
                        "class",
                        contentFileVideoPlayerStyles.scrubberThumbTargetClassName,
                    );
                }

                {
                    const scrubberTrackHtml = new HtmlElementGenerator("div");
                    scrubberHtml.appendChild(scrubberTrackHtml);
                    scrubberTrackHtml.setAttribute(
                        "class",
                        contentFileVideoPlayerStyles.scrubberTrackClassName,
                    );

                    {
                        const scrubberTrackProgressHtml = new HtmlElementGenerator("div");
                        scrubberTrackHtml.appendChild(scrubberTrackProgressHtml);
                        scrubberTrackProgressHtml.setAttribute(
                            "class",
                            contentFileVideoPlayerStyles.scrubberTrackProgressClassName,
                        );
                    }

                    {
                        const scrubberTrackBufferedHtml = new HtmlElementGenerator("div");
                        scrubberTrackHtml.appendChild(scrubberTrackBufferedHtml);
                        scrubberTrackBufferedHtml.setAttribute(
                            "class",
                            contentFileVideoPlayerStyles.scrubberTrackBufferedClassName,
                        );
                    }
                }
            }
        }

        {
            const playbackRateButtonHtml = new HtmlElementGenerator("div");
            controlsHtml.appendChild(playbackRateButtonHtml);
            playbackRateButtonHtml.setAttribute(
                "class",
                contentFileVideoPlayerStyles.playbackRateButtonClassName,
            );
        }

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
        getReporter,
    }: {
        durationMs: number;
        getReporter: () => Reporter;
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

    const processingNoteElement =
        containerElement.getElementsByClassName(
            contentFileVideoPlayerStyles.processingNoteClassName,
        )[0] ?? null;

    const controlsContainerElement = assertExists(
        containerElement.getElementsByClassName(
            contentFileVideoPlayerStyles.controlsContainerClassName,
        )[0],
    ) as HTMLDivElement;

    const playButtonElement = assertExists(
        containerElement.getElementsByClassName(
            contentFileVideoPlayerStyles.playButtonClassName,
        )[0],
    ) as HTMLDivElement;

    const durationProgressCurrentElement = assertExists(
        containerElement.getElementsByClassName(
            contentFileVideoPlayerStyles.durationProgressCurrentClassName,
        )[0],
    ) as HTMLDivElement;

    const scrubberElement = assertExists(
        containerElement.getElementsByClassName(contentFileVideoPlayerStyles.scrubberClassName)[0],
    ) as HTMLDivElement;

    const scrubberThumbIndicatorElement = assertExists(
        containerElement.getElementsByClassName(
            contentFileVideoPlayerStyles.scrubberThumbIndicatorClassName,
        )[0],
    ) as HTMLDivElement;

    const scrubberThumbTargetElement = assertExists(
        containerElement.getElementsByClassName(
            contentFileVideoPlayerStyles.scrubberThumbTargetClassName,
        )[0],
    ) as HTMLDivElement;

    const scrubberTrackProgressElement = assertExists(
        containerElement.getElementsByClassName(
            contentFileVideoPlayerStyles.scrubberTrackProgressClassName,
        )[0],
    ) as HTMLDivElement;

    const scrubberTrackBufferedElement = assertExists(
        containerElement.getElementsByClassName(
            contentFileVideoPlayerStyles.scrubberTrackBufferedClassName,
        )[0],
    ) as HTMLDivElement;

    const playbackRateButtonElement = assertExists(
        containerElement.getElementsByClassName(
            contentFileVideoPlayerStyles.playbackRateButtonClassName,
        )[0],
    ) as HTMLDivElement;

    const fullscreenButtonElement = assertExists(
        containerElement.getElementsByClassName(
            contentFileVideoPlayerStyles.fullscreenButtonClassName,
        )[0],
    ) as HTMLDivElement;

    const cleanupFunctions: Array<() => void> = [];

    /* ========================================================================== *\
     *                              Control buttons                               *
    \* ========================================================================== */

    {
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

        controlsContainerElement.addEventListener(
            "pointerdown",
            handleControlsContainerPointerDown,
        );

        cleanupFunctions.push(() => {
            controlsContainerElement.removeEventListener(
                "pointerdown",
                handleControlsContainerPointerDown,
            );
        });
    }

    cleanupFunctions.push(
        addUnfocusableButtonBehaviorToElement(playButtonElement, {
            defaultClassName: sprinkles({
                color: "grey-90",
            }),
            hoverClassName: sprinkles({
                color: "grey-90",
                backgroundColor: "grey-5",
            }),
            pressClassName: sprinkles({
                color: "grey-100",
                backgroundColor: "grey-10",
            }),
            onPress: () => {
                togglePlay();
            },
        }),
    );

    cleanupFunctions.push(
        addUnfocusableButtonBehaviorToElement(fullscreenButtonElement, {
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
                            "Couldn't exit video fullscreen",
                            error,
                        );
                    });
                }
            },
        }),
    );

    cleanupFunctions.push(
        addUnfocusableButtonBehaviorToElement(playbackRateButtonElement, {
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
                if (videoElement === null) return;

                if (videoElement.playbackRate === 1) {
                    videoElement.playbackRate = 1.5;
                } else if (videoElement.playbackRate === 1.5) {
                    videoElement.playbackRate = 2;
                } else {
                    videoElement.playbackRate = 1;
                }
            },
        }),
    );

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
    let isPointerOverControls = controlsContainerElement.classList.contains(
        contentFileVideoPlayerStyles.hoveredControlsClassName,
    );

    {
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
     *                                 Play/pause                                 *
    \* ========================================================================== */

    const updateScrubberProgress = (progress: number) => {
        const transform = `translateX(${progress * scrubberElement.clientWidth}px)`;
        scrubberThumbIndicatorElement.style.transform = transform;
        scrubberThumbTargetElement.style.transform = transform;

        scrubberTrackProgressElement.style.transform = `scaleX(${progress})`;

        {
            const progressTime = (durationMs * progress) / 1000;

            let hasBufferedTimeRange = false;

            // `videoElement.buffered` is a [normalized `TimeRanges` object][1] which
            // means:
            //
            // > The ranges in such an object are ordered, don't overlap, and don't touch
            // > (adjacent ranges are folded into one bigger range). A range can be empty
            // > (referencing just a single moment in time).
            //
            // [1]: https://developer.mozilla.org/en-US/docs/Web/API/TimeRanges#normalized_timeranges_objects
            if (videoElement !== null) {
                for (let i = 0; i < videoElement.buffered.length; i++) {
                    const bufferedTimeRangeStartTime = videoElement.buffered.start(i);
                    const bufferedTimeRangeEndTime = videoElement.buffered.end(i);

                    // There won't be any relevant buffered time ranges after this because all
                    // further time ranges in this array will be greater than `progressTime`.
                    if (progressTime < bufferedTimeRangeStartTime) {
                        break;
                    }

                    if (
                        bufferedTimeRangeStartTime <= progressTime &&
                        progressTime <= bufferedTimeRangeEndTime
                    ) {
                        hasBufferedTimeRange = true;
                        const bufferedProgress = (bufferedTimeRangeEndTime * 1000) / durationMs;
                        scrubberTrackBufferedElement.style.transform = `scaleX(${bufferedProgress})`;
                        break;
                    }
                }
            }

            if (!hasBufferedTimeRange) {
                const bufferedProgress = 0;
                scrubberTrackBufferedElement.style.transform = `scaleX(${bufferedProgress})`;
            }
        }
    };

    let playingAnimationState: {
        anchorSessionTime: number;
        anchorVideoTime: number;
        frameId: number;
    } | null = null;

    if (videoElement !== null) {
        const handlePlay = () => {
            containerElement.classList.add(contentFileVideoPlayerStyles.playingClassName);

            if (playingAnimationState !== null) {
                cancelAnimationFrame(playingAnimationState.frameId);
                playingAnimationState = null;
            }

            playingAnimationState = {
                anchorSessionTime: performance.now(),
                anchorVideoTime: videoElement.currentTime * 1000,
                frameId: runPlayAnimationLoop(),
            };

            updateStillPointerTimeout();
        };

        const handlePause = () => {
            containerElement.classList.remove(contentFileVideoPlayerStyles.playingClassName);

            if (playingAnimationState !== null) {
                cancelAnimationFrame(playingAnimationState.frameId);
                playingAnimationState = null;
            }

            updateStillPointerTimeout();

            // If while waiting the user pauses we need to remove the waiting class name
            // since we won't receive the `playing` event which normally removes this
            // class.
            containerElement.classList.remove(contentFileVideoPlayerStyles.waitingClassName);
        };

        // While the video is playing we run a `requestAnimationFrame()` loop that
        // animates our scrubber.
        const runPlayAnimationLoop = () => {
            return requestAnimationFrame(() => {
                if (playingAnimationState === null) return;

                // If we've set `display: none` on the scrubber (which means
                // `scrubberElement.clientWidth` will be 0) then don't animate our scrubber.
                //
                // If we're dragging then we position the scrubber based on the user's current
                // drag position. Not based on the video's actual time.
                if (scrubberThumbDragState === null && scrubberElement.clientWidth > 0) {
                    const currentSessionTime = performance.now();

                    const actualVideoTime = videoElement.currentTime * 1000;

                    const expectedVideoTime =
                        playingAnimationState.anchorVideoTime +
                        (currentSessionTime - playingAnimationState.anchorSessionTime);

                    // Since `videoElement.currentTime` doesn't update as quickly as we'd like
                    // (`timeupdate` fires every ~200ms) we estimate the correct time using a high
                    // resolution clock. If our estimated time is within a 1.5s window of
                    // `videoElement.currentTime` then we use it. If our estimated time isn't in a
                    // 1.5s window that's probably because the user skipped ahead or backwards in
                    // the video.
                    let videoTime;
                    if (Math.abs(actualVideoTime - expectedVideoTime) < 1500 / 2) {
                        videoTime = expectedVideoTime;
                    } else {
                        videoTime = actualVideoTime;
                        playingAnimationState.anchorSessionTime = currentSessionTime;
                        playingAnimationState.anchorVideoTime = actualVideoTime;
                    }

                    const progress = videoTime / durationMs;
                    updateScrubberProgress(progress);
                }

                playingAnimationState.frameId = runPlayAnimationLoop();
            });
        };

        // When we re-initialize the effect, make sure we update the playing class
        // name state.
        if (!videoElement.paused) {
            handlePlay();
        } else {
            handlePause();
        }

        videoElement.addEventListener("play", handlePlay);
        videoElement.addEventListener("pause", handlePause);

        cleanupFunctions.push(() => {
            if (playingAnimationState !== null) {
                cancelAnimationFrame(playingAnimationState.frameId);
                playingAnimationState = null;
            }

            videoElement.removeEventListener("play", handlePlay);
            videoElement.removeEventListener("pause", handlePause);
        });
    }

    const togglePlay = () => {
        if (!videoElement) return;

        if (videoElement.paused) {
            videoElement.play().catch(error => {
                // Chrome throws an abort error if `pause()` is called before `play()` has
                // returned. Ignore play abort errors from Chrome. It's reasonable for the user
                // to pause if play is taking a long time to load.
                if (
                    error instanceof Error &&
                    error.name === "AbortError" &&
                    error.message.includes("pause")
                ) {
                    return;
                }

                getReporter().displayError("Couldn’t play video", error);
            });
        } else {
            videoElement.pause();
        }
    };

    /* ========================================================================== *\
     *                             Loading indicator                              *
    \* ========================================================================== */

    if (videoElement === null) {
        if (processingNoteElement) {
            containerElement.classList.add(contentFileVideoPlayerStyles.waitingClassName);

            cleanupFunctions.push(() => {
                containerElement.classList.remove(contentFileVideoPlayerStyles.waitingClassName);
            });
        }
    } else {
        const handlePlaying = () => {
            containerElement.classList.remove(contentFileVideoPlayerStyles.waitingClassName);

            // Once we actually start playing our video for the first time we add the "has
            // played" class and never remove it. We don't show video controls until the
            // video starts playing.
            if (
                !containerElement.classList.contains(
                    contentFileVideoPlayerStyles.hasPlayedClassName,
                )
            ) {
                containerElement.classList.add(contentFileVideoPlayerStyles.hasPlayedClassName);

                // Reset the still pointer timeout after `hasPlayedClassName` has been added
                // since the controls won't be visible until after `hasPlayedClassName` is
                // added.
                resetStillPointerTimeout();
            }
        };

        const handleWaiting = () => {
            containerElement.classList.add(contentFileVideoPlayerStyles.waitingClassName);
        };

        videoElement.addEventListener("playing", handlePlaying);
        videoElement.addEventListener("waiting", handleWaiting);

        cleanupFunctions.push(() => {
            videoElement.removeEventListener("playing", handlePlaying);
            videoElement.removeEventListener("waiting", handleWaiting);
        });
    }

    /* ========================================================================== *\
     *                            Scrubber drag events                            *
    \* ========================================================================== */

    if (videoElement !== null) {
        const handleScrubberPointerDown = (event: PointerEvent) => {
            // Ignore presses on our scrubber thumb. That'll initiate a drag.
            if (event.target instanceof Node && scrubberThumbTargetElement.contains(event.target)) {
                return;
            }

            event.preventDefault();

            const scrubberRect = scrubberElement.getBoundingClientRect();

            const progress = clamp(0, (event.clientX - scrubberRect.left) / scrubberRect.width, 1);

            // If the `fastSeek()` method is available then use that. Precision doesn't
            // matter as much when moving by clicking on the scrubber. Speed matters more.
            if (videoElement.fastSeek) {
                videoElement.fastSeek((progress * durationMs) / 1000);
            } else {
                videoElement.currentTime = (progress * durationMs) / 1000;
            }

            // Optimistically the scrubber based on the click position. Instead of waiting
            // for a `timeupdate` event which happens after the video has loaded.
            updateScrubberProgress(progress);
        };

        scrubberElement.addEventListener("pointerdown", handleScrubberPointerDown);

        cleanupFunctions.push(() => {
            scrubberElement.removeEventListener("pointerdown", handleScrubberPointerDown);
        });
    }

    let scrubberThumbDragState: {
        coverElement: HTMLDivElement;
    } | null = null;

    if (videoElement !== null) {
        const startScrubberThumbDrag = (event: PointerEvent) => {
            event.preventDefault();

            const dragCoverElement = document.createElement("div");

            dragCoverElement.className = sprinkles({
                position: "absolute",
                inset: "0",
                zIndex: "70",
                cursor: "grabbing",
            });

            scrubberThumbDragState = {
                coverElement: dragCoverElement,
            };

            containerElement.classList.add(
                contentFileVideoPlayerStyles.draggingScrubberThumbClassName,
            );
            document.body.appendChild(dragCoverElement);
            document.addEventListener("pointerup", handleDocumentPointerUp);
            document.addEventListener("pointermove", handleDocumentPointerMove);
        };

        const cancelScrubberThumbDrag = () => {
            if (!scrubberThumbDragState) return;

            containerElement.classList.remove(
                contentFileVideoPlayerStyles.draggingScrubberThumbClassName,
            );
            document.body.removeChild(scrubberThumbDragState.coverElement);
            document.removeEventListener("pointerup", handleDocumentPointerUp);
            document.removeEventListener("pointermove", handleDocumentPointerMove);

            scrubberThumbDragState = null;
        };

        const handleDocumentPointerUp = () => {
            cancelScrubberThumbDrag();
        };

        const handleDocumentPointerMove = (event: PointerEvent) => {
            if (!scrubberThumbDragState) return;

            const scrubberRect = scrubberElement.getBoundingClientRect();

            const progress = clamp(0, (event.clientX - scrubberRect.left) / scrubberRect.width, 1);

            videoElement.currentTime = (progress * durationMs) / 1000;

            // Update the scrubber based on our current drag position. While dragging we
            // optimistically use the user's pointer position, not the video's actual
            // current time.
            updateScrubberProgress(progress);
        };

        scrubberThumbTargetElement.addEventListener("pointerdown", startScrubberThumbDrag);

        cleanupFunctions.push(() => {
            // We don't preserve our drag state in the DOM. It's ok to cancel our drag when
            // the behavior function re-runs.
            cancelScrubberThumbDrag();

            scrubberThumbTargetElement.removeEventListener("pointerdown", startScrubberThumbDrag);
        });
    }

    /* ========================================================================== *\
     *                             Duration progress                              *
    \* ========================================================================== */

    {
        const maybeUpdateScrubberProgress = () => {
            // If our `requestAnimationFrame()` loop is not running then update the
            // scrubber position on every `timeupdate` event.
            //
            // If we're dragging then we position the scrubber based on the user's current
            // drag position. Not based on the video's actual time.
            if (playingAnimationState === null && scrubberThumbDragState === null) {
                const progress = ((videoElement?.currentTime ?? 0) * 1000) / durationMs;
                updateScrubberProgress(progress);
            }
        };

        const handleTimeUpdate = () => {
            // We can't edit DOM nodes since that'll interfere with
            // `HtmlElementGenerator.patchNode()` so instead we update the `data-time`
            // attribute and render it with CSS.
            durationProgressCurrentElement.setAttribute(
                "data-time",
                formatDurationString((videoElement?.currentTime ?? 0) * 1000, durationMs),
            );

            maybeUpdateScrubberProgress();
        };

        // We listen to the `progress` event to update the buffered segment of our
        // track. As more data loads more data may be buffered.
        const handleProgress = () => {
            maybeUpdateScrubberProgress();
        };

        const handleScrubberResize = () => {
            maybeUpdateScrubberProgress();
        };

        handleTimeUpdate();

        if (videoElement !== null) {
            videoElement.addEventListener("timeupdate", handleTimeUpdate);
            videoElement.addEventListener("progress", handleProgress);
            addResizeListenerForElement(scrubberElement, handleScrubberResize);

            cleanupFunctions.push(() => {
                videoElement.removeEventListener("timeupdate", handleTimeUpdate);
                videoElement.removeEventListener("progress", handleProgress);
                removeResizeListenerForElement(scrubberElement, handleScrubberResize);
            });
        }
    }

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
     *                               Playback rate                                *
    \* ========================================================================== */

    {
        const handleRateChange = () => {
            playbackRateButtonElement.setAttribute(
                "data-rate",
                `${videoElement?.playbackRate ?? 1}x`,
            );
        };

        handleRateChange();

        if (videoElement !== null) {
            videoElement.addEventListener("ratechange", handleRateChange);

            cleanupFunctions.push(() => {
                videoElement.removeEventListener("ratechange", handleRateChange);
            });
        }
    }

    return {
        onPress: () => {
            if (!videoElement) return;

            togglePlay();
            return {preventDefault: true};
        },
        cleanup: () => {
            for (const cleanup of cleanupFunctions) {
                cleanup();
            }
        },
    };
}

function formatDurationString(durationMs: number, totalDurationMs: number): string {
    const durationSeconds = Math.floor(durationMs / 1000);
    const totalDurationSeconds = Math.floor(totalDurationMs / 1000);

    const durationSecondsPlace = durationSeconds % 60;
    const durationMinutesPlace = Math.floor(durationSeconds / 60) % 60;
    const durationHoursPlace = Math.floor(durationSeconds / (60 * 60));

    const totalDurationHoursPlace = Math.floor(totalDurationSeconds / (60 * 60));

    return (
        (totalDurationMs > 1000 * 60 * 60
            ? String(durationHoursPlace).padStart(String(totalDurationHoursPlace).length, "0") + ":"
            : "") +
        String(durationMinutesPlace).padStart(2, "0") +
        ":" +
        String(durationSecondsPlace).padStart(2, "0")
    );
}
