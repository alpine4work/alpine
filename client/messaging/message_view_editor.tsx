import {MutableRefObject, useRef} from "react";
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
import {MessageContent} from "~/shared/content/message_content_schema";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {colorSchemeVars, sprinkles} from "~/shared/styles/styles";

export function MessageViewEditor<RoomKey extends string>({
    messageNoun,
    messageStartOfSentenceNoun,
    shouldMergeWithPreviousMessage,
    shouldMergeWithNextMessage,
    messageEditing,
    shouldFocusMessageContentEditorRef,
}: {
    messageNoun: string;
    messageStartOfSentenceNoun: string;
    shouldMergeWithPreviousMessage: boolean;
    shouldMergeWithNextMessage: boolean;
    messageEditing: MessageEditing<RoomKey>;
    shouldFocusMessageContentEditorRef: MutableRefObject<boolean>;
}) {
    assert(messageEditing.state.isEditing);

    return (
        <FocusRing offset="border" isVisibleWhenFocusWithin={true} isVisibleFromAnyFocus={true}>
            <Box
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
                    messageStartOfSentenceNoun={messageStartOfSentenceNoun}
                    state={messageEditing.state.contentEditorState}
                    isSaving={messageEditing.state.isSaving}
                    onChange={state => {
                        messageEditing.dispatch({
                            type: "ContentEditorStateChange",
                            contentEditorState: state,
                        });
                    }}
                    onEscape={() => messageEditing.dispatch({type: "CancelEditing"})}
                    onSave={() =>
                        messageEditing.dispatch({
                            type: "SaveEditedContent",
                            messageNoun,
                        })
                    }
                    shouldFocusMessageContentEditorRef={shouldFocusMessageContentEditorRef}
                />
            </Box>
        </FocusRing>
    );
}

function MessageContentEditor({
    messageStartOfSentenceNoun,
    state,
    isSaving,
    onChange,
    onEscape,
    onSave,
    shouldFocusMessageContentEditorRef,
}: {
    messageStartOfSentenceNoun: string;
    state: ContentEditorState<MessageContent>;
    isSaving: boolean;
    onChange: (state: ContentEditorState<MessageContent>) => void;
    onEscape: () => void;
    onSave: () => void;
    shouldFocusMessageContentEditorRef: MutableRefObject<boolean>;
}) {
    const editorRef = useRef<ContentEditorRef>(null);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!shouldFocusMessageContentEditorRef.current) return;
        shouldFocusMessageContentEditorRef.current = false;

        const editor = assertExists(editorRef.current);
        editor.focus();
        editor.selectAll();
    });

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
            onEscape={onEscape}
            onEnterFromPhysicalKeyboard={onSave}
        />
    );
}
