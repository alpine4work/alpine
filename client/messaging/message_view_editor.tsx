import {SpinnerGap} from "phosphor-react";
import {MutableRefObject, useEffect, useRef, useState} from "react";
import {usePress} from "react-aria";
import {useNavigate} from "react-router-dom";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {Overlay, OverlayRef} from "~/client/design/overlay";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants";
import {defaultTooltipOffset} from "~/client/design/tooltip";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {MessageEditing} from "~/client/messaging/message_editing";
import {
    messageViewBubbleBorderRadius,
    messageViewBubbleMergedBorderRadius,
    messageViewBubbleMinWidth,
} from "~/client/messaging/message_view";
import {MessageContent} from "~/shared/content/message_content_schema";
import {spacing} from "~/shared/design/spacing";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {colorSchemeVars, spinAnimationClassName, sprinkles} from "~/shared/styles/styles";

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

    const overlayRef = useRef<OverlayRef>(null);

    return (
        <Overlay
            ref={overlayRef}
            isVisible={true}
            placement="bottom-start"
            canFlip={false}
            preventOverflow={false}
            sameWidth={true}
            offset={defaultTooltipOffset}
            overlay={
                <Box>
                    <Box display="flex" marginX="-3">
                        <Box flexGrow="1" pointerEvents="none" />
                        <MessageContentEditorInstructionsOverlay
                            messageNoun={messageNoun}
                            messageEditing={messageEditing}
                        />
                    </Box>
                </Box>
            }
        >
            <FocusRing isVisibleWhenFocusWithin={true}>
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
                            // Update the overlay position whenever our content state changes.
                            // Needs to be in an animation frame to get the correct measurements.
                            requestAnimationFrame(() => {
                                const overlay = assertExists(overlayRef.current);
                                overlay.forceUpdateOverlayPosition();
                            });

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
        </Overlay>
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
            onNavigate={useNavigate()}
            className={sprinkles({minWidth: messageViewBubbleMinWidth})}
            onEscape={onEscape}
            onEnterFromPhysicalKeyboard={onSave}
        />
    );
}

function MessageContentEditorInstructionsOverlay<RoomKey extends string>({
    messageNoun,
    messageEditing,
}: {
    messageNoun: string;
    messageEditing: MessageEditing<RoomKey>;
}) {
    const isSaving = messageEditing.state.isEditing && messageEditing.state.isSaving;

    const {isPressed: isSavePressed, pressProps: savePressProps} = usePress({
        isDisabled: isSaving,
        onPress: () => messageEditing.dispatch({type: "SaveEditedContent", messageNoun}),
    });

    const {isPressed: isCancelPressed, pressProps: cancelPressProps} = usePress({
        onPress: () => messageEditing.dispatch({type: "CancelEditing"}),
    });

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
        <Box
            flexShrink="0"
            paddingX="1.5"
            paddingY="0.5"
            fontSize="75"
            color="grey-0-const"
            backgroundColor="grey-80-const"
            border={{light: "grey-80-const", dark: "grey-70-const"}}
            borderRadius="sm"
            boxShadow="elevation-20"
            display="flex"
            gap="1.5"
        >
            <Box display="flex" gap="0.5" alignItems="center">
                <Box>
                    <Box
                        // NOTE(calebmer): This element is pressable but not focusable. This is
                        // intentional. There's a keyboard shortcut which we write next to the button
                        // for keyboard users. We also don't give much visual affordance that this
                        // button is actually clickable since we expect the primary interaction here
                        // will be with the keyboard. On hover you get a cursor and that's the only
                        // indication that this is clickable.
                        {...savePressProps}
                        display="inline"
                        color={isSavePressed ? "grey-10-const" : "grey-0-const"}
                        style={{cursor: "pointer"}}
                    >
                        Save
                    </Box>{" "}
                    <Box display="inline" color="grey-20-const">
                        (enter)
                    </Box>
                </Box>
                {shouldShowSavingSpinner && (
                    <SpinnerGap className={spinAnimationClassName} size={spacing["3"]} />
                )}
            </Box>
            <Box paddingY="0.5">
                <Box height="full" borderLeft="grey-70-const" />
            </Box>
            <Box>
                <Box
                    {...cancelPressProps}
                    display="inline"
                    color={isCancelPressed ? "grey-10-const" : "grey-0-const"}
                    style={{cursor: "pointer"}}
                >
                    Cancel
                </Box>{" "}
                <Box display="inline" color="grey-20-const">
                    (esc)
                </Box>
            </Box>
        </Box>
    );
}
