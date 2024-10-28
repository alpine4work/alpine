import {
    addContentFileVideoAndAudioPlayerControlsBehavior,
    renderContentFileVideoAndAudioPlayerControls,
} from "~/client/content/internal/render_content_file_video_and_audio_player_controls.js";
import {Reporter} from "~/client/design/reporter.js";
import {contentFileAudioPlayerStyles} from "~/client/styles/styles.js";
import {FileAudioPreview} from "~/shared/files/file_preview.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {
    HtmlContainerGenerator,
    HtmlElementGenerator,
    HtmlTextGenerator,
} from "~/shared/helpers/html/html_generator.js";

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
    }: {
        filePreview: FileAudioPreview & {isProcessing: false};
        audioSrc: string;
        isInitialAppRender: boolean;
    },
) {
    const audioHtml = new HtmlElementGenerator("audio");
    containerHtml.appendChild(audioHtml);
    audioHtml.setAttribute("preload", "none");
    audioHtml.setAttribute("style", "pointer-events: none; width: 0; height: 0; opacity: 0");
    audioHtml.setAttribute("src", audioSrc);

    {
        const visualizationHtml = new HtmlElementGenerator("div");
        containerHtml.appendChild(visualizationHtml);
        visualizationHtml.setAttribute(
            "class",
            contentFileAudioPlayerStyles.visualizationClassName,
        );
    }

    {
        const metadataHtml = new HtmlElementGenerator("div");
        containerHtml.appendChild(metadataHtml);
        metadataHtml.setAttribute("class", contentFileAudioPlayerStyles.metadataClassName);

        {
            const metadataTitleHtml = new HtmlElementGenerator("div");
            metadataHtml.appendChild(metadataTitleHtml);
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
            metadataHtml.appendChild(metadataArtistHtml);
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

    {
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

    const controlsContainerElement = assertExists(
        containerElement.getElementsByClassName(
            contentFileAudioPlayerStyles.controlsContainerClassName,
        )[0],
    ) as HTMLDivElement;

    const cleanupFunctions: Array<() => void> = [];

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

    const {cleanup: cleanupControls} = addContentFileVideoAndAudioPlayerControlsBehavior({
        durationMs: filePreview.duration,
        containerElement,
        mediaElement: audioElement,
        isInitialAppRender,
        getReporter,
    });

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
