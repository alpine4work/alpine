import {SpinnerGap} from "phosphor-react";
import {useRef} from "react";
import {FileModelRegistryData} from "~/client/web/content/file_registry.js";
import {ContentFileProcessorError} from "~/client/web/content/internal/content_file_processor_error.js";
import {
    contentFileViewerLargeProcessingIndicatorColor,
    contentFileViewerLargeProcessingIndicatorFontSize,
    contentFileViewerLargeProcessingIndicatorGap,
    contentFileViewerLargeProcessingIndicatorIconSize,
    contentFileViewerLargeProcessingIndicatorWeight,
} from "~/client/web/content/internal/content_file_viewer_shared_styles.js";
import {ContentFileViewerLoaderData} from "~/client/web/content/internal/load_content_file_viewer_data.js";
import {Box} from "~/client/web/design/box.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {usePromise} from "~/client/web/helpers/use_promise.js";
import {spinAnimationClassName} from "~/client/web/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {getFileContentTypeNoun} from "~/shared/files/get_file_content_type_noun.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export function ContentFileVideoViewerMobile({
    file,
    loaderDataPromise,
}: {
    file: FileModelRegistryData;
    loaderDataPromise: PromiseImmediate<ContentFileViewerLoaderData | null>;
}) {
    if (file.alternative && !file.alternative.isProcessing && !file.alternative.ok) {
        throw new ContentFileProcessorError(file.contentType, file.alternative.error);
    }
    if (file.preview && !file.preview.isProcessing && !file.preview.ok) {
        throw new ContentFileProcessorError(file.contentType, file.preview.error);
    }

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
                        `Loading ${getFileContentTypeNoun(file.contentType)}`
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

    return <ContentFileVideoViewerMobileInner file={file} videoElement={videoElement} />;
}

function ContentFileVideoViewerMobileInner({
    file,
    videoElement,
}: {
    file: FileModelRegistryData;
    videoElement: HTMLVideoElement;
}) {
    const containerRef = useRef<HTMLDivElement>(null);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (file.isSignedUrlExpired) return;

        const containerElement = assertExists(containerRef.current);

        containerElement.appendChild(videoElement);

        return () => {
            videoElement.remove();
        };
    }, [file.isSignedUrlExpired, videoElement]);

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
