import {Tree} from "@lezer/common";
import {highlightCode} from "@lezer/highlight";
import classNames from "classnames";
import {SpinnerGap} from "phosphor-react";
import {ReactNode, useMemo} from "react";
import {FileModelRegistryData} from "~/client/web/content/file_registry.js";
import {ContentFileProcessorError} from "~/client/web/content/internal/content_file_processor_error.js";
import {
    contentFileViewerLargeProcessingIndicatorFontSize,
    contentFileViewerLargeProcessingIndicatorGap,
    contentFileViewerLargeProcessingIndicatorIconSize,
    contentFileViewerLargeProcessingIndicatorWeight,
} from "~/client/web/content/internal/content_file_viewer_shared_styles.js";
import {ContentFileViewerLoaderData} from "~/client/web/content/internal/load_content_file_viewer_data.js";
import {Box} from "~/client/web/design/box.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {usePromise} from "~/client/web/helpers/use_promise.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {contentStyles, spinAnimationClassName} from "~/client/web/styles/styles.js";
import {
    codeBlockClassName,
    codeBlockLineClassName,
    codeBlockLineContentClassName,
    codeBlockWrapper2ClassName,
} from "~/shared/design/core/constant_class_names.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {lezerClassHighlighter} from "~/shared/lezer/lezer_class_highlighter.open_source.js";

export function ContentFileCodeViewer({
    file,
    loaderDataPromise,
}: {
    file: FileModelRegistryData;
    loaderDataPromise: PromiseImmediate<ContentFileViewerLoaderData | null>;
}) {
    if (file.preview && !file.preview.isProcessing && !file.preview.ok) {
        throw new ContentFileProcessorError(file.contentType, file.preview.error);
    }

    const platform = usePlatform();

    const loaderDataResult = usePromise(loaderDataPromise);

    const codeNode = useMemo(() => {
        if (loaderDataResult.isPending) return null;

        assert(loaderDataResult.value?.type === "Code");

        const codeNodes: Array<ReactNode> = [];
        let lineNodes: Array<ReactNode> = [];

        const pushBreak = () => {
            // If a line has no content then add `<br>` elements so the text selection shows
            // something on empty lines and when copying the empty line shows up in the result.
            if (lineNodes.length === 0)
                lineNodes.push(<br key={lineNodes.length} data-copy="force-newlines" />);

            codeNodes.push(
                <div key={codeNodes.length} className={codeBlockLineClassName}>
                    <div className={codeBlockLineContentClassName}>{lineNodes}</div>
                </div>,
            );

            lineNodes = [];
        };

        highlightCode(
            loaderDataResult.value.code,
            loaderDataResult.value.codeTree ?? Tree.empty,
            lezerClassHighlighter.get(),
            (code, classes) => {
                if (classes.length === 0) {
                    lineNodes.push(code);
                } else {
                    lineNodes.push(
                        <span key={lineNodes.length} className={classes}>
                            {code}
                        </span>,
                    );
                }
            },
            pushBreak,
        );

        // In case our last line didn't end with a break, push one last break. If the
        // content ends with a trailing newline then this will show the trailing newline
        // which is fine. Matches VSCode's behavior.
        pushBreak();

        return <>{codeNodes}</>;
    }, [loaderDataResult]);

    const scrollbarRef = useScrollbar();

    if (!codeNode) {
        return (
            <Box
                width="full"
                height="full"
                display="flex"
                justifyContent="center"
                alignItems="center"
                color="grey-40"
            >
                <Box
                    display="flex"
                    flexDirection="column"
                    alignItems="center"
                    gap={contentFileViewerLargeProcessingIndicatorGap}
                    fontSize={contentFileViewerLargeProcessingIndicatorFontSize}
                >
                    <SpinnerGap
                        className={spinAnimationClassName}
                        size={spacing[contentFileViewerLargeProcessingIndicatorIconSize[platform]]}
                        weight={contentFileViewerLargeProcessingIndicatorWeight[platform]}
                    />
                    {file.isUploading ? "Processing code" : "Loading"}
                </Box>
            </Box>
        );
    }

    return (
        <pre
            ref={scrollbarRef}
            className={classNames(
                codeBlockWrapper2ClassName,
                contentStyles.fileViewCodeBlockClassName,
            )}
        >
            <code className={codeBlockClassName}>{codeNode}</code>
        </pre>
    );
}
