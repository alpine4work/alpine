import {Ref, forwardRef, useImperativeHandle, useRef} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {MessageEditing} from "~/client/messaging/message_editing";
import {
    messageViewBubbleBorderRadius,
    messageViewBubbleMergedBorderRadius,
    messageViewBubbleMinWidth,
} from "~/client/messaging/message_view";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {MessageContentWithReferences} from "~/shared/models/message_model";
import {colorSchemeVars, sprinkles} from "~/shared/styles/styles";

export type MessageViewEditorRef = {
    focus(): void;
};

const MessageViewEditorForwardRef = forwardRef(MessageViewEditor) as typeof MessageViewEditor;
export {MessageViewEditorForwardRef as MessageViewEditor};

function MessageViewEditor<RoomKey extends string>(
    {
        messageNoun,
        messageStartOfSentenceNoun,
        shouldMergeWithPreviousMessage,
        shouldMergeWithNextMessage,
        messageEditing,
    }: {
        ref?: Ref<MessageViewEditorRef>;
        messageNoun: string;
        messageStartOfSentenceNoun: string;
        shouldMergeWithPreviousMessage: boolean;
        shouldMergeWithNextMessage: boolean;
        messageEditing: MessageEditing<RoomKey>;
    },
    ref: Ref<MessageViewEditorRef>,
) {
    assert(messageEditing.state.isEditing);

    const state = messageEditing.state.contentEditorState;

    return (
        <FocusRing offset="border" isVisibleWhenFocusWithin={true} isVisibleFromAnyFocus={true}>
            <Box
                pointerEvents="auto"
                maxWidth="160"
                overflow="hidden"
                display="inline-block"
                paddingX="0.5"
                paddingY="1.5"
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
                    boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`,
                }}
            >
                <MessageContentEditor
                    parentRef={ref}
                    messageStartOfSentenceNoun={messageStartOfSentenceNoun}
                    state={state}
                    isSaving={messageEditing.state.isSaving}
                    onChange={state => {
                        messageEditing.dispatch({
                            type: "ContentEditorStateChange",
                            contentEditorState: state,
                        });
                    }}
                    onCancel={() => messageEditing.dispatch({type: "CancelEditing"})}
                    onSave={() => {
                        messageEditing.dispatch({
                            type: "SaveEditedContent",
                            messageNoun,
                        });
                    }}
                />
            </Box>
        </FocusRing>
    );
}

function MessageContentEditor({
    parentRef,
    messageStartOfSentenceNoun,
    state,
    isSaving,
    onChange,
    onCancel,
    onSave,
}: {
    parentRef: Ref<MessageViewEditorRef>;
    messageStartOfSentenceNoun: string;
    state: ContentEditorState<MessageContentWithReferences>;
    isSaving: boolean;
    onChange: (state: ContentEditorState<MessageContentWithReferences>) => void;
    onCancel: () => void;
    onSave: () => void;
}) {
    const editorRef = useRef<ContentEditorRef>(null);

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
            state={state}
            onChange={state => {
                if (isSaving) return;
                onChange(state);
            }}
            aria-label={messageStartOfSentenceNoun}
            // With no content the message bubble will be at its min-width so only render
            // an en-dash as a placeholder.
            placeholder={"\u2013"}
            className={sprinkles({minWidth: messageViewBubbleMinWidth})}
            onEscape={event => {
                event.preventDefault();
                onCancel();
            }}
            onEnterFromPhysicalKeyboard={event => {
                event.preventDefault();
                onSave();
            }}
        />
    );
}
