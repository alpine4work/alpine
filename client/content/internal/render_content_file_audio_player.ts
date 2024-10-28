import classNames from "classnames";
import {
    addContentFileVideoAndAudioPlayerControlsBehavior,
    renderContentFileVideoAndAudioPlayerControls,
} from "~/client/content/internal/render_content_file_video_and_audio_player_controls.js";
import {Reporter} from "~/client/design/reporter.js";
import {createSvgHtmlGenerator} from "~/client/icons/create_svg_html_generator.js";
import {waveformIconSvg} from "~/client/icons/waveform_icon_svg.js";
import {contentFileAudioPlayerStyles} from "~/client/styles/styles.js";
import {FileAudioPreview} from "~/shared/files/file_preview.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {
    HtmlContainerGenerator,
    HtmlElementGenerator,
    HtmlTextGenerator,
} from "~/shared/helpers/html/html_generator.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {clamp} from "~/shared/helpers/number/clamp.js";

// NOTE(calebmer, 2024-10-28): All of the audio visualization code in this file
// is based off of some [old code I wrote for a podcast recording app][1].
//
// [1]: https://github.com/calebmer/decode-universe/blob/4ff83071116d17c79cd39cff07eca233fbf8a02a/studio/core/audio/AudioVisualization.tsx#L68-L76
const {
    fftSize: contentFileAudioPlayerVisualizationFftSize,
    viewboxHeight: contentFileAudioPlayerVisualizationSvgViewboxHeight,
    barWidth: contentFileAudioPlayerVisualizationSvgBarWidth,
    svg: contentFileAudioPlayerVisualizationSvg,
} = (() => {
    const fftSize = 128;
    const viewboxWidth = 600;
    const viewboxHeight = 100;

    // Cut off the last x% of bars as it seems that in practice they rarely
    // have data.
    const barCount = Math.round((fftSize / 2) * 0.7);

    const barWidth = viewboxWidth / (barCount * 2 - 1);

    return {
        fftSize,
        viewboxHeight,
        barWidth: round3(barWidth),
        svg: `\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewboxWidth} ${viewboxHeight}">\
${createArrayWithLength(barCount, index => {
    const size = round3(barWidth);
    const x = round3(barWidth * index * 2);
    const y = round3(viewboxHeight / 2 - size / 2);
    const radius = round3(barWidth / 2);

    return `<rect width="${size}" height="${size}" x="${x}" y="${y}" rx="${radius}" ry="${radius}" />`;
}).join("")}\
</svg>`,
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
        filePreview,
        audioSrc,
        isInitialAppRender,
        layout,
    }: {
        filePreview: FileAudioPreview & {isProcessing: false};
        audioSrc: string;
        isInitialAppRender: boolean;
        layout: {width: number; height: number};
    },
) {
    const audioHtml = new HtmlElementGenerator("audio");
    containerHtml.appendChild(audioHtml);
    audioHtml.setAttribute("preload", "none");
    audioHtml.setAttribute("style", "pointer-events: none; width: 0; height: 0; opacity: 0");
    audioHtml.setAttribute("src", audioSrc);

    const withoutControls = layout.width < 250;
    const withoutVisualization = layout.width < 350;

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
    }

    {
        const metadataHtml = new HtmlElementGenerator("div");
        containerHtml.appendChild(metadataHtml);
        metadataHtml.setAttribute(
            "class",
            classNames(
                contentFileAudioPlayerStyles.metadataClassName,
                withoutVisualization &&
                    contentFileAudioPlayerStyles.metadataWithoutVisualizationClassName,
            ),
        );

        if (withoutVisualization) {
            metadataHtml.appendChild(
                createSvgHtmlGenerator(
                    waveformIconSvg({
                        className: contentFileAudioPlayerStyles.metadataIconClassName,
                    }),
                ),
            );
        }

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
    audioAnalyserByteFrequencyData: Uint8Array;
};

/**
 * Add interactions to the content file audio player rendered by
 * `renderContentFileAudioPlayer()`. The provided container element must have
 * the class `contentFileAudioPlayerStyles.containerClassName`.
 *
 * IMPORTANT: Read the following implementation notes before making changes.
 *
 * ## Implementation notes
 *
 * The code for our audio player is styled after React. We have a functional
 * render function (`renderContentFileAudioPlayer()`) and setup interactivity
 * with an effect (`addContentFileAudioPlayerBehavior()`). We'd love to use
 * React directly but we can't because our audio player is rendered in a
 * ProseMirror `contenteditable`. So we need to build the audio player's
 * interactivity by directly attaching DOM events.
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
        isInitialAppRender,
        getReporter,
    }: {
        filePreview: FileAudioPreview & {isProcessing: false};
        isInitialAppRender: boolean;
        getReporter: () => Reporter;
    },
) {
    assert(containerElement.classList.contains(contentFileAudioPlayerStyles.containerClassName));

    const audioElement = assertExists(containerElement.getElementsByTagName("audio")[0]);

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
    }

    /* ========================================================================== *\
     *                            Audio visualization                             *
    \* ========================================================================== */

    let handlePlay;
    let handlePlayAnimationFrame;
    let handleSeek;

    if (visualizationSvgElement !== null) {
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

    let cleanupControls: () => void;
    if (controlsContainerElement === null) {
        cleanupControls = noop;
    } else {
        ({cleanup: cleanupControls} = addContentFileVideoAndAudioPlayerControlsBehavior({
            durationMs: filePreview.duration,
            containerElement,
            mediaElement: audioElement,
            isInitialAppRender,
            getReporter,
            onPlay: handlePlay,
            onSeek: handleSeek,
            onPlayAnimationFrame: handlePlayAnimationFrame,
        }));
    }

    return {
        onPress: () => {
            if (!audioElement.paused) {
                audioElement.pause();
            }
        },
        cleanup: () => {
            cleanupControls();

            for (const cleanup of cleanupFunctions) {
                cleanup();
            }
        },
    };
}
