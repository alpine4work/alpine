import {ArrowRight, Plus} from "phosphor-react";
import {EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {RefObject, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor.js";
import {
    ContentEditorState,
    createCommentThreadMetaKey,
    updateContentEditorReferences,
} from "~/client/content/content_editor_state.js";
import {ContentEditorCursorTracker} from "~/client/content/internal/content_editor_cursor_tracker.js";
import {trimContentEnd, trimContentWithReferencesEnd} from "~/client/content/trim_content.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {IconButton} from "~/client/design/icon_button.js";
import {ModalDialog} from "~/client/design/modal_dialog.js";
import {OverlayRef} from "~/client/design/overlay.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/design/use_confirm_save_after_losing_focus.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    messageInputEditorBorderRadiusPx,
    messageInputEditorIconButtonSize,
    messageInputEditorMinHeightPx,
    messageInputEditorPaddingX,
    messageInputEditorPaddingYPx,
} from "~/client/styles/messaging_shared_styles.js";
import {
    greyElevated2ClassName,
    overlayFadeOutAnimationDurationMs,
    pointerEventsNoneNotInheritedClassName,
} from "~/client/styles/styles.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
import {
    MessageContentWithReferences,
    emptyMessageContentWithReferences,
} from "~/shared/messaging/message_content_schema.js";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range.js";

export function ContentEditorCommentInputFloater({
    state,
    viewRef,
    range,
    onClose: _onCloseWithoutAnimation,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    range: {from: number; to: number};
    onClose: () => void;
}) {
    // We use desktop measurements for `contentEditorCommentInputFloaterMinHeight`
    // and `contentEditorCommentInputFloaterAccountAvatarPaddingY` so assert this
    // component isn't rendered on mobile.
    const platform = usePlatform();
    assert(platform !== "mobile");

    const overlayRef = useRef<OverlayRef>(null);

    const [isClosing, setIsClosing] = useState(false);

    const onCloseWithAnimation = useCallback(() => {
        setIsClosing(true);
    }, []);

    const onCloseWithoutAnimation = useEvent(() => {
        // Return focus to the editor.
        assertExists(viewRef.current).focus();

        _onCloseWithoutAnimation();
    });

    useEffect(() => {
        if (isClosing) {
            const timeoutId = setTimeout(() => {
                onCloseWithoutAnimation();
            }, overlayFadeOutAnimationDurationMs);
            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [isClosing, onCloseWithoutAnimation]);

    const isNodeRange = useMemo(() => {
        if (range.from === range.to - 1) {
            const documentRangeNode = state.doc.resolve(range.from).nodeAfter;

            if (
                documentRangeNode &&
                !documentRangeNode.inlineContent &&
                documentRangeNode.type.allowsMarkType(state.schema.marks.comment!)
            ) {
                return true;
            }
        }

        return false;
    }, [range.from, range.to, state.doc, state.schema.marks.comment]);

    return (
        <OverlayAnimated
            ref={overlayRef}
            // We don't animate in because the overlay appears in direct response to a user
            // input (keyboard shortcut). But we do animate out because closing is less
            // intentional.
            //
            // Also it looks a little better to not animate when replacing a possibly
            // existing toolbar.
            isVisible={!isClosing}
            disableAnimation={!isClosing}
            isBlocking={true}
            // If the comment input is in our root blocking scope then ProseMirror's
            // `scrollIntoView()` functionality won't work since the comment input won't be
            // a child of the document's scroll view.
            withoutRootBlockingScope={true}
            placement="bottom"
            offset="3"
            // No fallback placements! The comment input always stays at the end of the
            // text its commenting on.
            fallbackPlacements={emptyArray}
            overlay={
                <Box>
                    <ContentEditorCommentInput
                        state={state}
                        viewRef={viewRef}
                        isNodeRange={isNodeRange}
                        range={range}
                        onCloseWithoutAnimation={onCloseWithoutAnimation}
                        onCloseWithAnimation={onCloseWithAnimation}
                    />
                </Box>
            }
        >
            <ContentEditorCursorTracker
                state={state}
                viewRef={viewRef}
                pos={isNodeRange ? range.from : range}
                onUpdatePosition={() => overlayRef.current?.forceUpdateOverlayPosition()}
            />
        </OverlayAnimated>
    );
}

function ContentEditorCommentInput({
    state: documentState,
    viewRef: documentViewRef,
    isNodeRange: isNodeDocumentRange,
    range: documentRange,
    onCloseWithoutAnimation,
    onCloseWithAnimation,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    isNodeRange: boolean;
    range: {from: number; to: number};
    onCloseWithoutAnimation: () => void;
    onCloseWithAnimation: () => void;
}) {
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const {currentAccount} = useSpaceContext();

    const [commentState, setCommentState] = useState(() =>
        ContentEditorState.create(emptyMessageContentWithReferences),
    );
    const [shouldShowConfirmCloseDialog, setShouldShowConfirmCloseDialog] = useState(false);

    const isSendButtonDisabled = useMemo(
        () => isContentEmpty(trimContentEnd(commentState.getDoc())),
        [commentState],
    );

    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<ContentEditorRef<MessageContentWithReferences>>(null);
    const sendButtonRef = useRef<HTMLButtonElement & {press(): void}>(null);
    const shouldFocusNextRenderRef = useRef(true);

    useEffect(() => {
        // If the close confirmation dialog is open, we can't focus our editor.
        if (shouldShowConfirmCloseDialog) return;

        if (!shouldFocusNextRenderRef.current) return;
        shouldFocusNextRenderRef.current = false;

        scheduleMicrotask(() => {
            const editor = editorRef.current;
            if (!editor) return;
            editor.focus({preventScroll: true});
            editor.scrollIntoView();
        });
    }, [shouldShowConfirmCloseDialog]);

    const sendComment = async () => {
        const content = trimContentWithReferencesEnd(commentState.getContent());
        if (isContentEmpty(content.doc)) return;

        const commentThreadId = generateId<DocumentCommentThreadId>();
        const trimmedDocumentRange = trimSpacesFromProsemirrorRange(
            documentState.doc,
            documentRange,
        );
        const openCommentThreadPromiseRef: {current: Promise<void> | null} = {
            current: null,
        };

        const transaction = documentState.tr;

        if (isNodeDocumentRange) {
            transaction.addNodeMark(
                trimmedDocumentRange.from,
                documentState.schema.mark("comment", {commentThreadId}),
            );
        } else {
            transaction.addMark(
                trimmedDocumentRange.from,
                trimmedDocumentRange.to,
                documentState.schema.mark("comment", {commentThreadId}),
            );
        }

        transaction.setMeta(createCommentThreadMetaKey, {
            commentThreadId,
            initialCommentContent: content,
            initialCommentFileIds: [],
            openCommentThreadPromiseRef,
        });

        transaction.scrollIntoView();

        updateContentEditorReferences(transaction, {
            type: "UpdateDocumentCommentThread",
            commentThreadId,
            commentCount: 1,
            addCommentAuthor: currentAccount,
        });

        assertExists(documentViewRef.current).dispatch(transaction);

        // `<DocumentContentEditor>` may open the comment thread after we create it.
        // Don't close our floater until this has happened.
        await openCommentThreadPromiseRef.current;

        onCloseWithoutAnimation();
    };

    return (
        <>
            <Box
                ref={useMergedRefs(
                    containerRef,
                    useConfirmSaveAfterLosingFocus({
                        shouldConfirmSave: !isContentEmpty(commentState.getDoc()),
                        isConfirmingSave: shouldShowConfirmCloseDialog,
                        onCancelSave: onCloseWithAnimation,
                        onConfirmSave: () => setShouldShowConfirmCloseDialog(true),
                    }),
                )}
                position="relative"
                width="96"
                color="grey-100"
                backgroundColor="grey-0"
                boxShadow="elevation-20"
                className={greyElevated2ClassName}
                style={{
                    borderRadius: messageInputEditorBorderRadiusPx[platform][spacingScale],
                }}
                onKeyDown={event => {
                    if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        if (isSendButtonDisabled) {
                            onCloseWithoutAnimation();
                        } else {
                            setShouldShowConfirmCloseDialog(true);
                        }
                        return;
                    }
                }}
                onPointerDownCapture={event => {
                    const editor = assertExists(editorRef.current);

                    // Tapping anywhere on the message input shouldn't unfocus the content editor
                    // since that will hide the virtual keyboard on mobile.
                    if (
                        event.target instanceof Element &&
                        // Exclude tapping in a portaled element. Like inputs in the link modal.
                        event.currentTarget.contains(event.target) &&
                        // Exclude tapping in the message input itself. Tapping there should do
                        // something.
                        !editor.contains(event.target)
                    ) {
                        event.preventDefault();
                    }
                }}
            >
                <Box
                    className={pointerEventsNoneNotInheritedClassName}
                    position="absolute"
                    left="0"
                    bottom="0"
                    zIndex="20"
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                    style={{
                        width: messageInputEditorMinHeightPx[platform][spacingScale],
                        height: messageInputEditorMinHeightPx[platform][spacingScale],
                    }}
                >
                    <IconButton
                        size={messageInputEditorIconButtonSize}
                        description="Add"
                        withoutTooltip={true}
                        // The add icon button is not focusable. That's because we don't want to
                        // remove focus from the message input when the add button is pressed. That
                        // way on mobile you can keep typing and sending messages because the software
                        // keyboard doesn't disappear.
                        //
                        // On desktop, hitting enter in the message input is sufficient for keyboard
                        // control of the message input.
                        isFocusable={false}
                        // TODO(calebmer, #files): Use to upload files
                    >
                        <Plus />
                    </IconButton>
                </Box>
                <FocusRing offset="border" isVisibleWhenFocusWithin={true}>
                    <Box
                        ref={useScrollbar({
                            insetTop: messageInputEditorBorderRadiusPx[platform][spacingScale],
                            // Don't overlap the send button which is rendered at the bottom of
                            // the input.
                            insetBottom: messageInputEditorMinHeightPx[platform][spacingScale],
                        })}
                        maxHeight="96"
                        position="relative"
                        overflowX="hidden"
                        overflowY="auto"
                        style={{
                            minHeight: messageInputEditorMinHeightPx[platform][spacingScale],
                            borderTopLeftRadius:
                                messageInputEditorBorderRadiusPx[platform][spacingScale],
                            borderBottomLeftRadius:
                                messageInputEditorBorderRadiusPx[platform][spacingScale],
                        }}
                    >
                        <ContentEditor
                            ref={editorRef}
                            state={commentState}
                            onChange={state => {
                                const containerElement = assertExists(containerRef.current);
                                const scrollParentElements: Array<{
                                    element: Element;
                                    scrollTop: number;
                                }> = [];

                                {
                                    let parentElement: Element | null = containerElement;
                                    while (parentElement) {
                                        const {overflowY} = getComputedStyle(parentElement);

                                        if (overflowY === "auto" || overflowY === "scroll") {
                                            scrollParentElements.push({
                                                element: parentElement,
                                                scrollTop: parentElement.scrollTop,
                                            });
                                        }

                                        parentElement =
                                            parentElement.parentElement !== document.body
                                                ? parentElement.parentElement
                                                : null;
                                    }
                                }

                                setCommentState(state);

                                // HACK(calebmer, 2024-12-11): In Chrome if we press shift-enter to add a bunch
                                // of paragraphs until the comment input needs to scroll, then press delete to
                                // delete those paragraphs, we observe Chrome (and only Chrome, Safari is fine)
                                // will scroll the document parent element. Presumably in an attempt to keep
                                // the text cursor in view.
                                //
                                // We've confirmed no JavaScript code is causing these scroll events (by
                                // checking `register_scroll_event_debugger.ts`). So to fix this bug we record
                                // scroll positions before updating our editor state.
                                //
                                // Video of the bug:
                                // https://gist.github.com/calebmer/aa365906d8d01a7f4b30a2d5dcbac612
                                requestAnimationFrame(() => {
                                    for (const {element, scrollTop} of scrollParentElements) {
                                        element.scrollTop = scrollTop;
                                    }
                                });
                            }}
                            aria-label="New comment"
                            placeholder="Add a comment"
                            style={{
                                paddingLeft: messageInputEditorPaddingX[platform],
                                paddingRight: messageInputEditorPaddingX[platform],
                                paddingTop: messageInputEditorPaddingYPx[platform][spacingScale],
                                paddingBottom: messageInputEditorPaddingYPx[platform][spacingScale],
                            }}
                            onEnterFromPhysicalKeyboard={event => {
                                event.preventDefault();
                                event.stopPropagation();
                                assertExists(sendButtonRef.current).press();
                            }}
                            // Don't render the default content editor mobile keyboard toolbar. We render
                            // our own `<MessageInputMobileKeyboardToolbar>` outside of the content editor.
                            withoutMobileKeyboardToolbar={true}
                            // Message input is always editable, never interactive on mobile. So you can't
                            // click links among other things.
                            withoutMobileDualModality={true}
                        />
                    </Box>
                </FocusRing>
                <Box
                    className={pointerEventsNoneNotInheritedClassName}
                    position="absolute"
                    right="0"
                    bottom="0"
                    zIndex="20"
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                    style={{
                        height: messageInputEditorMinHeightPx[platform][spacingScale],
                        width: messageInputEditorMinHeightPx[platform][spacingScale],
                    }}
                >
                    <IconButton
                        ref={sendButtonRef}
                        size={messageInputEditorIconButtonSize}
                        variant="accent"
                        description="Save comment"
                        pressErrorTitle="Can’t save comment"
                        onPress={sendComment}
                        isDisabled={isSendButtonDisabled}
                        // The send icon button is not focusable. That's because we don't want to
                        // remove focus from the message input when the send button is pressed. That
                        // way on mobile you can keep typing and sending messages because the software
                        // keyboard doesn't disappear.
                        //
                        // On desktop, hitting enter in the message input is sufficient for keyboard
                        // control of the message input.
                        isFocusable={false}
                    >
                        <ArrowRight
                            size={spacing["4"]}
                            weight={!isSendButtonDisabled ? "bold" : undefined}
                        />
                    </IconButton>
                </Box>
            </Box>
            {shouldShowConfirmCloseDialog && (
                <ModalDialog
                    title="Save comment"
                    description="Would you like to save your comment?"
                    onClose={() => {
                        // Return focus to the editor if the dialog is closed. This acts as a "cancel"
                        // and lets the user continue writing.
                        shouldFocusNextRenderRef.current = true;
                        setShouldShowConfirmCloseDialog(false);
                    }}
                    primaryButtonLabel="Save"
                    primaryButtonPressErrorTitle="Can’t save comment"
                    onPrimaryButtonPress={sendComment}
                    cancelButtonLabel="Discard comment"
                    onCancelButtonPress={onCloseWithoutAnimation}
                />
            )}
        </>
    );
}
