import prettyBytes from "pretty-bytes";
import {FileModelRegistryData} from "~/client/web/content/file_registry.js";
import {
    addContentFileVideoAndAudioPlayerControlsBehavior,
    renderContentFileVideoAndAudioPlayerControls,
} from "~/client/web/content/internal/content_file_video_and_audio_player_controls.js";
import {Reporter} from "~/client/web/design/reporter.js";
import {createSvgHtmlGenerator} from "~/client/web/icons/create_svg_html_generator.js";
import {fileAudioIconSvg} from "~/client/web/icons/file_audio_icon_svg.js";
import {spinnerGapIconSvg} from "~/client/web/icons/spinner_gap_icon_svg.js";
import {
    contentFileAudioPlayerStyles,
    spinAnimationClassName,
    sprinkles,
} from "~/client/web/styles/styles.js";
import {Platform} from "~/shared/design/core/platform.js";
import {FileAudioPreview} from "~/shared/files/file_preview.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {
    HtmlContainerGenerator,
    HtmlElementGenerator,
    HtmlTextGenerator,
} from "~/shared/helpers/html/html_generator.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {clamp} from "~/shared/helpers/number/clamp.js";

// NOTE(calebmer, 2024-10-28): All of the audio visualization code in this file is
// based off of some [old code I wrote for a podcast recording app][1].
//
// [1]:
//     https://github.com/calebmer/decode-universe/blob/4ff83071116d17c79cd39cff07eca233fbf8a02a/studio/core/audio/AudioVisualization.tsx#L68-L76
const {
    fftSize: contentFileAudioPlayerVisualizationFftSize,
    viewboxHeight: contentFileAudioPlayerVisualizationSvgViewboxHeight,
    barWidth: contentFileAudioPlayerVisualizationSvgBarWidth,
    minBarHeight: contentFileAudioPlayerVisualizationSvgMinBarHeight,
    svg: contentFileAudioPlayerVisualizationSvg,
} = (() => {
    const fftSize = 256;
    const viewboxWidth = 600;
    const viewboxHeight = 50;

    // Cut off the last x% of bars as it seems that in practice they rarely have data.
    const barCount = Math.round((fftSize / 2) * 0.65);

    const gapWidthRatio = 1.5;
    const barWidth = viewboxWidth / (barCount + (barCount - 1) * gapWidthRatio);
    const minBarHeight = barWidth * 2.5;

    return {
        fftSize,
        viewboxHeight,
        barWidth: round3(barWidth),
        minBarHeight: round3(minBarHeight),
        /* eslint-disable cyberworlds/string-quotes */

        // We add 1 around the viewbox since we were sometimes getting rendering artifacts
        // in Chrome near the edge of the viewbox during an animation. Adding the padding
        // seems to fix it.
        svg: `\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${viewboxWidth + 1} ${viewboxHeight + 1}">\
${createArrayWithLength(barCount, index => {
    const width = round3(barWidth);
    const height = round3(minBarHeight);
    const x = round3(barWidth * index + barWidth * gapWidthRatio * index);
    const y = round3(viewboxHeight / 2 - height / 2);
    const radius = round3(barWidth / 2);

    return `<rect width="${width}" height="${height}" x="${x}" y="${y}" rx="${radius}" ry="${radius}" />`;
}).join("")}\
</svg>`,

        /* eslint-enable cyberworlds/string-quotes */
    };
})();

function round3(n: number) {
    return Math.round(n * 10 ** 3) / 10 ** 3;
}

/**
 * Render the elements needed for a content audio player. You must also use
 * `addContentFileAudioPlayerBehavior()` to add event listeners for the content
 * audio player. See that function's documentation for more information.
 *
 * The provided container HTML must have the class
 * `contentFileAudioPlayer.containerClassName`. We will append to the container
 * element.
 */
export function renderContentFileAudioPlayer(
    containerHtml: HtmlContainerGenerator,
    {
        file,
        filePreview,
        audioSrc,
        platform,
        isInitialAppRender,
        withoutInteractivity,
        layout,
    }: {
        file: FileModelRegistryData;
        filePreview: FileAudioPreview & {isProcessing: false; ok: true};
        audioSrc: string;
        platform: Platform;
        isInitialAppRender: boolean;
        withoutInteractivity: boolean;
        layout: {width: number; height: number} | null;
    },
) {
    const withoutControls =
        withoutInteractivity || platform === "mobile" || (layout !== null && layout.width < 250);
    const withoutVisualization =
        withoutInteractivity ||
        platform === "mobile" ||
        (layout !== null &&
            (layout.width < 350 ||
                // 185 was selected instead of 200 to make sure we show the visualization when
                // rendering in a peek.
                layout.height < 185));

    if (!withoutControls) {
        const audioHtml = new HtmlElementGenerator("audio");
        containerHtml.appendChild(audioHtml);
        audioHtml.setAttribute("preload", "none");
        audioHtml.setAttribute("style", "pointer-events: none; width: 0; height: 0; opacity: 0");

        // Needed to get a proper CORS response from the resource service where our files
        // are hosted. This _must_ be set before setting the `src` attribute.
        audioHtml.setAttribute("crossorigin", "anonymous");

        audioHtml.setAttribute("src", audioSrc);
    }

    if (!withoutControls && !withoutVisualization) {
        const visualizationHtml = new HtmlElementGenerator("div");
        containerHtml.appendChild(visualizationHtml);
        visualizationHtml.setAttribute(
            "class",
            contentFileAudioPlayerStyles.visualizationClassName,
        );

        visualizationHtml.appendChild(
            createSvgHtmlGenerator(contentFileAudioPlayerVisualizationSvg),
        );

        {
            const loadingIndicatorHtml = new HtmlElementGenerator("div");
            visualizationHtml.appendChild(loadingIndicatorHtml);
            loadingIndicatorHtml.setAttribute(
                "class",
                contentFileAudioPlayerStyles.loadingIndicatorClassName,
            );

            loadingIndicatorHtml.appendChild(
                createSvgHtmlGenerator(spinnerGapIconSvg({className: spinAnimationClassName})),
            );
        }
    }

    if (!withoutVisualization) {
        const metadataHtml = new HtmlElementGenerator("div");
        containerHtml.appendChild(metadataHtml);
        metadataHtml.setAttribute("class", contentFileAudioPlayerStyles.metadataClassName);

        {
            const metadataContentHtml = new HtmlElementGenerator("div");
            metadataHtml.appendChild(metadataContentHtml);
            metadataContentHtml.setAttribute(
                "class",
                contentFileAudioPlayerStyles.metadataContentClassName,
            );

            {
                const metadataTitleHtml = new HtmlElementGenerator("div");
                metadataContentHtml.appendChild(metadataTitleHtml);
                metadataTitleHtml.setAttribute(
                    "class",
                    contentFileAudioPlayerStyles.metadataTitleClassName,
                );
                metadataTitleHtml.appendChild(
                    new HtmlTextGenerator(
                        filePreview.metadata?.title && filePreview.metadata.title.length > 0
                            ? filePreview.metadata.title
                            : "Untitled",
                    ),
                );
            }

            const hasArtistMetadata =
                filePreview.metadata?.artist && filePreview.metadata.artist.length > 0;
            const hasAlbumMetadata =
                filePreview.metadata?.album && filePreview.metadata.album.length > 0;

            if (hasArtistMetadata || hasAlbumMetadata) {
                const metadataArtistHtml = new HtmlElementGenerator("div");
                metadataContentHtml.appendChild(metadataArtistHtml);
                metadataArtistHtml.setAttribute(
                    "class",
                    contentFileAudioPlayerStyles.metadataArtistClassName,
                );

                if (hasArtistMetadata) {
                    if (hasAlbumMetadata) {
                        metadataArtistHtml.appendChild(
                            new HtmlTextGenerator(
                                `${filePreview.metadata.artist} (${filePreview.metadata.album})`,
                            ),
                        );
                    } else {
                        metadataArtistHtml.appendChild(
                            new HtmlTextGenerator(filePreview.metadata.artist),
                        );
                    }
                } else {
                    metadataArtistHtml.appendChild(
                        new HtmlTextGenerator(filePreview.metadata?.album ?? ""),
                    );
                }
            }
        }
    } else {
        const metadataHtml = new HtmlElementGenerator("div");
        containerHtml.appendChild(metadataHtml);

        metadataHtml.setAttribute(
            "class",
            sprinkles({
                flexGrow: "1",
                // Slightly push our metadata off center. This ends up optically centering our
                // content which is bottom heavy.
                paddingTop: withoutControls ? "2" : "4",
                paddingX: layout !== null && layout.width < 175 ? "6" : "12",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                gap: "1.5",
                color: "grey-40",
                fontSize: layout !== null && layout.width < 175 ? "25" : "50",
            }),
        );

        metadataHtml.appendChild(
            createSvgHtmlGenerator(
                fileAudioIconSvg({
                    weight: "light",
                    className: sprinkles({
                        color: "grey-30",
                        width: "7",
                        height: "7",
                    }),
                }),
            ),
        );

        const metadataContentHtml = new HtmlElementGenerator("div");
        metadataHtml.appendChild(metadataContentHtml);
        metadataContentHtml.setAttribute("class", sprinkles({textAlign: "center"}));

        const metadataTitleHtml = new HtmlElementGenerator("div");
        metadataContentHtml.appendChild(metadataTitleHtml);
        metadataTitleHtml.setAttribute(
            "class",
            sprinkles({
                paddingBottom: "0.5",
                fontSize: layout !== null && layout.width < 150 ? "50" : "75",
                fontStyle: "semi-bold",
                color: "grey-50",
            }),
        );
        metadataTitleHtml.appendChild(
            new HtmlTextGenerator(
                filePreview.metadata?.title && filePreview.metadata.title.length > 0
                    ? filePreview.metadata.title
                    : "Untitled",
            ),
        );

        const metadataArtistHtml = new HtmlElementGenerator("div");
        metadataContentHtml.appendChild(metadataArtistHtml);

        // Truncate after 3 lines of text. Unofficial syntax that works in all browsers
        // except IE.
        // https://stackoverflow.com/questions/3922739/limit-text-length-to-n-lines-using-css
        metadataArtistHtml.setAttribute(
            "style",
            [
                "display: -webkit-box",
                "-webkit-line-clamp: 2",
                "line-clamp: 2",
                "-webkit-box-orient: vertical",
                "text-overflow: ellipsis",
                "overflow: hidden",
            ].join("; "),
        );

        const hasArtistMetadata =
            filePreview.metadata?.artist && filePreview.metadata.artist.length > 0;
        const hasAlbumMetadata =
            filePreview.metadata?.album && filePreview.metadata.album.length > 0;

        if (!hasArtistMetadata && !hasAlbumMetadata) {
            metadataArtistHtml.appendChild(new HtmlTextGenerator(prettyBytes(file.contentLength)));
        } else {
            if (hasArtistMetadata) {
                if (hasAlbumMetadata) {
                    metadataArtistHtml.appendChild(
                        new HtmlTextGenerator(
                            `${filePreview.metadata.artist} (${filePreview.metadata.album})`,
                        ),
                    );
                } else {
                    metadataArtistHtml.appendChild(
                        new HtmlTextGenerator(filePreview.metadata.artist),
                    );
                }
            } else {
                metadataArtistHtml.appendChild(
                    new HtmlTextGenerator(filePreview.metadata?.album ?? ""),
                );
            }
        }
    }

    if (!withoutControls) {
        const controlsContainerHtml = new HtmlElementGenerator("div");
        containerHtml.appendChild(controlsContainerHtml);
        controlsContainerHtml.setAttribute(
            "class",
            contentFileAudioPlayerStyles.controlsContainerClassName,
        );

        const controlsHtml = renderContentFileVideoAndAudioPlayerControls({
            durationMs: filePreview.duration,
            isInitialAppRender,
            platform,
        });
        controlsContainerHtml.appendChild(controlsHtml);
    }
}

let contentFileAudioVisualizationStateByElement: WeakMap<
    HTMLAudioElement,
    ContentFileAudioVisualizationState
> | null = null;

type ContentFileAudioVisualizationState = {
    audioContext: AudioContext;
    audioSourceNode: MediaElementAudioSourceNode;
    audioAnalyserNode: AnalyserNode;
    audioAnalyserByteFrequencyData: Uint8Array<ArrayBuffer>;
};

/**
 * Add interactions to the content file audio player rendered by
 * `renderContentFileAudioPlayer()`. The provided container element must have the
 * class `contentFileAudioPlayerStyles.containerClassName`.
 *
 * IMPORTANT: Read the following implementation notes before making changes.
 *
 * ## Implementation notes
 *
 * The code for our audio player is styled after React. We have a functional render
 * function (`renderContentFileAudioPlayer()`) and setup interactivity with an
 * effect (`addContentFileAudioPlayerBehavior()`). We'd love to use React directly
 * but we can't because our audio player is rendered in a ProseMirror
 * `contenteditable`. So we need to build the audio player's interactivity by
 * directly attaching DOM events.
 *
 * Our behavior function MUST NOT edit the DOM by adding or removing DOM nodes.
 * This will mess up `HtmlElementGenerator.patchNode()` if ProseMirror needs to
 * re-render our audio player. Instead you may only add/remove classes and
 * attributes that `renderContentFileAudioPlayer()` doesn't know about. Since
 * `HtmlElementGenerator.patchNode()` leaves these alone.
 */
export function addContentFileAudioPlayerBehavior(
    containerElement: Element,
    {
        filePreview,
        getReporter,
        onOpenViewer,
    }: {
        filePreview: FileAudioPreview & {isProcessing: false; ok: true};
        getReporter: () => Reporter;
        onOpenViewer?: () => void;
    },
) {
    assert(containerElement.classList.contains(contentFileAudioPlayerStyles.containerClassName));

    const audioElement = containerElement.getElementsByTagName("audio")[0] ?? null;

    const controlsContainerElement = (containerElement.getElementsByClassName(
        contentFileAudioPlayerStyles.controlsContainerClassName,
    )[0] ?? null) as HTMLDivElement | null;

    const visualizationSvgElement = containerElement.getElementsByTagName("svg")[0] ?? null;

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
            // This pointer event is on the control container element instead of the control
            // element so we disable clicking in the margins below and to the left/right area
            // as well. Having your cursor change between pointer and default when moving
            // through that space feels janky so we disable pointer events there.
            event.preventDefault();
        };

        const handleControlsContainerClick = (event: MouseEvent) => {
            // When clicking on the control bar prevent default so we don't perform the default
            // click logic (don't pause/play).
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
    }

    /* ========================================================================== *\
     *                            Audio visualization                             *
    \* ========================================================================== */

    let handlePlay;
    let handlePlayAnimationFrame;
    let handleSeek;

    if (audioElement !== null && visualizationSvgElement !== null) {
        let visualizationState: ContentFileAudioVisualizationState | undefined;

        handlePlay = () => {
            contentFileAudioVisualizationStateByElement ??= new WeakMap();

            visualizationState = getOrSetDefaultMapValue(
                contentFileAudioVisualizationStateByElement,
                audioElement,
                () => {
                    const audioContext = new AudioContext();

                    const audioSourceNode = audioContext.createMediaElementSource(audioElement);

                    const audioAnalyserNode = audioContext.createAnalyser();
                    audioAnalyserNode.smoothingTimeConstant = 0.6;
                    audioAnalyserNode.fftSize = contentFileAudioPlayerVisualizationFftSize;

                    audioSourceNode.connect(audioAnalyserNode);
                    audioSourceNode.connect(audioContext.destination);

                    const audioAnalyserByteFrequencyData = new Uint8Array(
                        audioAnalyserNode.frequencyBinCount,
                    );

                    return {
                        audioContext,
                        audioSourceNode,
                        audioAnalyserNode,
                        audioAnalyserByteFrequencyData,
                    };
                },
            );
        };

        handlePlayAnimationFrame = () => {
            visualizationState ??= contentFileAudioVisualizationStateByElement?.get(audioElement);
            if (visualizationState === undefined) return;

            const {audioAnalyserNode, audioAnalyserByteFrequencyData} = visualizationState;

            audioAnalyserNode.getByteFrequencyData(audioAnalyserByteFrequencyData);

            for (let i = 0; i < audioAnalyserByteFrequencyData.length; i++) {
                const byteFrequency = audioAnalyserByteFrequencyData[i]!;
                const barElement = visualizationSvgElement.childNodes[i] as
                    | SVGRectElement
                    | undefined;
                if (barElement === undefined) break;

                const bytePercent = byteFrequency / 255;

                const barHeight = clamp(
                    contentFileAudioPlayerVisualizationSvgMinBarHeight,
                    bytePercent * contentFileAudioPlayerVisualizationSvgViewboxHeight,
                    contentFileAudioPlayerVisualizationSvgViewboxHeight,
                );

                barElement.setAttribute("height", String(barHeight));
                barElement.setAttribute(
                    "y",
                    String(contentFileAudioPlayerVisualizationSvgViewboxHeight / 2 - barHeight / 2),
                );
            }
        };

        handleSeek = () => {
            if (!audioElement.paused) return;

            visualizationState ??= contentFileAudioVisualizationStateByElement?.get(audioElement);
            if (visualizationState === undefined) return;

            const {audioAnalyserByteFrequencyData} = visualizationState;

            for (let i = 0; i < audioAnalyserByteFrequencyData.length; i++) {
                const byteFrequency = 0;
                const barElement = visualizationSvgElement.childNodes[i] as
                    | SVGRectElement
                    | undefined;
                if (barElement === undefined) break;

                const bytePercent = byteFrequency / 255;

                const barHeight = clamp(
                    contentFileAudioPlayerVisualizationSvgBarWidth,
                    bytePercent * contentFileAudioPlayerVisualizationSvgViewboxHeight,
                    contentFileAudioPlayerVisualizationSvgViewboxHeight,
                );

                barElement.setAttribute("height", String(barHeight));
                barElement.setAttribute(
                    "y",
                    String(contentFileAudioPlayerVisualizationSvgViewboxHeight / 2 - barHeight / 2),
                );
            }
        };
    }

    /* ========================================================================== *\
     *                              Shared behavior                               *
    \* ========================================================================== */

    let togglePlay: () => void;
    let cleanupControls: () => void;
    if (controlsContainerElement === null) {
        togglePlay = noop;
        cleanupControls = noop;
    } else {
        ({togglePlay, cleanup: cleanupControls} = addContentFileVideoAndAudioPlayerControlsBehavior(
            {
                durationMs: filePreview.duration,
                containerElement,
                mediaElement: audioElement,
                getReporter,
                onPlay: handlePlay,
                onSeek: handleSeek,
                onPlayAnimationFrame: handlePlayAnimationFrame,
                onOpenViewer,
            },
        ));
    }

    return {
        onPress: () => {
            if (!audioElement) return;

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
