import {SpinnerGap} from "phosphor-react";
import {useRef} from "react";
import {FileModelRegistryData} from "~/client/content/file_registry.js";
import {ContentFileProcessorError} from "~/client/content/internal/content_file_processor_error.js";
import {
    contentFileViewerLargeProcessingIndicatorColor,
    contentFileViewerLargeProcessingIndicatorFontSize,
    contentFileViewerLargeProcessingIndicatorGap,
    contentFileViewerLargeProcessingIndicatorIconSize,
    contentFileViewerLargeProcessingIndicatorWeight,
} from "~/client/content/internal/content_file_viewer_shared_styles.js";
import {ContentFileViewerLoaderData} from "~/client/content/internal/load_content_file_viewer_data.js";
import {Box} from "~/client/design/box.js";
import {Spacer} from "~/client/design/spacer.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {usePromise} from "~/client/helpers/use_promise.js";
import {spinAnimationClassName} from "~/client/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {getFileContentTypeNoun} from "~/shared/files/get_file_content_type_noun.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export function ContentFileAudioViewerMobile({
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

    assert(loaderDataResult.isPending || loaderDataResult.value?.type === "AudioMobile");

    const audioElement =
        !loaderDataResult.isPending && loaderDataResult.value?.type === "AudioMobile"
            ? loaderDataResult.value.audioElement
            : null;

    if (!audioElement) {
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

    return <ContentFileAudioViewerMobileInner file={file} audioElement={audioElement} />;
}

function ContentFileAudioViewerMobileInner({
    file,
    audioElement,
}: {
    file: FileModelRegistryData;
    audioElement: HTMLAudioElement;
}) {
    const containerRef = useRef<HTMLDivElement>(null);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (file.isSignedUrlExpired) return;

        const containerElement = assertExists(containerRef.current);

        containerElement.appendChild(audioElement);

        return () => {
            audioElement.remove();
        };
    }, [audioElement, file.isSignedUrlExpired]);

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
