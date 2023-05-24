import {Check, KeyReturn, SpinnerGap, X} from "phosphor-react";
import {Ref, forwardRef, useEffect, useImperativeHandle, useRef, useState} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {useOutsidePress} from "~/client/design/helpers/use_outside_press";
import {IconButton} from "~/client/design/icon_button";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants";
import {isElementOwnedBy} from "~/client/helpers/elements/is_element_owned_by";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {MessageEditing} from "~/client/messaging/message_editing";
import {
    messageViewActionsWidth,
    messageViewBubbleMergedBorderRadius,
    messageViewBubbleMinWidth,
} from "~/client/messaging/message_view";
import {spacing} from "~/shared/design/spacing";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {MessageContentWithReferences} from "~/shared/messaging/message_model";
import {messageViewBubbleBorderRadius} from "~/shared/messaging/messaging_shared_styles";
import {colorSchemeVars, spinAnimationClassName, sprinkles} from "~/shared/styles/styles";

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
            onBlur={event => {
                // Ignore blur events where focus is moving within the element.
                //
                // We need to use element ownership instead of `document.body.contains()` to
                // handle modals.
                if (
                    event.relatedTarget &&
                    isElementOwnedBy(event.currentTarget, event.relatedTarget)
                ) {
                    return;
                }

                messageEditing?.dispatch({
                    type: "MaybeCancelEditing",
                });
            }}
            // Sometimes clicks outside an element do not move focus. So in addition to
            // `onBlur`, look for any clicks and show a confirmation dialog before closing
            // our input.
            ref={useOutsidePress(event => {
                // The user may click within the save confirmation dialog.
                if (
                    messageEditing.state.isEditing &&
                    messageEditing.state.confirmationDialog === "Save"
                ) {
                    return;
                }

                // If the user didn't update their content then let the click through.
                if (state.contentEditorState.getDoc() === state.initialContent) {
                    messageEditing?.dispatch({
                        type: "MaybeCancelEditing",
                    });
                    return;
                }

                // Cancel the outside press and ask the user to confirm first.
                event.preventDefault();
                event.stopPropagation();
                messageEditing?.dispatch({
                    type: "MaybeCancelEditing",
                });
            })}
        >
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
                            messageEditing.dispatch({
                                type: "SaveEditedContent",
                                messageNoun,
                            });
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

    // We wait a bit before showing our pending spinner. Some actions are very fast so we
    // delay showing a spinner to avoid a loading spinner flicker which can be jarring.
    const [_shouldShowSavingSpinner, setShouldShowSavingSpinner] = useState(false);
    useEffect(() => {
        if (!isSaving) {
            setShouldShowSavingSpinner(false);
            return;
        }

        const timeout = createTimeout(() => {
            setShouldShowSavingSpinner(true);
        }, delayLoadingIndicatorLimitMs);
        return () => {
            timeout.clear();
        };
    }, [isSaving]);

    // Only show the saving spinner if we are actually saving.
    const shouldShowSavingSpinner = _shouldShowSavingSpinner && isSaving;

    return (
        <Box display="flex">
            {shouldShowSavingSpinner ? (
                <SpinnerGap className={spinAnimationClassName} size={spacing["3"]} />
            ) : (
                <>
                    <IconButton
                        description="Save"
                        keyboardShortcutHint={<KeyReturn />}
                        size="sm"
                        onPress={() => {
                            messageEditing.dispatch({
                                type: "SaveEditedContent",
                                messageNoun,
                            });
                        }}
                        isDisabled={isSaving}
                    >
                        <Check />
                    </IconButton>
                    <IconButton
                        description="Cancel"
                        keyboardShortcutHint="esc"
                        size="sm"
                        onPress={() => messageEditing.dispatch({type: "CancelEditing"})}
                        isDisabled={isSaving}
                    >
                        <X />
                    </IconButton>
                </>
            )}
        </Box>
    );
}
