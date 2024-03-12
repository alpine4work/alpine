import {useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {ContentEditorRef} from "~/client/content/content_editor.js";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {Box} from "~/client/design/box.js";
import {ModalDialog} from "~/client/design/modal_dialog.js";
import {useOverlayRootPortalElement} from "~/client/design/overlay.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/design/use_confirm_save_after_losing_focus.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {MessageInputBase} from "~/client/messaging/message_input.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {
    MessageContentWithReferences,
    emptyMessageContentWithReferences,
} from "~/shared/messaging/message_content_schema.js";

export function ContentEditorMobileCommentInputBottomBar({onClose}: {onClose: () => void}) {
    const rootPortalElement = assertExists(
        useOverlayRootPortalElement(),
        "Can't server render `<ContentEditorMobileCommentInputBottomBar>`",
    );

    const editorRef = useRef<ContentEditorRef<MessageContentWithReferences>>(null);

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

        const editor = assertExists(editorRef.current);
        editor.focus({preventScroll: true});
    }, [shouldShowConfirmCloseDialog]);

    const [isInitialRender, setIsInitialRender] = useState(true);
    useEffect(() => {
        setIsInitialRender(false);
    }, []);

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
                    position="fixed"
                    // Render above everything on the page.
                    zIndex="80"
                    left="0"
                    right="0"
                    style={{
                        // `bottom: "-" + mobileBottomBarKeyboardToolbarHeightRem + "rem"` also
                        // works except for in our Safari app keyboard support which limits the outlet
                        // height to what's visible above the keyboard.
                        bottom: `calc(100svh - var(--space-outlet-height, 100svh))`,
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
                        messageNoun="comment"
                        editorRef={editorRef}
                        isBottomBar={true}
                        withMobileLayout={true}
                        state={state}
                        onChange={setState}
                        onSend={() => {
                            // NOCOMMIT: Implement!
                        }}
                    />
                </Box>,
                rootPortalElement,
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
