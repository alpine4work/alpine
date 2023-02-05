import {differenceInMinutes} from "date-fns";
import {ArrowArcLeft, DotsThree} from "phosphor-react";
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
import {Overlay, OverlayRef} from "~/client/design/overlay";
import {defaultTooltipOffset} from "~/client/design/tooltip";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {MessageEditing} from "~/client/messaging/message_editing";
import {useSpaceContext} from "~/client/spaces/space_context";
import {MessageContent} from "~/shared/content/message_content_schema";
import {RemLength, Spacing, addRemLengths, spacing} from "~/shared/design/spacing";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {
    MessageInterface,
    MessageWithContentPayloadInterface,
} from "~/shared/models/message_interface";
import {colorSchemeVars, sprinkles} from "~/shared/styles/styles";

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

export function MessageView({
    message,
    previousMessage,
    nextMessage,
    messageEditing,
    onDeleteMessage,
}: {
    message: MessageInterface;
    previousMessage: MessageInterface | null;
    nextMessage: MessageInterface | null;
    messageEditing: MessageEditing;
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
                        message={message as MessageWithContentPayloadInterface}
                        shouldMergeWithPreviousMessage={shouldMergeWithNextMessage}
                        shouldMergeWithNextMessage={shouldMergeWithNextMessage}
                        messageEditing={messageEditing}
                        isHovered={isHovered}
                        onDeleteMessage={onDeleteMessage}
                    />
                ) : null}
            </Box>
        </Box>
    );
}

function MessageWithContentPayloadView({
    message,
    shouldMergeWithPreviousMessage,
    shouldMergeWithNextMessage,
    messageEditing,
    isHovered,
    onDeleteMessage,
}: {
    message: MessageWithContentPayloadInterface;
    shouldMergeWithPreviousMessage: boolean;
    shouldMergeWithNextMessage: boolean;
    messageEditing: MessageEditing;
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
                                state={messageEditing.state.contentEditorState}
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
                                    pressErrorTitle: "Couldn’t delete comment",
                                    // TODO(calebmer): Add a modal confirmation screen.
                                    onPress: onDeleteMessage,
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
        </>
    );
}

function MessageContentEditor({
    state,
    onChange,
    onEscape,
    shouldFocusMessageContentEditorRef,
}: {
    state: ContentEditorState<MessageContent>;
    onChange: (state: ContentEditorState<MessageContent>) => void;
    onEscape: () => void;
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
            onChange={onChange}
            aria-label="Comment"
            // With no content the comment bubble will be at its min-width so only render
            // an en-dash as a placeholder.
            placeholder={"\u2013"}
            onNavigate={useNavigate()}
            className={sprinkles({minWidth: messageBubbleMinWidth})}
            onEscape={onEscape}
        />
    );
}

function MessageContentEditorInstructionsOverlay({
    messageEditing,
}: {
    messageEditing: MessageEditing;
}) {
    const {isPressed: isSavePressed, pressProps: savePressProps} = usePress({
        onPress: () => {
            // TODO(calebmer): Implement!
        },
    });

    const {isPressed: isCancelPressed, pressProps: cancelPressProps} = usePress({
        onPress: () => {
            messageEditing.dispatch({type: "CancelEditing"});
        },
    });

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
