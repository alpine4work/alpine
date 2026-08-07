import classNames from "classnames";
import {Ref, useImperativeHandle, useRef} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/web/content/content_editor.js";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/web/design/use_confirm_save_after_losing_focus.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {InlineEditorToolbar} from "~/client/web/messaging/inline_editor_toolbar.js";
import {MessageEditing} from "~/client/web/messaging/message_editing.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {
    messageViewEditorOutlineMarginLeft,
    messageViewNotMergedEditorOutlineMarginBottomPx,
    messageViewNotMergedEditorOutlineMarginTop,
    messageViewOutlineBorderRadius,
    messageViewOutlineMargin,
} from "~/client/web/styles/messaging_shared_styles.js";
import {colorSchemeVars, contentStyles, sprinkles} from "~/client/web/styles/styles.js";
import {MessageContentWithReferences} from "~/shared/content/message_content_schema.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

export type MessageViewEditorRef = {
    focus(): void;
};

export function MessageViewEditor<RoomKey extends string>({
    ref,
    messageStartOfSentenceNoun,
    isLastMessage,
    shouldMergeWithPreviousMessage,
    messageEditing,
}: {
    ref?: Ref<MessageViewEditorRef>;
    messageStartOfSentenceNoun: string;
    isLastMessage: boolean;
    shouldMergeWithPreviousMessage: boolean;
    messageEditing: MessageEditing<RoomKey>;
}) {
    assert(messageEditing.state.isEditing);
    const {state} = messageEditing;

    const spacingScale = useSpacingScale();

    const editorRef = useRef<ContentEditorRef<MessageContentWithReferences>>(null);

    const hasContentChanged = state.contentEditorState.getDoc() !== state.initialContent;

    const hasInitiallyMountedRef = useRef(false);
    useLayoutEffectWithoutServerSideWarning(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        // Avoid `flushSync()` in effect warning by running after a microtask.
        scheduleMicrotask(() => {
            if (!editorRef.current) return;
            const editor = editorRef.current;
            editor.focus();
            editor.selectAll();
        });
    }, []);

    useImperativeHandle(
        ref,
        () => ({
            focus: () => {
                const editor = assertExists(editorRef.current);
                editor.focus();
            },
        }),
        [],
    );

    return (
        <FocusRing offset="border" isVisibleWhenFocusWithin={true} isVisibleFromAnyFocus={true}>
            <Box
                ref={useConfirmSaveAfterLosingFocus({
                    shouldConfirmSave: hasContentChanged,
                    isConfirmingSave:
                        messageEditing.state.isEditing &&
                        messageEditing.state.confirmationDialog === "Save",
                    onCancelSave: () => messageEditing?.dispatch({type: "CancelEditing"}),
                    onConfirmSave: () => messageEditing?.dispatch({type: "MaybeCancelEditing"}),
                })}
                position="relative"
                zIndex="40"
                borderRadius={messageViewOutlineBorderRadius}
                marginRight={`-${messageViewOutlineMargin}`}
                marginY={`-${messageViewOutlineMargin}`}
                style={{
                    marginLeft: `-${messageViewEditorOutlineMarginLeft}`,
                    marginTop: !shouldMergeWithPreviousMessage
                        ? `-${messageViewNotMergedEditorOutlineMarginTop}`
                        : undefined,
                    marginBottom: !shouldMergeWithPreviousMessage
                        ? -messageViewNotMergedEditorOutlineMarginBottomPx[spacingScale]
                        : undefined,
                    // Use box shadow to draw the border so it doesn't add 1px to layout like `border`
                    // CSS would.
                    boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`,
                }}
            >
                <ContentEditor
                    ref={editorRef}
                    state={state.contentEditorState}
                    onChange={(contentEditorState, transaction) => {
                        if (state.isSaving && transaction.docChanged) return;

                        messageEditing.dispatch({
                            type: "ContentEditorStateChange",
                            state: contentEditorState,
                            transaction,
                        });
                    }}
                    aria-label={messageStartOfSentenceNoun}
                    // With no content the message bubble will be at its min-width so only render an
                    // en-dash as a placeholder.
                    placeholder={"\u2013"}
                    // On mobile, don't allow interactions when unfocused. We're already in an editing
                    // modality.
                    withoutMobileDualModality={true}
                    className={classNames(
                        contentStyles.messageDocClassName,
                        sprinkles({
                            paddingRight: messageViewOutlineMargin,
                            paddingY: messageViewOutlineMargin,
                        }),
                    )}
                    style={{
                        paddingLeft: messageViewEditorOutlineMarginLeft,
                        paddingTop: !shouldMergeWithPreviousMessage
                            ? messageViewNotMergedEditorOutlineMarginTop
                            : undefined,
                        paddingBottom: !shouldMergeWithPreviousMessage
                            ? messageViewNotMergedEditorOutlineMarginBottomPx[spacingScale]
                            : undefined,
                    }}
                    onEscapeKeyDown={event => {
                        event.preventDefault();
                        event.stopPropagation();
                        messageEditing.dispatch({type: "CancelEditing"});
                    }}
                    onEnterKeyDownFromPhysicalKeyboard={event => {
                        event.preventDefault();
                        event.stopPropagation();
                        messageEditing.dispatch({type: "SaveEditedContent"});
                    }}
                />
                <InlineEditorToolbar
                    placement={isLastMessage ? "top" : "bottom"}
                    isSaving={messageEditing.state.isSaving}
                    onSave={() => messageEditing.dispatch({type: "SaveEditedContent"})}
                    onCancel={() => messageEditing.dispatch({type: "CancelEditing"})}
                />
            </Box>
        </FocusRing>
    );
}
