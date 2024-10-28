import classNames from "classnames";
import {useMemo, useRef} from "react";
import {ContentFileImageViewerDesktop} from "~/client/content/internal/content_file_image_viewer_desktop.js";
import {ContentFileViewerLoaderData} from "~/client/content/internal/load_content_file_viewer_data.js";
import {ContentFilePreviewExpirationTimers} from "~/client/content/internal/render_content_file_preview.js";
import {
    addContentFileVideoPlayerBehavior,
    renderContentFileVideoPlayer,
} from "~/client/content/internal/render_content_file_video_player.js";
import {useReporter} from "~/client/design/reporter.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {contentFileVideoPlayerStyles, greyElevated2ClassName} from "~/client/styles/styles.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileModel} from "~/shared/files/file_model.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {HtmlFragmentGenerator} from "~/shared/helpers/html/html_generator.js";

export function ContentFileVideoViewerDesktop({
    file,
    signedUrlSearch,
    attachmentTarget,
    expirationTimers,
    loaderDataPromise,
    viewerSize,
}: {
    file: FileModel;
    signedUrlSearch: string;
    attachmentTarget: FileAttachmentTarget;
    expirationTimers: ContentFilePreviewExpirationTimers;
    loaderDataPromise: PromiseImmediate<ContentFileViewerLoaderData | null>;
    viewerSize: {width: number; height: number};
}) {
    return (
        <ContentFileImageViewerDesktop
            file={file}
            signedUrlSearch={signedUrlSearch}
            attachmentTarget={attachmentTarget}
            expirationTimers={expirationTimers}
            loaderDataPromise={loaderDataPromise}
            viewerSize={viewerSize}
            zoomScale={1}
            maxZoomScale={1}
            extraChildrenForVideo={
                file.preview?.type === "Image" && typeof file.preview.videoDuration === "number" ? (
                    <ContentFileVideoViewerDesktopInner
                        file={file}
                        signedUrlSearch={signedUrlSearch}
                        durationMs={file.preview.videoDuration}
                    />
                ) : null
            }
        />
    );
}

function ContentFileVideoViewerDesktopInner({
    file,
    signedUrlSearch,
    durationMs,
}: {
    file: FileModel;
    signedUrlSearch: string;
    durationMs: number;
}) {
    const {space} = useSpaceContext();
    const reporter = useReporter();

    const containerRef = useRef<HTMLDivElement | null>(null);

    const containerHtml = useMemo(() => {
        const containerHtml = new HtmlFragmentGenerator();

        renderContentFileVideoPlayer(containerHtml, {
            spaceId: space.id,
            signedUrlSearch,
            file,
            durationMs,
            layout: null,
            isMobile: false,
        });

        return containerHtml;
    }, [durationMs, file, signedUrlSearch, space.id]);

    const previousContainerHtmlRef = useRef<HtmlFragmentGenerator | null>(null);

    useLayoutEffectWithoutServerSideWarning(() => {
        const containerElement = assertExists(containerRef.current);

        const previousContainerHtml = previousContainerHtmlRef.current;
        previousContainerHtmlRef.current = previousContainerHtml;

        if (previousContainerHtml === containerHtml) return;

        if (!previousContainerHtml) {
            containerElement.appendChild(containerHtml.generateNode());
        } else {
            assert(containerHtml.patchNode(previousContainerHtml, containerElement));
        }
    }, [containerHtml]);

    useLayoutEffectWithoutServerSideWarning(() => {
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
    }, [durationMs, reporter]);

    return (
        <div
            ref={containerRef}
            className={classNames(
                contentFileVideoPlayerStyles.containerClassName,
                greyElevated2ClassName,
            )}
        />
    );
}
