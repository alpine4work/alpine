import classNames from "classnames";
import {useMemo, useRef} from "react";
import {FileModelRegistryData} from "~/client/content/file_registry.js";
import {ContentFileImageViewerDesktop} from "~/client/content/internal/content_file_image_viewer_desktop.js";
import {ContentFileProcessorError} from "~/client/content/internal/content_file_processor_error.js";
import {
    addContentFileVideoPlayerBehavior,
    renderContentFileVideoPlayer,
} from "~/client/content/internal/content_file_video_player.js";
import {ContentFileViewerLoaderData} from "~/client/content/internal/load_content_file_viewer_data.js";
import {useReporter} from "~/client/design/reporter.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/initial_app_render.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    contentFileVideoAndAudioPlayerControlsStyles,
    contentFileVideoPlayerStyles,
} from "~/client/styles/styles.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {HtmlFragmentGenerator} from "~/shared/helpers/html/html_generator.js";

export function ContentFileVideoViewerDesktop({
    file,
    attachmentTarget,
    loaderDataPromise,
    viewerSize,
}: {
    file: FileModelRegistryData;
    attachmentTarget: FileAttachmentTarget | "Uploader";
    loaderDataPromise: PromiseImmediate<ContentFileViewerLoaderData | null>;
    viewerSize: {width: number; height: number};
}) {
    return (
        <ContentFileImageViewerDesktop
            file={file}
            attachmentTarget={attachmentTarget}
            loaderDataPromise={loaderDataPromise}
            viewerSize={viewerSize}
            zoomScale={1}
            maxZoomScale={1}
            extraChildrenForVideo={
                file.preview?.type === "Image" && typeof file.preview.videoDuration === "number" ? (
                    <ContentFileVideoViewerDesktopInner
                        file={file}
                        durationMs={file.preview.videoDuration}
                    />
                ) : null
            }
        />
    );
}

function ContentFileVideoViewerDesktopInner({
    file,
    durationMs,
}: {
    file: FileModelRegistryData;
    durationMs: number;
}) {
    if (file.alternative && !file.alternative.isProcessing && !file.alternative.ok) {
        throw new ContentFileProcessorError(file.contentType, file.alternative.error);
    }
    if (file.preview && !file.preview.isProcessing && !file.preview.ok) {
        throw new ContentFileProcessorError(file.contentType, file.preview.error);
    }

    const isInitialAppRender = useIsInitialAppRender();
    const {space} = useSpaceContext();
    const reporter = useReporter();

    const containerRef = useRef<HTMLDivElement | null>(null);

    const containerHtml = useMemo(() => {
        const containerHtml = new HtmlFragmentGenerator();

        renderContentFileVideoPlayer(containerHtml, {
            spaceId: space.id,
            file,
            durationMs,
            layout: null,
            platform: "desktop",
            isInitialAppRender,
            withoutInteractivity: false,
        });

        return containerHtml;
    }, [durationMs, file, isInitialAppRender, space.id]);

    const previousContainerHtmlRef = useRef<HtmlFragmentGenerator | null>(null);

    useLayoutEffectWithoutServerSideWarning(() => {
        const containerElement = assertExists(containerRef.current);

        const previousContainerHtml = previousContainerHtmlRef.current;
        previousContainerHtmlRef.current = previousContainerHtml;

        if (previousContainerHtml === containerHtml) return;

        if (!previousContainerHtml) {
            // This case happens during a hot reload. We need to remove the children
            // currently in the DOM.
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

        const {onPress, cleanup} = addContentFileVideoPlayerBehavior(containerElement, {
            durationMs,
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
    }, [durationMs, isInitialAppRender, reporter]);

    return (
        <div
            ref={containerRef}
            className={classNames(
                contentFileVideoPlayerStyles.containerClassName,
                contentFileVideoAndAudioPlayerControlsStyles.containerClassName,
                greyElevated2ClassName,
            )}
        />
    );
}
