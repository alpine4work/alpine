import {Node} from "prosemirror-model";
import {useCallback, useMemo, useRef} from "react";
import {useButton} from "react-aria";
import {ContentView} from "~/client/content/content_view";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {useRemPx} from "~/client/design/helpers/use_rem_px";
import {documentCommentThreadPreviewHeight} from "~/client/documents/document_shared_styles";
import {ScriptBeforeAppInitialRender} from "~/client/helpers/lifecycle/script_before_initial_app_render";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {convertRemLengthToPx, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {DocumentContentReferences} from "~/shared/documents/document_content_references";
import {DocumentCommentThreadModel} from "~/shared/documents/document_model";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {safe, safeAlphanumericString, safeNumber} from "~/shared/helpers/string/safe_string";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types";
import {documentCommentThreadPreviewStyles, fontSizesByPlatform} from "~/shared/styles/styles";

export function DocumentCommentThreadPreview({
    commentThread,
    contentSnippet,
    contentReferences,
    onCommentThreadSnippetPress,
}: {
    commentThread: DocumentCommentThreadModel;
    contentSnippet: Node | null;
    contentReferences: DocumentContentReferences;
    onCommentThreadSnippetPress: (commentThreadId: DocumentCommentThreadId) => void;
}) {
    const remPx = useRemPx();
    const previewRef = useRef<HTMLDivElement>(null);
    const previewContentRef = useRef<HTMLDivElement>(null);

    const content = useMemo(() => {
        if (!contentSnippet) return null;
        return {doc: contentSnippet, references: contentReferences};
    }, [contentReferences, contentSnippet]);

    const shouldHighlightComment = useCallback(
        (commentThreadId: DocumentCommentThreadId) => commentThreadId === commentThread.id,
        [commentThread.id],
    );

    // NOTE(calebmer): This offset was picked to intentionally clip off some text
    // from the top and bottom lines in a block of text to make it clear you're
    // looking at a preview. We try to have enough text of the top line that you
    // can read it but know its cut and enough text on the bottom line that you
    // know its there but can't read it.
    const commentOffset = convertRemLengthToPx(
        `${parseRemLengthNumber(spacing["6"]) + parseRemLengthNumber(spacing["0.5"])}rem`,
        remPx,
    );

    // There is a `<ScriptBeforeAppInitialRender>` element below that copies this
    // logic so we can correctly position the preview during server-side rendering.
    useLayoutEffectWithoutServerSideWarning(() => {
        // If the content isn't rendering we can't position it.
        if (!content) return;

        const previewElement = assertExists(previewRef.current);
        const previewContentElement = assertExists(previewContentRef.current);

        const commentElement = assertExists(
            previewContentElement.querySelector(`[data-comment="${commentThread.id}"]`),
            "Snippet should contain previewed comment thread",
        );

        const previewRect = previewElement.getBoundingClientRect();
        const commentRect = commentElement.getBoundingClientRect();

        previewElement.scrollTop =
            commentRect.y - (previewRect.y - previewElement.scrollTop) - commentOffset;
    }, [commentOffset, commentThread.id, content]);

    // Scale the content snippet down to our smallest font size. Scaling it down so
    // it has the same text layout as the main content editor leads to text so
    // small that it's unreadable.
    const scale =
        fontSizesByPlatform["50"].desktop.fontSize / fontSizesByPlatform["100"].desktop.fontSize;

    const buttonRef = useRef<HTMLDivElement>(null);
    const {buttonProps, isPressed} = useButton(
        {
            elementType: "div",
            onPress: () => onCommentThreadSnippetPress(commentThread.id),
        },
        buttonRef,
    );

    return (
        <Box>
            <FocusRing offset="inset">
                <Box
                    ref={buttonRef}
                    display="block"
                    position="relative"
                    zIndex="0"
                    // Use pointer cursor because otherwise the preview has a weak clickable
                    // affordance. It's not clear that the preview is clickable unlike a button.
                    cursor="pointer"
                    borderBottom="grey-10"
                    style={{height: documentCommentThreadPreviewHeight}}
                    {...(buttonProps as any)}
                >
                    {isPressed && (
                        <Box
                            position="absolute"
                            inset="0"
                            zIndex="50"
                            pointerEvents="none"
                            className={documentCommentThreadPreviewStyles.pressOverlayClassName}
                        />
                    )}
                    <Box ref={previewRef} overflow="hidden" height="full">
                        <Box
                            ref={previewContentRef}
                            pointerEvents="none"
                            paddingX="1.5"
                            style={{
                                width: `${(1 / scale) * 100}%`,
                                transformOrigin: "0 0",
                                transform: `scale(${scale})`,
                            }}
                        >
                            {content && (
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
                        <ScriptBeforeAppInitialRender
                            script={safe`var previewContentElement = document.currentScript.previousElementSibling; var previewElement = previewContentElement.parentElement; var commentElement = previewContentElement.querySelector('[data-comment="${safeAlphanumericString(
                                commentThread.id,
                            )}"]'); if (commentElement) { var previewRect = previewElement.getBoundingClientRect(); var commentRect = commentElement.getBoundingClientRect(); previewElement.scrollTop = commentRect.y - (previewRect.y - previewElement.scrollTop) - ${safeNumber(
                                commentOffset,
                            )}; }`}
                        />
                    </Box>
                </Box>
            </FocusRing>
        </Box>
    );
}
