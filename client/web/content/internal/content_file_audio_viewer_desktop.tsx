import classNames from "classnames";
import {SpinnerGap} from "phosphor-react";
import {useMemo, useRef} from "react";
import {FileModelRegistryData} from "~/client/web/content/file_registry.js";
import {
    addContentFileAudioPlayerBehavior,
    renderContentFileAudioPlayer,
} from "~/client/web/content/internal/content_file_audio_player.js";
import {ContentFileProcessorError} from "~/client/web/content/internal/content_file_processor_error.js";
import {
    contentFileViewerDesktopMarginX,
    contentFileViewerLargeProcessingIndicatorColor,
    contentFileViewerLargeProcessingIndicatorFontSize,
    contentFileViewerLargeProcessingIndicatorGap,
    contentFileViewerLargeProcessingIndicatorIconSize,
    contentFileViewerLargeProcessingIndicatorWeight,
} from "~/client/web/content/internal/content_file_viewer_shared_styles.js";
import {getContentFileViewerSrc} from "~/client/web/content/internal/load_content_file_viewer_data.js";
import {Box} from "~/client/web/design/box.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useIsInitialAppRender} from "~/client/web/helpers/lifecycle/initial_app_render.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {
    contentFileAudioPlayerStyles,
    contentFileVideoAndAudioPlayerControlsStyles,
    spinAnimationClassName,
    sprinkles,
} from "~/client/web/styles/styles.js";
import {minAspectRatioIfNotSingleFileRow} from "~/shared/content/compute_file_row_widths.js";
import {convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
import {FileAudioPreview} from "~/shared/files/file_preview.js";
import {getFileContentTypeNoun} from "~/shared/files/get_file_content_type_noun.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {HtmlFragmentGenerator} from "~/shared/helpers/html/html_generator.js";

export function ContentFileAudioViewerDesktop({
    file,
    viewerSize,
}: {
    file: FileModelRegistryData;
    viewerSize: {width: number; height: number};
}) {
    assert(file.preview?.type === "Audio");

    const {space} = useSpaceContext();

    const audioSrc = getContentFileViewerSrc({spaceId: space.id, file});

    if (file.preview.isProcessing || !audioSrc) {
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
                    Processing {getFileContentTypeNoun(file.contentType)}
                </Box>
            </Box>
        );
    }

    return (
        <Box width="full" height="full" display="flex" alignItems="center" justifyContent="center">
            <ContentFileAudioViewerDesktopInner
                file={file}
                filePreview={file.preview}
                audioSrc={audioSrc}
                viewerSize={viewerSize}
            />
        </Box>
    );
}

function ContentFileAudioViewerDesktopInner({
    file,
    filePreview,
    audioSrc,
    viewerSize,
}: {
    file: FileModelRegistryData;
    filePreview: FileAudioPreview & {isProcessing: false};
    audioSrc: string;
    viewerSize: {width: number; height: number};
}) {
    if (file.alternative && !file.alternative.isProcessing && !file.alternative.ok) {
        throw new ContentFileProcessorError(file.contentType, file.alternative.error);
    }
    if (!filePreview.ok) {
        throw new ContentFileProcessorError(file.contentType, filePreview.error);
    }

    const isInitialAppRender = useIsInitialAppRender();
    const spacingScale = useSpacingScale();
    const reporter = useReporter();

    const viewerMarginXPx = convertRemLengthToPx(contentFileViewerDesktopMarginX, spacingScale);
    const width = viewerSize.width - viewerMarginXPx * 2;
    const height = width * minAspectRatioIfNotSingleFileRow;

    const containerRef = useRef<HTMLDivElement>(null);

    const containerHtml = useMemo(() => {
        const containerHtml = new HtmlFragmentGenerator();

        renderContentFileAudioPlayer(containerHtml, {
            file,
            filePreview,
            audioSrc,
            platform: "desktop",
            isInitialAppRender,
            withoutInteractivity: false,
            layout: null,
        });

        return containerHtml;
    }, [audioSrc, file, filePreview, isInitialAppRender]);

    const previousContainerHtmlRef = useRef<HtmlFragmentGenerator | null>(null);

    useLayoutEffectWithoutServerSideWarning(() => {
        const containerElement = assertExists(containerRef.current);

        const previousContainerHtml = previousContainerHtmlRef.current;
        previousContainerHtmlRef.current = previousContainerHtml;

        if (previousContainerHtml === containerHtml) return;

        if (!previousContainerHtml) {
            // This case happens during a hot reload. We need to remove the children currently
            // in the DOM.
            while (containerElement.hasChildNodes()) {
                containerElement.firstChild!.remove();
            }

            containerElement.appendChild(containerHtml.generateNode());
        } else {
            assert(containerHtml.patchNode(previousContainerHtml, containerElement));
        }
    }, [containerHtml]);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isInitialAppRender) return;

        const containerElement = assertExists(containerRef.current);

        const {onPress, cleanup} = addContentFileAudioPlayerBehavior(containerElement, {
            filePreview,
            getReporter: () => reporter,
        });

        const handleClick = (event: MouseEvent) => {
            // When clicking the video controls we call `event.preventDefault()` to prevent
            // this logic from running.
            if (event.defaultPrevented) return;

            event.preventDefault();
            onPress();
        };

        containerElement.addEventListener("click", handleClick);

        return () => {
            cleanup();
            containerElement.removeEventListener("click", handleClick);
        };
    }, [filePreview, isInitialAppRender, reporter]);

    return (
        <div
            ref={containerRef}
            className={classNames(
                contentFileAudioPlayerStyles.containerClassName,
                contentFileVideoAndAudioPlayerControlsStyles.containerClassName,
                sprinkles({
                    boxShadow: "elevation-20-above-content-file-viewer-modal",
                    borderRadius: "1",
                    color: "grey-100",
                }),
            )}
            style={{width, height}}
        />
    );
}
