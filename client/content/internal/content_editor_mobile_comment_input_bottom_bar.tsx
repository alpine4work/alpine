import {EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {RefObject, useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {
    ContentEditorState,
    createCommentThreadMetaKey,
    updateContentEditorReferences,
} from "~/client/content/content_editor_state.js";
import {MessageInputBase, MessageInputRef} from "~/client/content/messaging/message_input_base.js";
import {Box} from "~/client/design/box.js";
import {ModalDialog} from "~/client/design/modal_dialog.js";
import {useOverlayMobileKeyboardPortalElement} from "~/client/design/overlay_mobile_keyboard_sink_context_provider.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/design/use_confirm_save_after_losing_focus.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
import {emptyMessageContentWithReferences} from "~/shared/messaging/message_content_schema.js";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range.js";

export function ContentEditorMobileCommentInputBottomBar({
    state: documentState,
    viewRef: documentViewRef,
    onClose,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    onClose: () => void;
}) {
    const portalElement = assertExists(
        useOverlayMobileKeyboardPortalElement(),
        "Can't server render `<ContentEditorMobileCommentInputBottomBar>`",
    );

    const {currentAccount} = useSpaceContext();

    const inputRef = useRef<MessageInputRef>(null);

    const [state, setState] = useState(() =>
        ContentEditorState.create(emptyMessageContentWithReferences),
    );
    const [shouldShowConfirmCloseDialog, setShouldShowConfirmCloseDialog] = useState(false);

    const shouldFocusNextRenderRef = useRef(true);

    useLayoutEffectWithoutServerSideWarning(() => {
        // If the close confirmation dialog is open, we can't focus our editor.
        if (shouldShowConfirmCloseDialog) return;

        if (!shouldFocusNextRenderRef.current) return;
        shouldFocusNextRenderRef.current = false;

        const input = assertExists(inputRef.current);
        input.focus({preventScroll: true});
    }, [shouldShowConfirmCloseDialog]);

    const [isInitialRender, setIsInitialRender] = useState(true);
    useEffect(() => {
        setIsInitialRender(false);
    }, []);

    const sendComment = () => {
        const content = state.getContent();
        if (isContentEmpty(content.doc)) return;

        const commentThreadId = generateId<DocumentCommentThreadId>();
        const trimmedDocumentRange = trimSpacesFromProsemirrorRange(
            documentState.doc,
            documentState.selection,
        );

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

        onClose();
    };

    return (
        <>
            <Box
                position="absolute"
                // Render above everything on the page.
                zIndex="70"
                inset="0"
                backgroundColor="grey-dark"
                opacity={isInitialRender ? "0" : {light: "10", dark: "40"}}
                // Render a cover over the document so the user knows they can't interact and
                // should focus on their comment. If they tap on the cover the comment input
                // will be dismissed.
                style={{transition: "opacity 240ms ease-out"}}
            />
            {createPortal(
                <Box
                    position="absolute"
                    // Render above everything on the page.
                    zIndex="80"
                    left="0"
                    right="0"
                    style={{
                        top: `var(--space-outlet-height, 100svh)`,
                        transform: "translateY(-100%)",
                    }}
                    // Bottom bar message input expects to be rendered in a flex context. Or else
                    // some layout bits (like the bottom bar safe area cover) won't work
                    // quite right.
                    display="flex"
                    flexDirection="column"
                    ref={useConfirmSaveAfterLosingFocus({
                        shouldConfirmSave: !isContentEmpty(state.getDoc()),
                        isConfirmingSave: shouldShowConfirmCloseDialog,
                        onCancelSave: onClose,
                        onConfirmSave: () => setShouldShowConfirmCloseDialog(true),
                    })}
                >
                    <MessageInputBase
                        ref={inputRef}
                        messageNoun="comment"
                        isBottomBar={true}
                        withMobileLayout={true}
                        state={state}
                        onChange={setState}
                        onSend={sendComment}
                    />
                </Box>,
                portalElement,
            )}
            {shouldShowConfirmCloseDialog && (
                // Because in our native mobile app `onClose` is never called, the cancel
                // button has the same effect as closing the modal.
                <ModalDialog
                    title="Discard comment?"
                    description="Continuing will discard your comment. Use the send button to save your comment."
                    onClose={() => {
                        // Return focus to the editor if the dialog is closed. This acts as a "cancel"
                        // and lets the user continue writing.
                        shouldFocusNextRenderRef.current = true;
                        setShouldShowConfirmCloseDialog(false);
                    }}
                    primaryButtonLabel="Discard"
                    onPrimaryButtonPress={onClose}
                />
            )}
        </>
    );
}
