import {ArrowRight} from "phosphor-react";
import {EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {RefObject, useCallback, useEffect, useRef, useState} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
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
import {useShowToast} from "~/client/design/toast.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/design/use_confirm_save_after_losing_focus.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {
    RemLength,
    Spacing,
    addRemLengths,
    parseRemLengthNumber,
    spacing,
} from "~/shared/design/spacing.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
import {emptyMessageContentWithReferences} from "~/shared/messaging/message_content_schema.js";
import {
    messageInputMinHeight,
    messageViewBubbleBorderRadius,
    messageViewBubbleMinHeight,
    messageViewBubblePaddingX,
    messageViewBubblePaddingY,
} from "~/shared/messaging/messaging_shared_styles.js";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range.js";
import {
    colorSchemeVars,
    greyElevated2ClassName,
    overlayFadeOutAnimationDurationMs,
    sprinkles,
} from "~/shared/styles/styles.js";

const accountAvatarSize: Spacing = "7";
const accountAvatarPaddingY: RemLength = `${
    (parseRemLengthNumber(messageViewBubbleMinHeight) -
        parseRemLengthNumber(spacing[accountAvatarSize])) /
    2
}rem`;

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
                <Box
                    // Add a bit of bottom padding so that if we are extending the screen width
                    // down we have a bit of margin between the bottom of our comment input and the
                    // bottom of the screen.
                    paddingBottom="1"
                >
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

    const sendButtonRef = useRef<HTMLButtonElement>(null);
    const [commentState, setCommentState] = useState(() =>
        ContentEditorState.create(emptyMessageContentWithReferences),
    );
    const [shouldShowConfirmCloseDialog, setShouldShowConfirmCloseDialog] = useState(false);

    const [isSendButtonPending, setIsSendButtonPending] = useState(false);
    const isSendButtonDisabled = isContentEmpty(commentState.getDoc());

    const editorRef = useRef<ContentEditorRef>(null);
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
                style={{
                    minHeight: `${
                        parseRemLengthNumber(messageInputMinHeight) -
                        parseRemLengthNumber(spacing["1"])
                    }rem`,
                    paddingLeft: addRemLengths(spacing["3"], spacing["0.5"]),
                    paddingRight: addRemLengths(spacing["3"], spacing["0.5"]),
                }}
                paddingY="3"
                display="flex"
                overflow="hidden"
                color="grey-text"
                backgroundColor="grey-0"
                borderRadius="2xl"
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
                <Box display="flex" alignItems="flex-end">
                    <Box
                        style={{
                            paddingTop: accountAvatarPaddingY,
                            paddingBottom: accountAvatarPaddingY,
                        }}
                    >
                        <AccountAvatar account={currentAccount} size={accountAvatarSize} />
                    </Box>
                </Box>
                <FocusRing isVisibleWhenFocusWithin={true}>
                    <Box
                        flexGrow="1"
                        overflow="hidden"
                        marginX="2"
                        backgroundColor="grey-5"
                        borderRadius={messageViewBubbleBorderRadius}
                        style={{
                            minHeight: messageViewBubbleMinHeight,
                            // Use `box-shadow` for border to not contribute to the element's size.
                            //
                            // NOTE(calebmer, 2023-11-27): Added this border to the message input since the
                            // background alone made the input look too much like any other comment. The
                            // border helps it stand out more, gives it visual importance. I want to keep
                            // the background so the appearance of the message input accurately reflects a
                            // message bubble. Let's make this change and see how I feel using it.
                            boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`,
                        }}
                    >
                        <Box
                            ref={useScrollbar({
                                insetY: spacing["1.5"],
                                insetRight: spacing["0.5"],
                            })}
                            maxHeight="64"
                            position="relative"
                            overflowX="hidden"
                            overflowY="auto"
                        >
                            <ContentEditor
                                ref={editorRef}
                                state={commentState}
                                onChange={setCommentState}
                                aria-label="New comment"
                                placeholder="Write a comment"
                                className={sprinkles({
                                    paddingX: messageViewBubblePaddingX,
                                    paddingY: messageViewBubblePaddingY,
                                })}
                                onEnterFromPhysicalKeyboard={event => {
                                    event.preventDefault();
                                    event.stopPropagation();

                                    sendComment();
                                }}
                            />
                        </Box>
                    </Box>
                </FocusRing>
                <Box display="flex" alignItems="flex-end">
                    <Box
                        style={{
                            paddingTop: accountAvatarPaddingY,
                            paddingBottom: accountAvatarPaddingY,
                        }}
                    >
                        <IconButton
                            ref={sendButtonRef}
                            variant="accent"
                            description="Save comment"
                            isDisabled={isSendButtonDisabled}
                            isPending={isSendButtonPending}
                            onPress={sendComment}
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
                    onPrimaryButtonPress={sendCommentWithoutPromiseHandling}
                    cancelButtonLabel="Discard comment"
                    onCancelButtonPress={onCloseWithoutAnimation}
                />
            )}
        </>
    );
}
