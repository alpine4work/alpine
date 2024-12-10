import {Ref, forwardRef, useImperativeHandle, useRef} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor.js";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/design/use_confirm_save_after_losing_focus.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {InlineEditorToolbar} from "~/client/messaging/inline_editor_toolbar.js";
import {MessageEditing} from "~/client/messaging/message_editing.js";
import {
    messageViewEditorOutlineMarginLeft,
    messageViewNotMergedEditorOutlineMarginBottom,
    messageViewNotMergedEditorOutlineMarginTop,
    messageViewOutlineBorderRadius,
    messageViewOutlineMarginX,
    messageViewOutlineMarginY,
} from "~/client/styles/messaging_shared_styles.js";
import {colorSchemeVars, sprinkles} from "~/client/styles/styles.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {MessageContentWithReferences} from "~/shared/messaging/message_content_schema.js";

export type MessageViewEditorRef = {
    focus(): void;
};

const MessageViewEditorForwardRef = forwardRef(MessageViewEditor) as typeof MessageViewEditor;
export {MessageViewEditorForwardRef as MessageViewEditor};

function MessageViewEditor<RoomKey extends string>(
    {
        messageStartOfSentenceNoun,
        shouldMergeWithPreviousMessage,
        messageEditing,
    }: {
        ref?: Ref<MessageViewEditorRef>;
        messageStartOfSentenceNoun: string;
        shouldMergeWithPreviousMessage: boolean;
        messageEditing: MessageEditing<RoomKey>;
    },
    ref: Ref<MessageViewEditorRef>,
) {
    assert(messageEditing.state.isEditing);
    const {state} = messageEditing;

    return (
        <FocusRing offset="border" isVisibleWhenFocusWithin={true} isVisibleFromAnyFocus={true}>
            <Box
                ref={useConfirmSaveAfterLosingFocus({
                    shouldConfirmSave: state.contentEditorState.getDoc() !== state.initialContent,
                    isConfirmingSave:
                        messageEditing.state.isEditing &&
                        messageEditing.state.confirmationDialog === "Save",
                    onCancelSave: () => messageEditing?.dispatch({type: "CancelEditing"}),
                    onConfirmSave: () => messageEditing?.dispatch({type: "MaybeCancelEditing"}),
                })}
                position="relative"
                zIndex="40"
                borderRadius={messageViewOutlineBorderRadius}
                marginRight={`-${messageViewOutlineMarginX}`}
                marginY={`-${messageViewOutlineMarginY}`}
                style={{
                    marginLeft: `-${messageViewEditorOutlineMarginLeft}`,
                    marginTop: !shouldMergeWithPreviousMessage
                        ? `-${messageViewNotMergedEditorOutlineMarginTop}`
                        : undefined,
                    marginBottom: !shouldMergeWithPreviousMessage
                        ? `-${messageViewNotMergedEditorOutlineMarginBottom}`
                        : undefined,
                    // Use box shadow to draw the border so it doesn't add 1px to layout like
                    // `border` CSS would.
                    boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`,
                }}
            >
                <MessageContentEditor
                    parentRef={ref}
                    messageStartOfSentenceNoun={messageStartOfSentenceNoun}
                    shouldMergeWithPreviousMessage={shouldMergeWithPreviousMessage}
                    state={state.contentEditorState}
                    isSaving={state.isSaving}
                    onChange={state => {
                        messageEditing.dispatch({
                            type: "ContentEditorStateChange",
                            contentEditorState: state,
                        });
                    }}
                    onCancel={() => messageEditing.dispatch({type: "CancelEditing"})}
                    onSave={() => {
                        messageEditing.dispatch({type: "SaveEditedContent"});
                    }}
                />
                <InlineEditorToolbar
                    isSaving={messageEditing.state.isSaving}
                    onSave={() => messageEditing.dispatch({type: "SaveEditedContent"})}
                    onCancel={() => messageEditing.dispatch({type: "CancelEditing"})}
                />
            </Box>
        </FocusRing>
    );
}

function MessageContentEditor({
    parentRef,
    messageStartOfSentenceNoun,
    shouldMergeWithPreviousMessage,
    state,
    isSaving,
    onChange,
    onCancel,
    onSave,
}: {
    parentRef: Ref<MessageViewEditorRef>;
    messageStartOfSentenceNoun: string;
    shouldMergeWithPreviousMessage: boolean;
    state: ContentEditorState<MessageContentWithReferences>;
    isSaving: boolean;
    onChange: (state: ContentEditorState<MessageContentWithReferences>) => void;
    onCancel: () => void;
    onSave: () => void;
}) {
    const editorRef = useRef<ContentEditorRef<MessageContentWithReferences>>(null);

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
        parentRef,
        () => ({
            focus: () => {
                const editor = assertExists(editorRef.current);
                editor.focus();
            },
        }),
        [],
    );

    return (
        <ContentEditor
            ref={editorRef}
            state={state}
            onChange={(state, transaction) => {
                if (isSaving && transaction.docChanged) return;
                onChange(state);
            }}
            aria-label={messageStartOfSentenceNoun}
            // With no content the message bubble will be at its min-width so only render
            // an en-dash as a placeholder.
            placeholder={"\u2013"}
            // On mobile, don't allow interactions when unfocused. We're already in an
            // editing modality.
            withoutMobileDualModality={true}
            className={sprinkles({
                paddingRight: messageViewOutlineMarginX,
                paddingY: messageViewOutlineMarginY,
            })}
            style={{
                paddingLeft: messageViewEditorOutlineMarginLeft,
                paddingTop: !shouldMergeWithPreviousMessage
                    ? messageViewNotMergedEditorOutlineMarginTop
                    : undefined,
                paddingBottom: !shouldMergeWithPreviousMessage
                    ? messageViewNotMergedEditorOutlineMarginBottom
                    : undefined,
            }}
            onEscape={event => {
                event.preventDefault();
                event.stopPropagation();
                onCancel();
            }}
            onEnterFromPhysicalKeyboard={event => {
                event.preventDefault();
                event.stopPropagation();
                onSave();
            }}
        />
    );
}
