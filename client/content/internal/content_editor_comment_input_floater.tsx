import {EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {RefObject, useCallback, useEffect, useRef, useState} from "react";
import {ContentEditorRef} from "~/client/content/content_editor.js";
import {
    ContentEditorState,
    createCommentThreadMetaKey,
    updateContentEditorReferences,
} from "~/client/content/content_editor_state.js";
import {ContentEditorCursorTracker} from "~/client/content/internal/content_editor_cursor_tracker.js";
import {Box} from "~/client/design/box.js";
import {ModalDialog} from "~/client/design/modal_dialog.js";
import {OverlayRef} from "~/client/design/overlay.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {useShowToast} from "~/client/design/toast.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/design/use_confirm_save_after_losing_focus.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {MessageInputBase} from "~/client/messaging/message_input.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
import {
    MessageContentWithReferences,
    emptyMessageContentWithReferences,
} from "~/shared/messaging/message_content_schema.js";
import {messageInputMinHeight} from "~/shared/messaging/messaging_shared_styles.js";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range.js";
import {greyElevated2ClassName, overlayFadeOutAnimationDurationMs} from "~/shared/styles/styles.js";

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
            offsetAlong="-24"
            // No fallback placements! The comment input always stays at the end of the
            // text its commenting on.
            fallbackPlacements={[]}
            overlay={
                <Box>
                    <ContentEditorCommentInput
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
    state: documentState,
    viewRef: documentViewRef,
    range: documentRange,
    onCloseWithoutAnimation,
    onCloseWithAnimation,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    range: {from: number; to: number};
    onCloseWithoutAnimation: () => void;
    onCloseWithAnimation: () => void;
}) {
    const showToast = useShowToast();
    const {currentAccount} = useSpaceContext();

    const [commentState, setCommentState] = useState(() =>
        ContentEditorState.create(emptyMessageContentWithReferences),
    );
    const [shouldShowConfirmCloseDialog, setShouldShowConfirmCloseDialog] = useState(false);

    const [isSendButtonPending, setIsSendButtonPending] = useState(false);

    const editorRef = useRef<ContentEditorRef<MessageContentWithReferences>>(null);
    const shouldFocusNextRenderRef = useRef(true);

    useEffect(() => {
        // If the close confirmation dialog is open, we can't focus our editor.
        if (shouldShowConfirmCloseDialog) return;

        if (!shouldFocusNextRenderRef.current) return;
        shouldFocusNextRenderRef.current = false;

        const editor = assertExists(editorRef.current);
        editor.focus({preventScroll: true});
    }, [shouldShowConfirmCloseDialog]);

    const sendCommentWithoutPromiseHandling = async () => {
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

    const sendComment = () => {
        const content = commentState.getContent();
        if (isContentEmpty(content.doc)) return;

        setIsSendButtonPending(true);

        runPromiseWithoutAwaiting(async () => {
            try {
                await sendCommentWithoutPromiseHandling();
            } catch (error) {
                showToast({
                    type: "Error",
                    title: "Can’t save comment",
                    error,
                });
            } finally {
                setIsSendButtonPending(false);
            }
        });
    };

    return (
        <>
            <Box
                width="96"
                style={{minHeight: messageInputMinHeight}}
                overflow="hidden"
                color="grey-text"
                backgroundColor="grey-0"
                borderRadius="lg"
                boxShadow="elevation-20"
                className={greyElevated2ClassName}
                onKeyDown={event => {
                    if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        onCloseWithoutAnimation();
                        return;
                    }
                }}
                ref={useConfirmSaveAfterLosingFocus({
                    shouldConfirmSave: !isContentEmpty(commentState.getDoc()),
                    isConfirmingSave: shouldShowConfirmCloseDialog,
                    onCancelSave: onCloseWithAnimation,
                    onConfirmSave: () => setShouldShowConfirmCloseDialog(true),
                })}
            >
                <MessageInputBase
                    editorRef={editorRef}
                    state={commentState}
                    onChange={setCommentState}
                    onSend={sendComment}
                    marginX="3"
                    withoutAccountAvatar={true}
                    isSendBottomArrowRight={true}
                    isSendButtonPending={isSendButtonPending}
                />
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
                    onPrimaryButtonPress={sendCommentWithoutPromiseHandling}
                    cancelButtonLabel="Discard comment"
                    onCancelButtonPress={onCloseWithoutAnimation}
                />
            )}
        </>
    );
}
