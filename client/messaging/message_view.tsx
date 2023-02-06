import {differenceInMinutes} from "date-fns";
import {ArrowArcLeft, DotsThree, SpinnerGap} from "phosphor-react";
import {MutableRefObject, useEffect, useRef, useState} from "react";
import {useFocusVisible, useFocusWithin, usePress} from "react-aria";
import {useNavigate} from "react-router-dom";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {ContentView} from "~/client/content/content_view";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {IconButton} from "~/client/design/icon_button";
import {MenuButton} from "~/client/design/menu_button";
import {ModalDialog} from "~/client/design/modal_dialog";
import {Overlay, OverlayRef} from "~/client/design/overlay";
import {uninterruptedThoughtLimitMs} from "~/client/design/timing_constants";
import {defaultTooltipOffset} from "~/client/design/tooltip";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {MessageEditing} from "~/client/messaging/message_editing";
import {useSpaceContext} from "~/client/spaces/space_context";
import {MessageContent} from "~/shared/content/message_content_schema";
import {RemLength, Spacing, addRemLengths, spacing} from "~/shared/design/spacing";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {
    MessageInterface,
    MessageRoomKeyType,
    MessageWithContentPayloadInterface,
} from "~/shared/models/message_interface";
import {
    colorSchemeVars,
    contentSchemaStyles,
    spinAnimationClassName,
    sprinkles,
} from "~/shared/styles/styles";

const {paragraphFontSize} = contentSchemaStyles;

export const messageViewMinHeight: RemLength = "2.125rem";

/**
 * The buffered height we use for virtualized message views.
 *
 * Calculated by rendering 10,000 `<MessageShimmer>`s and get the height
 * divided by the number of messages. Approximately this value.
 */
export const bufferedMessageViewHeight: RemLength = "4rem";

const messageBubbleMinWidth: Spacing = "6";

const mergeMessageMinuteLimit = 5;

export function MessageView<Message extends MessageInterface>({
    messageNoun = "message",
    messageStartOfSentenceNoun = messageNoun.slice(0).toUpperCase() + messageNoun.slice(1),
    message,
    previousMessage,
    nextMessage,
    messageEditing,
    onDeleteMessage,
}: {
    messageNoun?: string;
    messageStartOfSentenceNoun?: string;
    message: Message;
    previousMessage: Message | null;
    nextMessage: Message | null;
    messageEditing: MessageEditing<MessageRoomKeyType<Message>>;
    onDeleteMessage: () => Promise<void>;
}) {
    const shouldMergeWithPreviousMessage: boolean =
        !!previousMessage &&
        previousMessage.author.id === message.author.id &&
        Math.abs(differenceInMinutes(message.createdTime, previousMessage.createdTime)) <
            mergeMessageMinuteLimit;
    const shouldMergeWithNextMessage: boolean =
        !!nextMessage &&
        nextMessage.author.id === message.author.id &&
        Math.abs(differenceInMinutes(nextMessage.createdTime, message.createdTime)) <
            mergeMessageMinuteLimit;

    // Manually implement hovering state by attaching event listeners (instead of
    // using `useHover()` from `react-aria`). React doesn't deliver a
    // `pointerleave` event when the pointer goes into a portalled element.
    const hoverRef = useRef<HTMLDivElement>(null);
    const [isHovered, setIsHovered] = useState(false);

    useEffect(() => {
        const hoverElement = assertExists(hoverRef.current);

        const handlePointerEnter = () => setIsHovered(true);
        const handlePointerLeave = () => setIsHovered(false);

        hoverElement.addEventListener("pointerenter", handlePointerEnter);
        hoverElement.addEventListener("pointerleave", handlePointerLeave);
        return () => {
            hoverElement.removeEventListener("pointerenter", handlePointerEnter);
            hoverElement.removeEventListener("pointerleave", handlePointerLeave);
        };
    }, []);

    return (
        <Box>
            {!shouldMergeWithPreviousMessage && (
                <Box
                    fontSize="50"
                    fontStyle="truncate"
                    paddingY="0.5"
                    paddingRight="3"
                    color="grey-50"
                    style={{
                        paddingLeft: addRemLengths(
                            spacing["3"],
                            spacing["7"],
                            spacing["2"],
                            spacing["1.5"],
                        ),
                    }}
                >
                    {message.author.name}
                </Box>
            )}
            <Box
                ref={hoverRef}
                display="flex"
                paddingX="3"
                paddingBottom={!shouldMergeWithNextMessage ? "3" : "0.5"}
            >
                <Box flexShrink="0" paddingRight="2">
                    <Box width="7" height="full" display="flex" alignItems="flex-end">
                        {!shouldMergeWithNextMessage && (
                            <AccountAvatar account={message.author} size="7" />
                        )}
                    </Box>
                </Box>
                {message.payload.type === "Content" ? (
                    <MessageWithContentPayloadView
                        messageNoun={messageNoun}
                        messageStartOfSentenceNoun={messageStartOfSentenceNoun}
                        message={
                            message as unknown as MessageWithContentPayloadInterface<
                                MessageRoomKeyType<Message>
                            >
                        }
                        shouldMergeWithPreviousMessage={shouldMergeWithPreviousMessage}
                        shouldMergeWithNextMessage={shouldMergeWithNextMessage}
                        messageEditing={messageEditing}
                        isHovered={isHovered}
                        onDeleteMessage={onDeleteMessage}
                    />
                ) : (
                    <MessageWithDeletedPayloadView
                        messageNoun={messageNoun}
                        shouldMergeWithPreviousMessage={shouldMergeWithPreviousMessage}
                        shouldMergeWithNextMessage={shouldMergeWithNextMessage}
                    />
                )}
            </Box>
        </Box>
    );
}

function MessageWithContentPayloadView<Message extends MessageInterface>({
    messageNoun,
    messageStartOfSentenceNoun,
    message,
    shouldMergeWithPreviousMessage,
    shouldMergeWithNextMessage,
    messageEditing,
    isHovered,
    onDeleteMessage,
}: {
    messageNoun: string;
    messageStartOfSentenceNoun: string;
    message: MessageWithContentPayloadInterface<MessageRoomKeyType<Message>>;
    shouldMergeWithPreviousMessage: boolean;
    shouldMergeWithNextMessage: boolean;
    messageEditing: MessageEditing<MessageRoomKeyType<Message>>;
    isHovered: boolean;
    onDeleteMessage: () => Promise<void>;
}) {
    const navigate = useNavigate();
    const {currentAccount} = useSpaceContext();
    const overlayRef = useRef<OverlayRef>(null);

    const {isFocusVisible} = useFocusVisible({});
    const [isFocusWithinActions, setIsFocusWithinActions] = useState(false);
    const {focusWithinProps: focusWithinActionsProps} = useFocusWithin({
        onFocusWithinChange: setIsFocusWithinActions,
    });
    const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
    const [showDeleteConfirmationDialog, setShowDeleteConfirmationDialog] = useState(false);

    const isEditing =
        messageEditing.state.isEditing &&
        messageEditing.state.messageRoomKey === message.getRoomKey() &&
        messageEditing.state.messageIndex === message.index;

    const isShowingActions =
        !isEditing && (isHovered || (isFocusWithinActions && isFocusVisible) || isMoreMenuOpen);

    const shouldFocusMessageContentEditorRef = useRef(false);

    return (
        <>
            <Overlay
                ref={overlayRef}
                isVisible={isEditing}
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
                        backgroundColor={!isEditing ? "grey-bubble" : undefined}
                        maxWidth="160"
                        overflow="hidden"
                        display="inline-block"
                        paddingX="0.5"
                        paddingY="1.5"
                        borderTopLeftRadius={!shouldMergeWithPreviousMessage ? "xl" : "base"}
                        borderTopRightRadius="xl"
                        borderBottomLeftRadius={!shouldMergeWithNextMessage ? "xl" : "base"}
                        borderBottomRightRadius="xl"
                        style={{
                            boxShadow: isEditing
                                ? `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`
                                : undefined,
                        }}
                    >
                        {!isEditing ? (
                            <ContentView
                                content={message.payload.content}
                                onNavigate={navigate}
                                className={sprinkles({minWidth: messageBubbleMinWidth})}
                            />
                        ) : (
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
                                shouldFocusMessageContentEditorRef={
                                    shouldFocusMessageContentEditorRef
                                }
                            />
                        )}
                    </Box>
                </FocusRing>
            </Overlay>
            <Box
                alignSelf="center"
                paddingLeft="3"
                style={{opacity: isShowingActions ? "1" : "0"}}
                {...focusWithinActionsProps}
            >
                <Box display="flex" pointerEvents={!isShowingActions ? "none" : undefined}>
                    <IconButton description="Reply" size="sm" isDisabled={isEditing}>
                        <ArrowArcLeft />
                    </IconButton>
                    {currentAccount.id === message.author.id && (
                        <MenuButton
                            actions={[
                                {
                                    label: "Edit",
                                    onPress: () => {
                                        shouldFocusMessageContentEditorRef.current = true;
                                        messageEditing.dispatch({
                                            type: "StartEditing",
                                            message,
                                        });
                                    },
                                },
                                {
                                    label: "Delete",
                                    pressErrorTitle: `Couldn’t delete ${messageNoun}`,
                                    onPress: () => {
                                        setShowDeleteConfirmationDialog(true);
                                    },
                                },
                            ]}
                            onStateChange={state => setIsMoreMenuOpen(state.isExpanded)}
                        >
                            <IconButton description="More" size="sm" isDisabled={isEditing}>
                                <DotsThree />
                            </IconButton>
                        </MenuButton>
                    )}
                </Box>
            </Box>
            {showDeleteConfirmationDialog && (
                <MessageDeleteConfirmationDialog
                    messageNoun={messageNoun}
                    onClose={() => setShowDeleteConfirmationDialog(false)}
                    onDeleteMessage={onDeleteMessage}
                />
            )}
        </>
    );
}

function MessageDeleteConfirmationDialog({
    messageNoun,
    onClose,
    onDeleteMessage,
}: {
    messageNoun: string;
    onClose: () => void;
    onDeleteMessage: () => Promise<void>;
}) {
    return (
        <ModalDialog
            title={`Delete ${messageNoun}`}
            description={`Others may have already seen the ${messageNoun}. Everyone will still be able to see that you sent a ${messageNoun} and the time you sent it, but they will not be able to see what was in the ${messageNoun}.`}
            onClose={onClose}
            isPrimaryButtonDestructive={true}
            primaryButtonLabel="Delete"
            primaryButtonPressErrorTitle={`Couldn’t delete ${messageNoun}`}
            onPrimaryButtonPress={onDeleteMessage}
        />
    );
}

function MessageWithDeletedPayloadView({
    messageNoun,
    shouldMergeWithPreviousMessage,
    shouldMergeWithNextMessage,
}: {
    messageNoun: string;
    shouldMergeWithPreviousMessage: boolean;
    shouldMergeWithNextMessage: boolean;
}) {
    return (
        <Box
            paddingX="0.5"
            paddingY="1.5"
            display="flex"
            alignItems="center"
            borderTopLeftRadius={!shouldMergeWithPreviousMessage ? "xl" : "base"}
            borderTopRightRadius="xl"
            borderBottomLeftRadius={!shouldMergeWithNextMessage ? "xl" : "base"}
            borderBottomRightRadius="xl"
            userSelect="text"
            style={{
                boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`,
            }}
        >
            <Box
                paddingX="2"
                color="grey-40"
                fontSize="75"
                style={{lineHeight: paragraphFontSize.lineHeight}}
            >
                {`Deleted ${messageNoun}`}
            </Box>
        </Box>
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
            className={sprinkles({minWidth: messageBubbleMinWidth})}
            onEscape={onEscape}
            onEnter={onSave}
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
        }, uninterruptedThoughtLimitMs);
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
