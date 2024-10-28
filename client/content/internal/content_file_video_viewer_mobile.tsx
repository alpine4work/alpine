import {SpinnerGap} from "phosphor-react";
import {useRef} from "react";
import {
    contentFileViewerLargeProcessingIndicatorColor,
    contentFileViewerLargeProcessingIndicatorFontSize,
    contentFileViewerLargeProcessingIndicatorGap,
    contentFileViewerLargeProcessingIndicatorIconSize,
    contentFileViewerLargeProcessingIndicatorWeight,
} from "~/client/content/internal/content_file_viewer_shared_styles.js";
import {ContentFileViewerLoaderData} from "~/client/content/internal/load_content_file_viewer_data.js";
import {ContentFilePreviewExpirationTimers} from "~/client/content/internal/render_content_file_preview.js";
import {Box} from "~/client/design/box.js";
import {Spacer} from "~/client/design/spacer.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {usePromise} from "~/client/helpers/use_promise.js";
import {useStore} from "~/client/helpers/use_store.js";
import {spinAnimationClassName} from "~/client/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {FileModel} from "~/shared/files/file_model.js";
import {getFileContentTypeNoun} from "~/shared/files/get_file_content_type_noun.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export function ContentFileVideoViewerMobile({
    file,
    signedUrlSearch,
    expirationTimers,
    loaderDataPromise,
}: {
    file: FileModel;
    signedUrlSearch: string;
    expirationTimers: ContentFilePreviewExpirationTimers;
    loaderDataPromise: PromiseImmediate<ContentFileViewerLoaderData | null>;
}) {
    const loaderDataResult = usePromise(loaderDataPromise);

    assert(loaderDataResult.isPending || loaderDataResult.value?.type === "VideoMobile");

    const videoElement =
        !loaderDataResult.isPending && loaderDataResult.value?.type === "VideoMobile"
            ? loaderDataResult.value.videoElement
            : null;

    if (!videoElement) {
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
                        size={spacing[contentFileViewerLargeProcessingIndicatorIconSize.mobile]}
                        weight={contentFileViewerLargeProcessingIndicatorWeight.mobile}
                    />
                    {loaderDataResult.isPending ? (
                        "Loading video"
                    ) : (
                        <Box textAlign="center">
                            <Box>Processing {getFileContentTypeNoun(file.contentType)}</Box>
                            <Spacer space="0.5" />
                            <Box>This may take a few minutes…</Box>
                        </Box>
                    )}
                </Box>
            </Box>
        );
    }

    return (
        <ContentFileVideoViewerMobileInner
            signedUrlSearch={signedUrlSearch}
            expirationTimers={expirationTimers}
            videoElement={videoElement}
        />
    );
}

function ContentFileVideoViewerMobileInner({
    signedUrlSearch,
    expirationTimers,
    videoElement,
}: {
    signedUrlSearch: string;
    expirationTimers: ContentFilePreviewExpirationTimers;

    videoElement: HTMLVideoElement;
}) {
    const containerRef = useRef<HTMLDivElement>(null);

    const isSignedUrlSearchExpired = useStore(
        expirationTimers.getExpiredTimerStore(signedUrlSearch),
    );

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isSignedUrlSearchExpired) return;

        const containerElement = assertExists(containerRef.current);

        containerElement.appendChild(videoElement);

        return () => {
            videoElement.remove();
        };
    }, [isSignedUrlSearchExpired, videoElement]);

    return (
        <Box
            ref={containerRef}
            width="full"
            height="full"
            overflow="hidden"
            display="flex"
            justifyContent="center"
            alignItems="center"
        />
    );
}
