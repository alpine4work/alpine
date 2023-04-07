import {Node} from "prosemirror-model";
import {useCallback, useMemo, useRef} from "react";
import {ContentView} from "~/client/content/content_view";
import {Box} from "~/client/design/box";
import {useRemPx} from "~/client/design/helpers/use_rem_px";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {convertRemLengthToPx, spacing} from "~/shared/design/spacing";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types";
import {
    DocumentCommentThreadModel,
    DocumentContentReferences,
} from "~/shared/models/document_model";

export const documentCommentThreadPreviewMinHeight = 50;

export function DocumentCommentThreadPreview({
    commentThread,
    snippet,
    contentReferences,
}: {
    commentThread: DocumentCommentThreadModel;
    snippet: Node | null;
    contentReferences: DocumentContentReferences;
}) {
    const remPx = useRemPx();
    const isInitialAppRender = useIsInitialAppRender();
    const previewRef = useRef<HTMLDivElement>(null);
    const previewContentRef = useRef<HTMLDivElement>(null);

    const content = useMemo(() => {
        if (!snippet) return null;
        return {doc: snippet, references: contentReferences};
    }, [contentReferences, snippet]);

    const shouldHighlightComment = useCallback(
        (commentThreadId: DocumentCommentThreadId) => commentThreadId === commentThread.id,
        [commentThread.id],
    );

    useLayoutEffectWithoutServerSideWarning(() => {
        // If the content isn't rendering we can't position it.
        if (isInitialAppRender || !content) return;

        const previewElement = assertExists(previewRef.current);
        const previewContentElement = assertExists(previewContentRef.current);

        const commentElement = assertExists(
            previewContentElement.querySelector(`[data-comment="${commentThread.id}"]`),
            "Snippet should contain previewed comment thread",
        );

        const previewRect = previewElement.getBoundingClientRect();
        const commentRect = commentElement.getBoundingClientRect();

        previewElement.scrollTop =
            commentRect.y -
            (previewRect.y - previewElement.scrollTop) -
            convertRemLengthToPx(spacing["8"], remPx);
    }, [commentThread.id, content, isInitialAppRender, remPx]);

    // TODO(calebmer): Figure out a proper scale number. Right now we pick one that
    // tries to get the same layout as our document. Is that the right choice?
    // Maybe this should be dynamic. If we are scaling down our snippet needs
    // more text.
    const scale = 0.625;

    return (
        <Box padding="2">
            <Box
                ref={previewRef}
                paddingX="0.5"
                paddingY="1"
                height="32"
                border="grey-10"
                borderRadius="base"
                overflow="hidden"
            >
                <Box
                    ref={previewContentRef}
                    pointerEvents="none"
                    style={{
                        width: `${(1 / scale) * 100}%`,
                        transformOrigin: "0 0",
                        transform: `scale(${scale})`,
                    }}
                >
                    {!isInitialAppRender && content && (
                        // Don't render the snippet on initial app render because we need a layout
                        // effect to correctly position the content. Flashing content from invisible
                        // to visible is better than flashing content with the wrong scroll position
                        // to the right scroll position.
                        <ContentView
                            content={content}
                            // Don't allow interacting with the content at all. (Like clicking links.)
                            // Clicking on the preview opens it in the document.
                            isInert={true}
                            shouldHighlightComment={shouldHighlightComment}
                        />
                    )}
                </Box>
            </Box>
        </Box>
    );
}
