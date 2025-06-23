import {EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {Memo, RefObject, useEffect, useMemo, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {MessageInputFile} from "~/client/content/messaging/add_message_input_files.js";
import {MessageInputBase, MessageInputRef} from "~/client/content/messaging/message_input_base.js";
import {
    ContentEditorState,
    createContentCommentThreadMetaKey,
    updateContentEditorReferences,
} from "~/client/content/state/content_editor_state.js";
import {Box} from "~/client/design/box.js";
import {ModalDialog} from "~/client/design/modal_dialog.js";
import {useOverlayRootPortalElement} from "~/client/design/overlay_helpers.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/design/use_confirm_save_after_losing_focus.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {trimContentWithReferencesEnd} from "~/shared/content/trim_content.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
import {emptyMessageContentWithReferences} from "~/shared/messaging/message_content_schema.js";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range.js";

export function ContentEditorMobileCommentInputBottomBar({
    state: documentState,
    viewRef: documentViewRef,
    onClose: onCloseProp,
    fileAttachmentTarget,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    onClose: () => void;
    fileAttachmentTarget: Memo<FileAttachmentTarget>;
}) {
    const portalElement = assertExists(
        useOverlayRootPortalElement(),
        "Can’t server render `<ContentEditorMobileCommentInputBottomBar>`",
    );

    const {currentAccount} = useSpaceContext();

    const inputRef = useRef<MessageInputRef>(null);

    const [commentState, setCommentState] = useState(() =>
        ContentEditorState.create(emptyMessageContentWithReferences),
    );
    const [files, setFiles] = useState<ReadonlyArray<MessageInputFile>>(emptyArray);
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

    const onClose = () => {
        // Courtesy blur call. Useful on mobile Safari since if the focused element is
        // removed from the DOM there won't be a `focusout` event. So
        // `useIsTextInputFocused()` won't update and the "Done" button will continue
        // to show in the navigation bar.
        assertExists(inputRef.current).blur();

        onCloseProp();
    };

    const isNodeDocumentRange = useMemo(() => {
        if (documentState.selection.from === documentState.selection.to - 1) {
            const documentRangeNode = documentState.doc.resolve(
                documentState.selection.from,
            ).nodeAfter;

            if (
                documentRangeNode &&
                !documentRangeNode.inlineContent &&
                documentRangeNode.type.allowsMarkType(documentState.schema.marks.comment!)
            ) {
                return true;
            }
        }

        return false;
    }, [
        documentState.doc,
        documentState.schema.marks.comment,
        documentState.selection.from,
        documentState.selection.to,
    ]);

    const sendComment = () => {
        const content = trimContentWithReferencesEnd(commentState.getContent());
        if (isContentEmpty(content.doc) && files.length === 0) return;

        const commentThreadId = generateId<DocumentCommentThreadId>();
        const trimmedDocumentRange = trimSpacesFromProsemirrorRange(
            documentState.doc,
            documentState.selection,
        );

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

        transaction.setMeta(createContentCommentThreadMetaKey, {
            commentThreadId,
            initialCommentContent: content,
            initialCommentFileIds: files.map(file =>
                file.type === "FileEntity" ? file.fileEntityId : file.file.id,
            ),
        });

        transaction.scrollIntoView();

        updateContentEditorReferences(transaction, {
            type: "UpdateDocumentCommentThread",
            commentThreadId,
            commentCount: 1,
            addCommentAuthor: currentAccount,
        });

        assertExists(documentViewRef.current).dispatch(transaction);

        onClose();
    };

    return (
        <>
            <Box
                position="absolute"
                // Render above everything on the page.
                zIndex="70"
                inset="0"
                backgroundColor="grey-100-const"
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
                        shouldConfirmSave: !isContentEmpty(commentState.getDoc()),
                        isConfirmingSave: shouldShowConfirmCloseDialog,
                        onCancelSave: onClose,
                        onConfirmSave: () => setShouldShowConfirmCloseDialog(true),
                    })}
                >
                    <MessageInputBase
                        ref={inputRef}
                        messageNoun="comment"
                        sendButtonVerb="Save"
                        isBottomBar={true}
                        // We're replacing `<ContentEditorMobileKeyboardToolbar>`. This makes it so
                        // `useScrollToAvoidBottomBarsAndMobileKeyboard()` doesn't ignore the initial
                        // mount of this bottom bar.
                        isReplacingOtherBottomBar={true}
                        // The refocus hack calls `blur()` ~0.3s after focusing. Calling blur causes us
                        // to close the comment input. Ideally we could get rid of the hack and find
                        // a different way to achieve the same effect. See the comment above the hack
                        // for more info.
                        isNativeMobileRefocusHackDisabled={true}
                        state={commentState}
                        onChange={setCommentState}
                        onSend={sendComment}
                        fileAttachmentTarget={fileAttachmentTarget}
                        files={files}
                        onAddFile={file => setFiles(files => [...files, file])}
                        onRemoveFile={fileKey =>
                            setFiles(files => files.filter(otherFile => otherFile.key !== fileKey))
                        }
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
