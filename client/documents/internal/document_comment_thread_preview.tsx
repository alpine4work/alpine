import {Node} from "prosemirror-model";
import {useCallback, useMemo, useRef, useState} from "react";
import {useButton} from "react-aria";
import {ContentView} from "~/client/content/content_view.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {useRemPx} from "~/client/design/helpers/use_rem_px.js";
import {ScriptBeforeAppInitialRender} from "~/client/helpers/lifecycle/script_before_initial_app_render.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {documentCommentThreadPreviewHeight} from "~/client/styles/document_shared_styles.js";
import {
    invertSelectionColorsClassName,
    pressOpacityOverlayClassName,
} from "~/client/styles/styles.js";
import {fontSizesByPlatform} from "~/shared/design/fonts.js";
import {convertRemLengthToPx, parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {
    DocumentContentReferences,
    UncheckedDocumentContentWithReferences,
} from "~/shared/documents/document_content_references.js";
import {DocumentCommentThreadModel} from "~/shared/documents/document_model.js";
import {stripDocumentContentCommentMarks} from "~/shared/documents/strip_document_content_comment_marks.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {safe, safeAlphanumericString, safeNumber} from "~/shared/helpers/string/safe_string.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";

const documentCommentThreadPreviewScale =
    fontSizesByPlatform["75"].desktop.fontSize / fontSizesByPlatform["100"].desktop.fontSize;

export function DocumentCommentThreadPreview({
    withMobileLayout,
    commentThread,
    unpersistedIsResolved,
    contentSnippet,
    contentReferences,
    onCommentThreadSnippetPress,
    isResolveButtonPending,
    fileRowLayoutScreenWidthRem,
}: {
    withMobileLayout: boolean;
    commentThread: DocumentCommentThreadModel;
    unpersistedIsResolved: boolean | null;
    contentSnippet: Node | null;
    contentReferences: DocumentContentReferences;
    onCommentThreadSnippetPress: (commentThreadId: DocumentCommentThreadId) => void;
    isResolveButtonPending: boolean;
    fileRowLayoutScreenWidthRem: number;
}) {
    const remPx = useRemPx();
    const previewRef = useRef<HTMLDivElement>(null);
    const previewContentRef = useRef<HTMLDivElement>(null);

    const isResolved = unpersistedIsResolved ?? commentThread.isResolved;

    const currentContent = useMemo(() => {
        if (!contentSnippet) return null;
        return {
            doc: stripDocumentContentCommentMarks(contentSnippet, {
                exceptCommentThreadIds: new Set([commentThread.id]),
            }),
            references: contentReferences,
        } as UncheckedDocumentContentWithReferences;
    }, [commentThread.id, contentReferences, contentSnippet]);

    // Our `previousContent` state holds the last `currentContent` object we
    // rendered. So if `currentContent` becomes null we can continue to render the
    // last value we saw out of `previousContent`.
    const [previousContent, setPreviousContent] =
        useState<UncheckedDocumentContentWithReferences | null>(null);

    if (!previousContent && currentContent) setPreviousContent(currentContent);
    if (previousContent && currentContent && previousContent !== currentContent)
        setPreviousContent(currentContent);

    const content = currentContent ?? previousContent ?? commentThread.fallbackContentSnippet;

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

    const buttonRef = useRef<HTMLDivElement>(null);
    const {buttonProps, isPressed} = useButton(
        {
            elementType: "div",
            onPress: () => onCommentThreadSnippetPress(commentThread.id),
        },
        buttonRef,
    );

    // We strip all comments except the one the comment thread is rendering. So
    // it's safe to highlight all comments.
    const shouldHighlightComment = useCallback(() => true, []);

    const shouldShowMarkRemovedWarning = !currentContent && !isResolved;
    const [showMarkRemovedWarning, setShowMarkRemovedWarning] = useState(
        shouldShowMarkRemovedWarning,
    );

    // Update whether we should show the banner only if the resolve button is not
    // pending. While the resolve button is pending we can get into a state where
    // we've received a `PersistedContent` event (which updates `commentThread`)
    // before an `UpdateContentWithoutPersistence` event (which adds or removes the
    // mark in our content).
    //
    // To avoid the banner flashing in unnecessarily we must wait until we receive
    // `UpdateContentWithoutPersistence`. `isResolveButtonPending` will be true
    // until we receive `UpdateContentWithoutPersistence`.
    if (showMarkRemovedWarning !== shouldShowMarkRemovedWarning && !isResolveButtonPending) {
        setShowMarkRemovedWarning(shouldShowMarkRemovedWarning);
    }

    return (
        <FocusRing offset="border">
            <Box
                ref={buttonRef}
                data-testid="DocumentCommentThreadPreview"
                display="block"
                position="relative"
                zIndex="0"
                // Use pointer cursor because otherwise the preview has a weak clickable
                // affordance. It's not clear that the preview is clickable unlike a button.
                cursor="pointer"
                // Outset border so content at the edges (e.g. with a background color) doesn't
                // render over our border.
                boxShadow="elevation-5-with-grey-10-outset-border"
                borderRadius="1.5"
                overflow="hidden"
                {...(buttonProps as any)}
            >
                {isPressed && (
                    <Box
                        position="absolute"
                        inset="0"
                        zIndex="50"
                        pointerEvents="none"
                        className={pressOpacityOverlayClassName}
                    />
                )}
                {showMarkRemovedWarning && (
                    <Box
                        className={invertSelectionColorsClassName}
                        height="8"
                        paddingX="2.5"
                        color="grey-0"
                        backgroundColor="grey-90"
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                    >
                        Selected text has been removed from the document
                    </Box>
                )}
                <Box
                    ref={previewRef}
                    overflow="hidden"
                    style={{height: spacing[documentCommentThreadPreviewHeight]}}
                >
                    <Box
                        ref={previewContentRef}
                        pointerEvents="none"
                        paddingX="1.5"
                        style={{
                            width: `${(1 / documentCommentThreadPreviewScale) * 100}%`,
                            transformOrigin: "0 0",
                            transform: `scale(${documentCommentThreadPreviewScale})`,
                        }}
                    >
                        {content && (
                            // Don't render the snippet on initial app render because we need a layout
                            // effect to correctly position the content. Flashing content from invisible
                            // to visible is better than flashing content with the wrong scroll position
                            // to the right scroll position.
                            <ContentView
                                withMobileLayout={withMobileLayout}
                                content={content}
                                // Don't allow interacting with the content at all. (Like clicking links.)
                                // Clicking on the preview opens it in the document.
                                isInert={true}
                                shouldHighlightComment={shouldHighlightComment}
                                fileRowLayoutScreenWidth={
                                    (fileRowLayoutScreenWidthRem /
                                        documentCommentThreadPreviewScale) *
                                    remPx
                                }
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
    );
}
