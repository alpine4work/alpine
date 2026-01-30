import {addUnfocusableButtonBehaviorToElement} from "~/client/web/content/state/add_unfocusable_button_behavior_to_element.js";
import {Reporter} from "~/client/web/design/reporter.js";
import {tooltipDelayMs} from "~/client/web/design/tooltip.js";
import {getIsInitialAppRender} from "~/client/web/helpers/lifecycle/initial_app_render.js";
import {
    addResizeListenerForElement,
    addSuppressResizeLoopErrorNotificationForElement,
    removeResizeListenerForElement,
    removeSuppressResizeLoopErrorNotificationForElement,
} from "~/client/web/helpers/use_resize_observer.js";
import {createSvgHtmlGenerator} from "~/client/web/icons/create_svg_html_generator.js";
import {pauseIconSvg} from "~/client/web/icons/pause_icon_svg.js";
import {playIconSvg} from "~/client/web/icons/play_icon_svg.js";
import {speakerSimpleHighIconSvg} from "~/client/web/icons/speaker_simple_high_icon_svg.js";
import {speakerSimpleLowIconSvg} from "~/client/web/icons/speaker_simple_low_icon_svg.js";
import {speakerSimpleNoneIconSvg} from "~/client/web/icons/speaker_simple_none_icon_svg.js";
import {speakerSimpleSlashIconSvg} from "~/client/web/icons/speaker_simple_slash_icon_svg.js";
import {
    contentFileVideoAndAudioPlayerControlsStyles,
    sprinkles,
} from "~/client/web/styles/styles.js";
import {Platform} from "~/shared/design/core/platform.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {HtmlElementGenerator, HtmlTextGenerator} from "~/shared/helpers/html/html_generator.js";
import {clamp} from "~/shared/helpers/number/clamp.js";

type PlayerControlsStylesString = keyof typeof contentFileVideoAndAudioPlayerControlsStyles;

export function renderContentFileVideoAndAudioPlayerControls({
    durationMs,
    isInitialAppRender,
    platform,
}: {
    durationMs: number;
    isInitialAppRender: boolean;
    platform: Platform;
}) {
    const durationString = formatContentFileVideoAndAudioPlayerDurationString(
        durationMs,
        durationMs,
    );

    const controlsHtml = new HtmlElementGenerator("div");
    controlsHtml.setAttribute(
        "class",
        contentFileVideoAndAudioPlayerControlsStyles.controlsClassName,
    );

    {
        const playButtonHtml = new HtmlElementGenerator("div");
        controlsHtml.appendChild(playButtonHtml);
        playButtonHtml.setAttribute(
            "class",
            contentFileVideoAndAudioPlayerControlsStyles.playButtonClassName,
        );

        playButtonHtml.appendChild(createSvgHtmlGenerator(playIconSvg({weight: "fill"})));
        playButtonHtml.appendChild(createSvgHtmlGenerator(pauseIconSvg({weight: "fill"})));
    }

    {
        const durationProgressHtml = new HtmlElementGenerator("div");
        controlsHtml.appendChild(durationProgressHtml);
        durationProgressHtml.setAttribute(
            "class",
            contentFileVideoAndAudioPlayerControlsStyles.durationProgressClassName,
        );

        {
            const durationProgressCurrentHtml = new HtmlElementGenerator("div");
            durationProgressHtml.appendChild(durationProgressCurrentHtml);
            durationProgressCurrentHtml.setAttribute(
                "class",
                contentFileVideoAndAudioPlayerControlsStyles.durationProgressCurrentClassName,
            );

            // Set `data-time` on the initial render since our add behavior function won't
            // run until React mounts.
            if (isInitialAppRender) {
                durationProgressCurrentHtml.setAttribute(
                    "data-time",
                    formatContentFileVideoAndAudioPlayerDurationString(0, durationMs),
                );
            }
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
            contentFileVideoAndAudioPlayerControlsStyles.scrubberContainerClassName,
        );

        {
            const scrubberHtml = new HtmlElementGenerator("div");
            scrubberContainerHtml.appendChild(scrubberHtml);
            scrubberHtml.setAttribute(
                "class",
                contentFileVideoAndAudioPlayerControlsStyles.durationScrubberClassName,
            );

            {
                const scrubberThumbIndicatorHtml = new HtmlElementGenerator("div");
                scrubberHtml.appendChild(scrubberThumbIndicatorHtml);
                scrubberThumbIndicatorHtml.setAttribute(
                    "class",
                    contentFileVideoAndAudioPlayerControlsStyles.durationScrubberThumbIndicatorClassName,
                );
            }

            {
                const scrubberThumbTargetHtml = new HtmlElementGenerator("div");
                scrubberHtml.appendChild(scrubberThumbTargetHtml);
                scrubberThumbTargetHtml.setAttribute(
                    "class",
                    contentFileVideoAndAudioPlayerControlsStyles.durationScrubberThumbTargetClassName,
                );
            }

            {
                const scrubberTrackHtml = new HtmlElementGenerator("div");
                scrubberHtml.appendChild(scrubberTrackHtml);
                scrubberTrackHtml.setAttribute(
                    "class",
                    contentFileVideoAndAudioPlayerControlsStyles.scrubberTrackClassName,
                );

                // Don't render our tracks on the initial render since we won't be able to
                // scale them until React mounts.
                if (!isInitialAppRender) {
                    {
                        const scrubberTrackProgressHtml = new HtmlElementGenerator("div");
                        scrubberTrackHtml.appendChild(scrubberTrackProgressHtml);
                        scrubberTrackProgressHtml.setAttribute(
                            "class",
                            contentFileVideoAndAudioPlayerControlsStyles.durationScrubberTrackProgressClassName,
                        );
                    }

                    {
                        const scrubberTrackBufferedHtml = new HtmlElementGenerator("div");
                        scrubberTrackHtml.appendChild(scrubberTrackBufferedHtml);
                        scrubberTrackBufferedHtml.setAttribute(
                            "class",
                            contentFileVideoAndAudioPlayerControlsStyles.durationScrubberTrackBufferedClassName,
                        );
                    }
                }
            }
        }
    }

    // Only render the volume controls on desktop.
    // In mobile environments, we'll trust the device's native controls.
    if (platform === "desktop") {
        const volumeButtonContainerHtml = new HtmlElementGenerator("div");
        controlsHtml.appendChild(volumeButtonContainerHtml);

        {
            const volumeButtonHtml = new HtmlElementGenerator("div");
            volumeButtonContainerHtml.appendChild(volumeButtonHtml);
            volumeButtonHtml.setAttribute(
                "class",
                contentFileVideoAndAudioPlayerControlsStyles.volumeButtonClassName,
            );

            const icons = [
                speakerSimpleSlashIconSvg,
                speakerSimpleNoneIconSvg,
                speakerSimpleLowIconSvg,
                speakerSimpleHighIconSvg,
            ];

            icons.forEach(icon => {
                volumeButtonHtml.appendChild(createSvgHtmlGenerator(icon({})));
            });
        }

        {
            const volumeSelectorHtml = new HtmlElementGenerator("div");
            volumeButtonContainerHtml.appendChild(volumeSelectorHtml);
            volumeSelectorHtml.setAttribute(
                "class",
                contentFileVideoAndAudioPlayerControlsStyles.volumeSelectorClassName,
            );

            {
                const volumeScrubberHtml = new HtmlElementGenerator("div");
                volumeSelectorHtml.appendChild(volumeScrubberHtml);
                volumeScrubberHtml.setAttribute(
                    "class",
                    contentFileVideoAndAudioPlayerControlsStyles.volumeScrubberClassName,
                );

                {
                    const volumeScrubberThumbIndicatorHtml = new HtmlElementGenerator("div");
                    volumeScrubberHtml.appendChild(volumeScrubberThumbIndicatorHtml);
                    volumeScrubberThumbIndicatorHtml.setAttribute(
                        "class",
                        contentFileVideoAndAudioPlayerControlsStyles.volumeScrubberThumbIndicatorClassName,
                    );
                }

                {
                    const volumeScrubberThumbTargetHtml = new HtmlElementGenerator("div");
                    volumeScrubberHtml.appendChild(volumeScrubberThumbTargetHtml);
                    volumeScrubberThumbTargetHtml.setAttribute(
                        "class",
                        contentFileVideoAndAudioPlayerControlsStyles.volumeScrubberThumbTargetClassName,
                    );
                }

                {
                    const volumeScrubberTrackHtml = new HtmlElementGenerator("div");
                    volumeScrubberHtml.appendChild(volumeScrubberTrackHtml);
                    volumeScrubberTrackHtml.setAttribute(
                        "class",
                        contentFileVideoAndAudioPlayerControlsStyles.volumeTrackClassName,
                    );

                    // Don't render our tracks on the initial render since we won't be able to
                    // scale them until React mounts.
                    if (!isInitialAppRender) {
                        {
                            const volumeScrubberTrackProgressHtml = new HtmlElementGenerator("div");
                            volumeScrubberTrackHtml.appendChild(volumeScrubberTrackProgressHtml);
                            volumeScrubberTrackProgressHtml.setAttribute(
                                "class",
                                contentFileVideoAndAudioPlayerControlsStyles.volumeScrubberTrackProgressClassName,
                            );
                        }
                    }
                }
            }
        }
    }

    {
        const playbackRateButtonHtml = new HtmlElementGenerator("div");
        controlsHtml.appendChild(playbackRateButtonHtml);
        playbackRateButtonHtml.setAttribute(
            "class",
            contentFileVideoAndAudioPlayerControlsStyles.playbackRateButtonClassName,
        );

        // Set `data-rate` on the initial render since our add behavior function won't
        // run until React mounts.
        if (isInitialAppRender) {
            playbackRateButtonHtml.setAttribute("data-rate", "1x");
        }
    }

    return controlsHtml;
}

/**
 * Add interactions to the content file video or audio player controls rendered
 * by `renderContentFileVideoAndAudioPlayerControls()`. The provided container
 * element must have the class
 * `contentFileVideoAndAudioPlayerControlsStyles.containerClassName`.
 *
 * IMPORTANT: Read the following implementation notes before making changes.
 *
 * ## Implementation notes
 *
 * The code for our video and audio player is styled after React. (We'll use
 * the video player as an example for the rest of this comment.) We have a
 * functional render function (`renderContentFileVideoPlayer()`) and setup
 * interactivity with an effect (`addContentFileVideoPlayerBehavior()`). We'd
 * love to use React directly but we can't because our video player is rendered
 * in a ProseMirror `contenteditable`. So we need to build the video player's
 * interactivity by directly attaching DOM events.
 *
 * Our behavior function MUST NOT edit the DOM by adding or removing DOM nodes.
 * This will mess up `HtmlElementGenerator.patchNode()` if ProseMirror needs to
 * re-render our video player. Instead you may only add/remove classes and
 * attributes that `renderContentFileVideoPlayer()` doesn't know about. Since
 * `HtmlElementGenerator.patchNode()` leaves these alone.
 */
export function addContentFileVideoAndAudioPlayerControlsBehavior({
    durationMs,
    containerElement,
    mediaElement,
    getReporter,
    onOpenViewer,
    onPlay,
    onPause,
    onHasPlayed,
    onSeek,
    onPlayAnimationFrame,
}: {
    durationMs: number;
    containerElement: Element;
    mediaElement: HTMLMediaElement | null;
    getReporter: () => Reporter;
    onOpenViewer: (() => void) | undefined;
    onPlay?: () => void;
    onPause?: () => void;
    onHasPlayed?: () => void;
    onSeek?: () => void;
    onPlayAnimationFrame?: () => void;
}) {
    // Shouldn't add file preview behavior until after initial app render.
    assert(!getIsInitialAppRender());

    assert(
        containerElement.classList.contains(
            contentFileVideoAndAudioPlayerControlsStyles.containerClassName,
        ),
    );

    const playButtonElement = assertExists(
        containerElement.getElementsByClassName(
            contentFileVideoAndAudioPlayerControlsStyles.playButtonClassName,
        )[0],
    ) as HTMLDivElement;

    const durationProgressCurrentElement = assertExists(
        containerElement.getElementsByClassName(
            contentFileVideoAndAudioPlayerControlsStyles.durationProgressCurrentClassName,
        )[0],
    ) as HTMLDivElement;

    const durationScrubberElement = assertExists(
        containerElement.getElementsByClassName(
            contentFileVideoAndAudioPlayerControlsStyles.durationScrubberClassName,
        )[0],
    ) as HTMLDivElement;

    const durationScrubberThumbIndicatorElement = assertExists(
        durationScrubberElement.getElementsByClassName(
            contentFileVideoAndAudioPlayerControlsStyles.durationScrubberThumbIndicatorClassName,
        )[0],
    ) as HTMLDivElement;

    const durationScrubberThumbTargetElement = assertExists(
        durationScrubberElement.getElementsByClassName(
            contentFileVideoAndAudioPlayerControlsStyles.durationScrubberThumbTargetClassName,
        )[0],
    ) as HTMLDivElement;

    const durationScrubberTrackProgressElement = assertExists(
        durationScrubberElement.getElementsByClassName(
            contentFileVideoAndAudioPlayerControlsStyles.durationScrubberTrackProgressClassName,
        )[0],
    ) as HTMLDivElement;

    const durationScrubberTrackBufferedElement = assertExists(
        durationScrubberElement.getElementsByClassName(
            contentFileVideoAndAudioPlayerControlsStyles.durationScrubberTrackBufferedClassName,
        )[0],
    ) as HTMLDivElement;

    const playbackRateButtonElement = assertExists(
        containerElement.getElementsByClassName(
            contentFileVideoAndAudioPlayerControlsStyles.playbackRateButtonClassName,
        )[0],
    ) as HTMLDivElement;

    // Volume render is conditional - see the creation of these elements above
    const volumeButtonElement = containerElement.getElementsByClassName(
        contentFileVideoAndAudioPlayerControlsStyles.volumeButtonClassName,
    )[0] as HTMLDivElement | null;
    const volumeSelectorElement = containerElement.getElementsByClassName(
        contentFileVideoAndAudioPlayerControlsStyles.volumeSelectorClassName,
    )[0] as HTMLDivElement | null;
    const volumeScrubberElement = containerElement.getElementsByClassName(
        contentFileVideoAndAudioPlayerControlsStyles.volumeScrubberClassName,
    )[0] as HTMLDivElement | null;

    const volumeScrubberThumbIndicatorElement = volumeScrubberElement?.getElementsByClassName(
        contentFileVideoAndAudioPlayerControlsStyles.volumeScrubberThumbIndicatorClassName,
    )[0] as HTMLDivElement | null;

    const volumeScrubberThumbTargetElement = volumeScrubberElement?.getElementsByClassName(
        contentFileVideoAndAudioPlayerControlsStyles.volumeScrubberThumbTargetClassName,
    )[0] as HTMLDivElement | null;

    const volumeScrubberTrackProgressElement = volumeScrubberElement?.getElementsByClassName(
        contentFileVideoAndAudioPlayerControlsStyles.volumeScrubberTrackProgressClassName,
    )[0] as HTMLDivElement | null;

    const cleanupFunctions: Array<() => void> = [];

    /* ========================================================================== *\
     *                                  Buttons                                   *
    \* ========================================================================== */

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
            onPress: event => {
                // Secret feature! If you shift click the fullscreen button in a video preview
                // it'll open the file viewer. This feature is really only for developers. We
                // need to support videos in the file viewer even though basically all
                // functionality is available inline.
                if (event.shiftKey && onOpenViewer) {
                    if (mediaElement && !mediaElement.paused) {
                        mediaElement.pause();
                    }

                    onOpenViewer();
                    return;
                }

                togglePlay();
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
                if (!mediaElement) return;

                if (mediaElement.playbackRate === 1) {
                    mediaElement.playbackRate = 1.5;
                } else if (mediaElement.playbackRate === 1.5) {
                    mediaElement.playbackRate = 2;
                } else {
                    mediaElement.playbackRate = 1;
                }
            },
        }),
    );

    /* ========================================================================== *\
     *                                 Play/pause                                 *
    \* ========================================================================== */

    const updateScrubberProgress = (progress: number) => {
        if (progress < 0) progress = 0;
        if (progress > 1) progress = 1;

        const transform = `translateX(${progress * durationScrubberElement.clientWidth}px)`;
        durationScrubberThumbIndicatorElement.style.transform = transform;
        durationScrubberThumbTargetElement.style.transform = transform;

        durationScrubberTrackProgressElement.style.transform = `scaleX(${progress})`;

        {
            const progressTime = (durationMs * progress) / 1000;

            let hasBufferedTimeRange = false;

            // `mediaElement.buffered` is a [normalized `TimeRanges` object][1] which
            // means:
            //
            // > The ranges in such an object are ordered, don't overlap, and don't touch
            // > (adjacent ranges are folded into one bigger range). A range can be empty
            // > (referencing just a single moment in time).
            //
            // [1]: https://developer.mozilla.org/en-US/docs/Web/API/TimeRanges#normalized_timeranges_objects
            if (mediaElement !== null) {
                for (let i = 0; i < mediaElement.buffered.length; i++) {
                    const bufferedTimeRangeStartTime = mediaElement.buffered.start(i);
                    const bufferedTimeRangeEndTime = mediaElement.buffered.end(i);

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
                        durationScrubberTrackBufferedElement.style.transform = `scaleX(${bufferedProgress})`;
                        break;
                    }
                }
            }

            if (!hasBufferedTimeRange) {
                const bufferedProgress = 0;
                durationScrubberTrackBufferedElement.style.transform = `scaleX(${bufferedProgress})`;
            }
        }
    };

    let playingAnimationState: {
        anchorSessionTime: number;
        anchorVideoTime: number;
        frameId: number;
    } | null = null;

    {
        const handlePlay = () => {
            containerElement.classList.add(
                contentFileVideoAndAudioPlayerControlsStyles.playingClassName,
            );

            if (playingAnimationState !== null) {
                cancelAnimationFrame(playingAnimationState.frameId);
                playingAnimationState = null;
            }

            playingAnimationState = {
                anchorSessionTime: performance.now(),
                anchorVideoTime: (mediaElement?.currentTime ?? 0) * 1000,
                frameId: runPlayAnimationLoop(),
            };

            onPlay?.();
        };

        const handlePause = () => {
            containerElement.classList.remove(
                contentFileVideoAndAudioPlayerControlsStyles.playingClassName,
            );

            if (playingAnimationState !== null) {
                cancelAnimationFrame(playingAnimationState.frameId);
                playingAnimationState = null;
            }

            // If while waiting the user pauses we need to remove the waiting class name
            // since we won't receive the `playing` event which normally removes this
            // class.
            containerElement.classList.remove(
                contentFileVideoAndAudioPlayerControlsStyles.waitingClassName,
            );

            onPause?.();
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
                if (scrubberThumbDragState === null && durationScrubberElement.clientWidth > 0) {
                    const currentSessionTime = performance.now();

                    const actualVideoTime = (mediaElement?.currentTime ?? 0) * 1000;

                    const expectedVideoTime =
                        playingAnimationState.anchorVideoTime +
                        (currentSessionTime - playingAnimationState.anchorSessionTime) *
                            (mediaElement?.playbackRate ?? 1);

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

                onPlayAnimationFrame?.();

                playingAnimationState.frameId = runPlayAnimationLoop();
            });
        };

        // When we re-initialize the effect, make sure we update the playing class
        // name state.
        if (mediaElement && !mediaElement.paused) {
            handlePlay();
        } else {
            handlePause();
        }

        if (mediaElement) {
            mediaElement.addEventListener("play", handlePlay);
            mediaElement.addEventListener("pause", handlePause);

            cleanupFunctions.push(() => {
                if (playingAnimationState !== null) {
                    cancelAnimationFrame(playingAnimationState.frameId);
                    playingAnimationState = null;
                }

                mediaElement.removeEventListener("play", handlePlay);
                mediaElement.removeEventListener("pause", handlePause);
            });
        }
    }

    const togglePlay = () => {
        if (!mediaElement) return;

        if (mediaElement.paused) {
            mediaElement.play().catch(error => {
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

                getReporter().displayError("Couldn\u2019t play video", error);
            });
        } else {
            mediaElement.pause();
        }
    };

    /* ========================================================================== *\
     *                             Loading indicator                              *
    \* ========================================================================== */

    if (mediaElement !== null) {
        const handlePlaying = () => {
            containerElement.classList.remove(
                contentFileVideoAndAudioPlayerControlsStyles.waitingClassName,
            );

            // Once we actually start playing our video for the first time we add the "has
            // played" class and never remove it. We don't show video controls until the
            // video starts playing.
            if (
                !containerElement.classList.contains(
                    contentFileVideoAndAudioPlayerControlsStyles.hasPlayedClassName,
                )
            ) {
                containerElement.classList.add(
                    contentFileVideoAndAudioPlayerControlsStyles.hasPlayedClassName,
                );

                // Reset the still pointer timeout after `hasPlayedClassName` has been added
                // since the controls won't be visible until after `hasPlayedClassName` is
                // added.
                onHasPlayed?.();
            }
        };

        const handleWaiting = () => {
            containerElement.classList.add(
                contentFileVideoAndAudioPlayerControlsStyles.waitingClassName,
            );
        };

        mediaElement.addEventListener("playing", handlePlaying);
        mediaElement.addEventListener("waiting", handleWaiting);

        cleanupFunctions.push(() => {
            mediaElement.removeEventListener("playing", handlePlaying);
            mediaElement.removeEventListener("waiting", handleWaiting);
        });
    }

    /* ========================================================================== *\
     *                            Scrubber drag events                            *
    \* ========================================================================== */

    if (mediaElement !== null) {
        const handleScrubberPointerDown = (event: PointerEvent) => {
            // Ignore presses on our scrubber thumb. That'll initiate a drag.
            if (
                event.target instanceof Node &&
                durationScrubberThumbTargetElement.contains(event.target)
            ) {
                return;
            }

            event.preventDefault();

            const scrubberRect = durationScrubberElement.getBoundingClientRect();

            const progress = clamp(0, (event.clientX - scrubberRect.left) / scrubberRect.width, 1);

            // If the `fastSeek()` method is available then use that. Precision doesn't
            // matter as much when moving by clicking on the scrubber. Speed matters more.
            if (mediaElement.fastSeek) {
                mediaElement.fastSeek((progress * durationMs) / 1000);
            } else {
                mediaElement.currentTime = (progress * durationMs) / 1000;
            }

            // Optimistically the scrubber based on the click position. Instead of waiting
            // for a `timeupdate` event which happens after the video has loaded.
            updateScrubberProgress(progress);

            onSeek?.();
        };

        durationScrubberElement.addEventListener("pointerdown", handleScrubberPointerDown);

        cleanupFunctions.push(() => {
            durationScrubberElement.removeEventListener("pointerdown", handleScrubberPointerDown);
        });
    }

    let scrubberThumbDragState: {
        coverElement: HTMLDivElement;
    } | null = null;

    if (mediaElement !== null) {
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
                contentFileVideoAndAudioPlayerControlsStyles.draggingScrubberThumbClassName,
            );
            document.body.appendChild(dragCoverElement);
            document.addEventListener("pointerup", handleDocumentPointerUp);
            document.addEventListener("pointermove", handleDocumentPointerMove);
        };

        const cancelScrubberThumbDrag = () => {
            if (!scrubberThumbDragState) return;

            containerElement.classList.remove(
                contentFileVideoAndAudioPlayerControlsStyles.draggingScrubberThumbClassName,
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

            const scrubberRect = durationScrubberElement.getBoundingClientRect();

            const progress = clamp(0, (event.clientX - scrubberRect.left) / scrubberRect.width, 1);

            mediaElement.currentTime = (progress * durationMs) / 1000;

            // Update the scrubber based on our current drag position. While dragging we
            // optimistically use the user's pointer position, not the video's actual
            // current time.
            updateScrubberProgress(progress);

            onSeek?.();
        };

        durationScrubberThumbTargetElement.addEventListener("pointerdown", startScrubberThumbDrag);

        cleanupFunctions.push(() => {
            // We don't preserve our drag state in the DOM. It's ok to cancel our drag when
            // the behavior function re-runs.
            cancelScrubberThumbDrag();

            durationScrubberThumbTargetElement.removeEventListener(
                "pointerdown",
                startScrubberThumbDrag,
            );
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
                const progress = ((mediaElement?.currentTime ?? 0) * 1000) / durationMs;
                updateScrubberProgress(progress);
            }
        };

        const handleTimeUpdate = () => {
            // We can't edit DOM nodes since that'll interfere with
            // `HtmlElementGenerator.patchNode()` so instead we update the `data-time`
            // attribute and render it with CSS.
            durationProgressCurrentElement.setAttribute(
                "data-time",
                formatContentFileVideoAndAudioPlayerDurationString(
                    (mediaElement?.currentTime ?? 0) * 1000,
                    durationMs,
                ),
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

        if (mediaElement !== null) {
            mediaElement.addEventListener("timeupdate", handleTimeUpdate);
            mediaElement.addEventListener("progress", handleProgress);
            addSuppressResizeLoopErrorNotificationForElement(durationScrubberElement);
            addResizeListenerForElement(durationScrubberElement, handleScrubberResize);

            cleanupFunctions.push(() => {
                mediaElement.removeEventListener("timeupdate", handleTimeUpdate);
                mediaElement.removeEventListener("progress", handleProgress);
                removeResizeListenerForElement(durationScrubberElement, handleScrubberResize);
                removeSuppressResizeLoopErrorNotificationForElement(durationScrubberElement);
            });
        }
    }

    if (
        volumeButtonElement !== null &&
        volumeScrubberElement !== null &&
        volumeScrubberThumbIndicatorElement !== null &&
        volumeScrubberThumbTargetElement !== null &&
        volumeScrubberTrackProgressElement !== null
    ) {
        /* ========================================================================== *\
        *                                 Volume                                    *
        \* ========================================================================== */

        const updateVolumeScrubberProgress = (progress: number) => {
            if (progress < 0) progress = 0;
            if (progress > 1) progress = 1;

            // Invert the progress since we're using bottom-up.
            progress = 1 - progress;

            const transform = `translateY(${progress * volumeScrubberElement.clientHeight}px)`;
            volumeScrubberThumbIndicatorElement.style.transform = transform;
            volumeScrubberThumbTargetElement.style.transform = transform;

            if (volumeScrubberTrackProgressElement !== null) {
                volumeScrubberTrackProgressElement.style.transform = `scaleY(${1 - progress})`;
            }
        };

        const volumeLocalStorageKey = "cyberworlds/media/volume";
        const previousVolumeLocalStorageKey = "cyberworlds/media/volume-previous";
        const getLocalStorageVolume = (type: "current" | "previous" = "current") => {
            const volume = localStorage.getItem(
                type === "current" ? volumeLocalStorageKey : previousVolumeLocalStorageKey,
            );
            if (volume === null) {
                return 1;
            }

            const parsedVolume = parseFloat(volume);
            if (isNaN(parsedVolume)) {
                return 1;
            }

            return clamp(0, parsedVolume, 1);
        };

        const setLocalStorageVolume = (volume: number) => {
            const previousVolume = getLocalStorageVolume();
            localStorage.setItem(volumeLocalStorageKey, String(volume));

            // If the volume is 0 then we don't want to store it as the previous volume.
            if (previousVolume > 0) {
                localStorage.setItem(previousVolumeLocalStorageKey, String(previousVolume));
            }
        };

        {
            const volumeClassNameOrder: [
                PlayerControlsStylesString,
                PlayerControlsStylesString,
                PlayerControlsStylesString,
                PlayerControlsStylesString,
            ] = [
                "volumeMutedClassName",
                "volumeLowClassName",
                "volumeMediumClassName",
                "volumeHighClassName",
            ];

            const getIconClassName = (volume: number): PlayerControlsStylesString => {
                if (volume === 0) {
                    return volumeClassNameOrder[0];
                } else if (volume < 0.33) {
                    return volumeClassNameOrder[1];
                } else if (volume < 0.66) {
                    return volumeClassNameOrder[2];
                } else {
                    return volumeClassNameOrder[3];
                }
            };

            const switchVolumeIcon = (className: PlayerControlsStylesString) => {
                // if we already have the class name then don't do anything
                if (
                    containerElement.classList.contains(
                        contentFileVideoAndAudioPlayerControlsStyles[className],
                    )
                ) {
                    return;
                }

                // Add the new class name
                containerElement.classList.add(
                    contentFileVideoAndAudioPlayerControlsStyles[className],
                );

                // Remove all other volume class names
                for (const otherClassName of volumeClassNameOrder.filter(
                    otherClassName => otherClassName !== className,
                )) {
                    containerElement.classList.remove(
                        contentFileVideoAndAudioPlayerControlsStyles[otherClassName],
                    );
                }
            };

            const handleVolumeChange = () => {
                if (mediaElement === null) return;
                switchVolumeIcon(getIconClassName(mediaElement.volume));
                updateVolumeScrubberProgress(mediaElement.volume);
                setLocalStorageVolume(mediaElement.volume);
            };

            if (mediaElement !== null) {
                const previousVolume = getLocalStorageVolume();
                mediaElement.addEventListener("volumechange", handleVolumeChange);
                mediaElement.volume = previousVolume;

                // Call the first time to make sure the icon is set correctly.
                handleVolumeChange();

                cleanupFunctions.push(() => {
                    mediaElement.removeEventListener("volumechange", handleVolumeChange);
                });
            }
        }

        /* ========================================================================== *\
         *                       Volume scrubber drag events                          *
        \* ========================================================================== */

        // Note: this is largely duplicated from the timing scrubber drag events above. We
        // should probably refactor this into a shared function the next time we need to use it.

        if (mediaElement !== null) {
            const handleVolumeScrubberPointerDown = (event: PointerEvent) => {
                // Ignore presses on our volumeScrubber thumb. That'll initiate a drag.
                if (
                    event.target instanceof Node &&
                    volumeScrubberThumbTargetElement.contains(event.target)
                ) {
                    return;
                }

                event.preventDefault();

                const volumeScrubberRect = volumeScrubberElement.getBoundingClientRect();

                const progress = clamp(
                    0,
                    1 - (event.clientY - volumeScrubberRect.top) / volumeScrubberRect.height,
                    1,
                );

                mediaElement.volume = progress;
            };

            volumeScrubberElement.addEventListener("pointerdown", handleVolumeScrubberPointerDown);

            cleanupFunctions.push(() => {
                volumeScrubberElement.removeEventListener(
                    "pointerdown",
                    handleVolumeScrubberPointerDown,
                );
            });
        }

        let volumeScrubberThumbDragState: {
            coverElement: HTMLDivElement;
        } | null = null;

        if (mediaElement !== null) {
            const startVolumeScrubberThumbDrag = (event: PointerEvent) => {
                event.preventDefault();

                const dragCoverElement = document.createElement("div");

                dragCoverElement.className = sprinkles({
                    position: "absolute",
                    inset: "0",
                    zIndex: "70",
                    cursor: "grabbing",
                });

                volumeScrubberThumbDragState = {
                    coverElement: dragCoverElement,
                };
                maybeUpdateVolumeSelector();

                containerElement.classList.add(
                    contentFileVideoAndAudioPlayerControlsStyles.draggingVolumeScrubberThumbClassName,
                );
                document.body.appendChild(dragCoverElement);
                document.addEventListener("pointerup", handleVolumeDocumentPointerUp);
                document.addEventListener("pointermove", handleVolumeDocumentPointerMove);
            };

            const cancelVolumeScrubberThumbDrag = () => {
                if (!volumeScrubberThumbDragState) return;

                containerElement.classList.remove(
                    contentFileVideoAndAudioPlayerControlsStyles.draggingVolumeScrubberThumbClassName,
                );
                document.body.removeChild(volumeScrubberThumbDragState.coverElement);
                document.removeEventListener("pointerup", handleVolumeDocumentPointerUp);
                document.removeEventListener("pointermove", handleVolumeDocumentPointerMove);

                volumeScrubberThumbDragState = null;
                maybeUpdateVolumeSelector();
            };

            const handleVolumeDocumentPointerUp = () => {
                cancelVolumeScrubberThumbDrag();
            };

            const handleVolumeSelectorHover = () => {
                // Since the element has no width on render, we can't calculate the width,
                // and therefore the progress, of the scrubber. So we need to set the volume
                // to the current volume on when we hover.
                updateVolumeScrubberProgress(mediaElement.volume);
            };

            const handleVolumeDocumentPointerMove = (event: PointerEvent) => {
                if (!volumeScrubberThumbDragState) return;

                const volumeScrubberRect = volumeScrubberElement.getBoundingClientRect();

                const progress = clamp(
                    0,
                    1 - (event.clientY - volumeScrubberRect.top) / volumeScrubberRect.height,
                    1,
                );

                mediaElement.volume = progress;
            };

            volumeButtonElement.addEventListener("mouseenter", handleVolumeSelectorHover);
            volumeScrubberThumbTargetElement.addEventListener(
                "pointerdown",
                startVolumeScrubberThumbDrag,
            );

            cleanupFunctions.push(() => {
                volumeButtonElement.removeEventListener("mouseenter", handleVolumeSelectorHover);
                volumeScrubberThumbTargetElement.removeEventListener(
                    "pointerdown",
                    startVolumeScrubberThumbDrag,
                );
            });
        }

        let isVolumeButtonHovered = false;
        let isVolumeSelectorHovered = false;
        let volumeSelectorShowTimeout: Timeout | null = null;
        let volumeSelectorHideTimeout: Timeout | null = null;

        cleanupFunctions.push(
            addUnfocusableButtonBehaviorToElement(volumeButtonElement, {
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
                    if (mediaElement === null) return;

                    if (mediaElement.volume === 0) {
                        mediaElement.volume = getLocalStorageVolume("previous");
                    } else {
                        mediaElement.volume = 0;
                    }
                },
                onHoverStart: () => {
                    isVolumeButtonHovered = true;
                    maybeUpdateVolumeSelector();
                },
                onHoverEnd: () => {
                    isVolumeButtonHovered = false;
                    maybeUpdateVolumeSelector();
                },
            }),
        );

        const handleVolumeSelectorPointerEnter = () => {
            isVolumeSelectorHovered = true;
            maybeUpdateVolumeSelector();
        };

        const handleVolumeSelectorPointerLeave = () => {
            isVolumeSelectorHovered = false;
            maybeUpdateVolumeSelector();
        };

        const maybeUpdateVolumeSelector = () => {
            if (!volumeSelectorElement) return;

            const isVisible = volumeSelectorElement.classList.contains(
                contentFileVideoAndAudioPlayerControlsStyles.volumeSelectorVisibleClassName,
            );

            const shouldBeVisible: boolean =
                isVolumeButtonHovered || isVolumeSelectorHovered || !!volumeScrubberThumbDragState;

            if (shouldBeVisible) {
                volumeSelectorHideTimeout?.clear();
                volumeSelectorHideTimeout = null;

                if (!isVisible && !volumeSelectorShowTimeout) {
                    volumeSelectorShowTimeout = createTimeout(() => {
                        volumeSelectorShowTimeout = null;
                        volumeSelectorElement.classList.add(
                            contentFileVideoAndAudioPlayerControlsStyles.volumeSelectorVisibleClassName,
                        );
                    }, tooltipDelayMs);
                }
            } else {
                volumeSelectorShowTimeout?.clear();
                volumeSelectorShowTimeout = null;

                if (isVisible && !volumeSelectorHideTimeout) {
                    volumeSelectorHideTimeout = createTimeout(() => {
                        volumeSelectorHideTimeout = null;
                        volumeSelectorElement.classList.remove(
                            contentFileVideoAndAudioPlayerControlsStyles.volumeSelectorVisibleClassName,
                        );
                        volumeSelectorElement.classList.add(
                            contentFileVideoAndAudioPlayerControlsStyles.volumeSelectorWasVisibleClassName,
                        );
                    }, tooltipDelayMs);
                }
            }
        };

        volumeSelectorElement?.addEventListener("pointerenter", handleVolumeSelectorPointerEnter);
        volumeSelectorElement?.addEventListener("pointerleave", handleVolumeSelectorPointerLeave);

        cleanupFunctions.push(() => {
            volumeSelectorElement?.removeEventListener(
                "pointerenter",
                handleVolumeSelectorPointerEnter,
            );
            volumeSelectorElement?.removeEventListener(
                "pointerleave",
                handleVolumeSelectorPointerLeave,
            );

            if (volumeSelectorShowTimeout) {
                volumeSelectorShowTimeout.clear();
                volumeSelectorShowTimeout = null;
                volumeSelectorElement?.classList.add(
                    contentFileVideoAndAudioPlayerControlsStyles.volumeSelectorVisibleClassName,
                );
            }

            if (volumeSelectorHideTimeout) {
                volumeSelectorHideTimeout.clear();
                volumeSelectorHideTimeout = null;
                volumeSelectorElement?.classList.remove(
                    contentFileVideoAndAudioPlayerControlsStyles.volumeSelectorVisibleClassName,
                );
                volumeSelectorElement?.classList.add(
                    contentFileVideoAndAudioPlayerControlsStyles.volumeSelectorWasVisibleClassName,
                );
            }
        });
    }

    /* ========================================================================== *\
     *                               Playback rate                                *
    \* ========================================================================== */

    {
        const handleRateChange = () => {
            playbackRateButtonElement.setAttribute(
                "data-rate",
                `${mediaElement?.playbackRate ?? 1}x`,
            );
        };

        handleRateChange();

        if (mediaElement !== null) {
            mediaElement.addEventListener("ratechange", handleRateChange);

            cleanupFunctions.push(() => {
                mediaElement.removeEventListener("ratechange", handleRateChange);
            });
        }
    }

    return {
        togglePlay,
        cleanup: () => {
            for (const cleanup of cleanupFunctions) {
                cleanup();
            }
        },
    };
}

export function formatContentFileVideoAndAudioPlayerDurationString(
    durationMs: number,
    totalDurationMs: number,
): string {
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
