import {Check, X} from "phosphor-react";
import {Ref, forwardRef, useImperativeHandle, useRef} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor.js";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {IconButton} from "~/client/design/icon_button.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/design/use_confirm_save_after_losing_focus.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {MessageEditing} from "~/client/messaging/message_editing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {MessageContentWithReferences} from "~/shared/messaging/message_content_schema.js";
import {
    messageViewActionsWidth,
    messageViewBubbleBorderRadius,
    messageViewBubbleMergedBorderRadius,
    messageViewBubbleMinWidth,
    messageViewBubblePaddingX,
    messageViewBubblePaddingY,
} from "~/shared/styles/messaging_shared_styles.js";
import {colorSchemeVars, sprinkles} from "~/shared/styles/styles.js";

export type MessageViewEditorRef = {
    focus(): void;
};

const MessageViewEditorForwardRef = forwardRef(MessageViewEditor) as typeof MessageViewEditor;
export {MessageViewEditorForwardRef as MessageViewEditor};

function MessageViewEditor<RoomKey extends string>(
    {
        withMobileLayout,
        messageNoun,
        messageStartOfSentenceNoun,
        shouldMergeWithPreviousMessage,
        shouldMergeWithNextMessage,
        messageEditing,
    }: {
        ref?: Ref<MessageViewEditorRef>;
        withMobileLayout: boolean;
        messageNoun: string;
        messageStartOfSentenceNoun: string;
        shouldMergeWithPreviousMessage: boolean;
        shouldMergeWithNextMessage: boolean;
        messageEditing: MessageEditing<RoomKey>;
    },
    ref: Ref<MessageViewEditorRef>,
) {
    assert(messageEditing.state.isEditing);
    const {state} = messageEditing;

    return (
        <Box
            flexGrow="1"
            overflow="hidden"
            display="flex"
            position="relative"
            zIndex="10"
            // No pointer events so if we are a small message rendering on top of a large
            // parent message then the part of the parent message that underlaps our
            // message bubble is clickable.
            pointerEvents="none"
            ref={useConfirmSaveAfterLosingFocus({
                shouldConfirmSave: state.contentEditorState.getDoc() !== state.initialContent,
                isConfirmingSave:
                    messageEditing.state.isEditing &&
                    messageEditing.state.confirmationDialog === "Save",
                onCancelSave: () => messageEditing?.dispatch({type: "CancelEditing"}),
                onConfirmSave: () => messageEditing?.dispatch({type: "MaybeCancelEditing"}),
            })}
        >
            <FocusRing offset="border" isVisibleWhenFocusWithin={true} isVisibleFromAnyFocus={true}>
                <Box
                    pointerEvents="auto"
                    maxWidth="160"
                    overflow="hidden"
                    display="inline-block"
                    paddingX={messageViewBubblePaddingX}
                    paddingY={messageViewBubblePaddingY}
                    backgroundColor="grey-0"
                    borderTopLeftRadius={
                        !shouldMergeWithPreviousMessage
                            ? messageViewBubbleBorderRadius
                            : messageViewBubbleMergedBorderRadius
                    }
                    borderTopRightRadius={messageViewBubbleBorderRadius}
                    borderBottomLeftRadius={
                        !shouldMergeWithNextMessage
                            ? messageViewBubbleBorderRadius
                            : messageViewBubbleMergedBorderRadius
                    }
                    borderBottomRightRadius={messageViewBubbleBorderRadius}
                    style={{
                        // Use box shadow to draw the border so it doesn't add 1px to layout like
                        // `border` CSS would.
                        boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`,
                    }}
                >
                    <MessageContentEditor
                        withMobileLayout={withMobileLayout}
                        parentRef={ref}
                        messageStartOfSentenceNoun={messageStartOfSentenceNoun}
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
                </Box>
            </FocusRing>
            <Box alignSelf="center" paddingLeft="3" pointerEvents="auto">
                <Box width={messageViewActionsWidth} position="relative" zIndex="20">
                    <MessageViewEditorActions
                        messageNoun={messageNoun}
                        messageEditing={messageEditing}
                    />
                </Box>
            </Box>
        </Box>
    );
}

function MessageContentEditor({
    withMobileLayout,
    parentRef,
    messageStartOfSentenceNoun,
    state,
    isSaving,
    onChange,
    onCancel,
    onSave,
}: {
    withMobileLayout: boolean;
    parentRef: Ref<MessageViewEditorRef>;
    messageStartOfSentenceNoun: string;
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

        const editor = assertExists(editorRef.current);
        editor.focus();
        editor.selectAll();
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
            withMobileLayout={withMobileLayout}
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
            className={sprinkles({minWidth: messageViewBubbleMinWidth})}
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

function MessageViewEditorActions<RoomKey extends string>({
    messageEditing,
    messageNoun,
}: {
    messageNoun: string;
    messageEditing: MessageEditing<RoomKey>;
}) {
    assert(messageEditing.state.isEditing);
    const isSaving = messageEditing.state.isSaving;

    return (
        <Box display="flex">
            <IconButton
                description="Save"
                keyboardShortcutHint="Enter"
                size="sm"
                onPress={() => {
                    messageEditing.dispatch({type: "SaveEditedContent"});
                }}
                isDisabled={isSaving}
                isPending={isSaving}
            >
                <Check />
            </IconButton>
            <IconButton
                description="Cancel"
                keyboardShortcutHint="Esc"
                size="sm"
                onPress={() => messageEditing.dispatch({type: "CancelEditing"})}
                isDisabled={isSaving}
            >
                <X />
            </IconButton>
        </Box>
    );
}
