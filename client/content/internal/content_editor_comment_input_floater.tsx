import {ArrowRight} from "phosphor-react";
import {EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {RefObject, useCallback, useEffect, useRef, useState} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor.js";
import {
    ContentEditorState,
    createCommentThreadMetaKey,
    updateContentEditorReferences,
} from "~/client/content/content_editor_state.js";
import {ContentEditorCursorTracker} from "~/client/content/internal/content_editor_cursor_tracker.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {IconButton} from "~/client/design/icon_button.js";
import {ModalDialog} from "~/client/design/modal_dialog.js";
import {OverlayRef} from "~/client/design/overlay.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/design/use_confirm_save_after_losing_focus.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {RemLength, parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
import {
    MessageContentWithReferences,
    emptyMessageContentWithReferences,
} from "~/shared/messaging/message_content_schema.js";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range.js";
import {
    messageInputAccountAvatarPaddingY,
    messageInputAccountAvatarSize,
    messageViewBubbleBorderRadius,
    messageViewBubbleMinHeight,
    messageViewBubblePaddingX,
    messageViewBubblePaddingY,
} from "~/shared/styles/messaging_shared_styles.js";
import {
    greyElevated2ClassName,
    overlayFadeOutAnimationDurationMs,
    sprinkles,
} from "~/shared/styles/styles.js";

const contentEditorCommentInputFloaterPaddingY = "2.5";

const contentEditorCommentInputFloaterPaddingYDifferenceRem =
    parseRemLengthNumber(spacing[contentEditorCommentInputFloaterPaddingY]) -
    parseRemLengthNumber(spacing[messageViewBubblePaddingY]);

const contentEditorCommentInputFloaterMinHeight: RemLength = `${
    parseRemLengthNumber(messageViewBubbleMinHeight) +
    contentEditorCommentInputFloaterPaddingYDifferenceRem * 2
}rem`;

const contentEditorCommentInputFloaterAccountAvatarPaddingY: RemLength = `${
    parseRemLengthNumber(messageInputAccountAvatarPaddingY) +
    contentEditorCommentInputFloaterPaddingYDifferenceRem
}rem`;

export function ContentEditorCommentInputFloater({
    withMobileLayout,
    state,
    viewRef,
    range,
    onClose: _onCloseWithoutAnimation,
}: {
    withMobileLayout: boolean;
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    range: {from: number; to: number};
    onClose: () => void;
}) {
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
            placement="bottom-start"
            offset="3"
            offsetAlong="-16"
            // No fallback placements! The comment input always stays at the end of the
            // text its commenting on.
            fallbackPlacements={[]}
            overlay={
                <Box>
                    <ContentEditorCommentInput
                        withMobileLayout={withMobileLayout}
                        state={state}
                        viewRef={viewRef}
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
                pos={range.to}
                onUpdatePosition={() => overlayRef.current?.forceUpdateOverlayPosition()}
            />
        </OverlayAnimated>
    );
}

function ContentEditorCommentInput({
    withMobileLayout,
    state: documentState,
    viewRef: documentViewRef,
    range: documentRange,
    onCloseWithoutAnimation,
    onCloseWithAnimation,
}: {
    withMobileLayout: boolean;
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    range: {from: number; to: number};
    onCloseWithoutAnimation: () => void;
    onCloseWithAnimation: () => void;
}) {
    const {currentAccount} = useSpaceContext();

    const [commentState, setCommentState] = useState(() =>
        ContentEditorState.create(emptyMessageContentWithReferences),
    );
    const [shouldShowConfirmCloseDialog, setShouldShowConfirmCloseDialog] = useState(false);

    const isSendButtonDisabled = isContentEmpty(commentState.getDoc());

    const editorRef = useRef<ContentEditorRef<MessageContentWithReferences>>(null);
    const sendButtonRef = useRef<HTMLButtonElement & {press(): void}>(null);
    const shouldFocusNextRenderRef = useRef(true);

    useEffect(() => {
        // If the close confirmation dialog is open, we can't focus our editor.
        if (shouldShowConfirmCloseDialog) return;

        if (!shouldFocusNextRenderRef.current) return;
        shouldFocusNextRenderRef.current = false;

        const editor = assertExists(editorRef.current);
        editor.focus({preventScroll: true});
    }, [shouldShowConfirmCloseDialog]);

    const sendComment = async () => {
        const content = commentState.getContent();
        if (isContentEmpty(content.doc)) return;

        const commentThreadId = generateId<DocumentCommentThreadId>();
        const trimmedDocumentRange = trimSpacesFromProsemirrorRange(
            documentState.doc,
            documentRange,
        );
        const openCommentThreadPromiseRef: {current: Promise<void> | null} = {
            current: null,
        };

        assertExists(documentViewRef.current).dispatch(
            updateContentEditorReferences(
                documentState.tr
                    .addMark(
                        trimmedDocumentRange.from,
                        trimmedDocumentRange.to,
                        documentState.schema.mark("comment", {commentThreadId}),
                    )
                    .setMeta(createCommentThreadMetaKey, {
                        commentThreadId,
                        initialCommentContent: content,
                        openCommentThreadPromiseRef,
                    })
                    .scrollIntoView(),
                {
                    type: "UpdateDocumentCommentThread",
                    commentThreadId,
                    commentCount: 1,
                    addCommentAuthor: currentAccount,
                },
            ),
        );

        // `<DocumentContentEditor>` may open the comment thread after we create it.
        // Don't close our floater until this has happened.
        await openCommentThreadPromiseRef.current;

        onCloseWithoutAnimation();
    };

    return (
        <>
            <Box
                overflow="hidden"
                width="96"
                display="flex"
                color="grey-100"
                backgroundColor="grey-0"
                borderRadius={messageViewBubbleBorderRadius}
                boxShadow="elevation-20"
                className={greyElevated2ClassName}
                style={{paddingRight: contentEditorCommentInputFloaterAccountAvatarPaddingY}}
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
                ref={useConfirmSaveAfterLosingFocus({
                    shouldConfirmSave: !isContentEmpty(commentState.getDoc()),
                    isConfirmingSave: shouldShowConfirmCloseDialog,
                    onCancelSave: onCloseWithAnimation,
                    onConfirmSave: () => setShouldShowConfirmCloseDialog(true),
                })}
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
                <FocusRing offset="border" isVisibleWhenFocusWithin={true}>
                    <Box
                        flexGrow="1"
                        overflow="hidden"
                        borderLeftRadius={messageViewBubbleBorderRadius}
                        style={{minHeight: contentEditorCommentInputFloaterMinHeight}}
                    >
                        <Box
                            ref={useScrollbar({
                                insetTop: contentEditorCommentInputFloaterAccountAvatarPaddingY,
                                insetBottom: contentEditorCommentInputFloaterAccountAvatarPaddingY,
                            })}
                            maxHeight="96"
                            position="relative"
                            overflowX="hidden"
                            overflowY="auto"
                        >
                            <ContentEditor
                                ref={editorRef}
                                withMobileLayout={withMobileLayout}
                                state={commentState}
                                onChange={setCommentState}
                                aria-label="New comment"
                                placeholder="Add a comment"
                                className={sprinkles({
                                    paddingX: messageViewBubblePaddingX,
                                    paddingY: contentEditorCommentInputFloaterPaddingY,
                                })}
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
                    </Box>
                </FocusRing>
                <Box
                    // This comment input is designed to resemble `<MessageInputBase>` but without
                    // an internal border since the floater overlay provides that division. Add a
                    // vertical border separating the send button from the comment since in
                    // `<MessageInputBase>` the `grey-10` border around the message content would
                    // separate the `<ContentEditor>` from the send button. This creates the same
                    // visual separation.
                    flexShrink="0"
                    style={{
                        paddingTop: contentEditorCommentInputFloaterAccountAvatarPaddingY,
                        paddingBottom: contentEditorCommentInputFloaterAccountAvatarPaddingY,
                        paddingRight: contentEditorCommentInputFloaterAccountAvatarPaddingY,
                    }}
                >
                    <Box height="full" borderLeft="grey-5" />
                </Box>
                <Box flexShrink="0" display="flex" alignItems="flex-end">
                    <Box
                        width={messageInputAccountAvatarSize}
                        style={{
                            paddingTop: contentEditorCommentInputFloaterAccountAvatarPaddingY,
                            paddingBottom: contentEditorCommentInputFloaterAccountAvatarPaddingY,
                        }}
                    >
                        <IconButton
                            ref={sendButtonRef}
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
