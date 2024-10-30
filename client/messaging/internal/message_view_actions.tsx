import {ArrowArcLeft, DotsThree, IconContext} from "phosphor-react";
import {ReactNode, Ref, forwardRef, useRef, useState} from "react";
import {mergeProps, useFocusVisible, useFocusWithin, useHover, usePress} from "react-aria";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {MenuAction} from "~/client/design/menu.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {Tooltip} from "~/client/design/tooltip.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {MessageViewMenuCreatedTime} from "~/client/messaging/internal/message_view_menu_created_time.js";
import {MessageEditing} from "~/client/messaging/message_editing.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    messageView2AvatarSize,
    messageView2RailGap,
} from "~/client/styles/messaging_shared_styles.js";
import {
    greyElevated2ClassName,
    overlayFadeOutAnimationDurationMs,
    sprinkles,
} from "~/client/styles/styles.js";
import {addRemLengths, spacing, subtractRemLengths} from "~/shared/design/core/spacing.js";
import {perceivedAsInstantLimitMs} from "~/shared/design/core/timing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {MessageContentPayloadModel, MessageModel} from "~/shared/messaging/message_model.js";

export function MessageViewActions<RoomKey extends string>({
    messageNoun,
    message,
    messagePayload,
    messageEditing,
    isHovered,
    onReplyToMessage,
    onShowDeleteConfirmationDialog,
    getMessageUrl,
}: {
    messageNoun: string;
    message: MessageModel<RoomKey>;
    messagePayload: MessageContentPayloadModel;
    messageEditing: MessageEditing<RoomKey>;
    isHovered: boolean;
    onReplyToMessage: () => void;
    onShowDeleteConfirmationDialog: () => void;
    getMessageUrl: (messageIndex: number) => URL;
}) {
    const isMobile = useIsMobile();
    const {currentAccount} = useSpaceContext();

    const {isFocusVisible} = useFocusVisible({});
    const [isFocusWithinActions, setIsFocusWithinActions] = useState(false);
    const {focusWithinProps: focusWithinActionsProps} = useFocusWithin({
        onFocusWithinChange: setIsFocusWithinActions,
    });

    const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
    const setIsMoreMenuOpenTimeoutRef = useRef<Timeout | null>(null);

    const isShowingActions =
        isHovered || (isFocusWithinActions && isFocusVisible) || isMoreMenuOpen;

    const actions: Array<MenuAction> = [];

    actions.push({
        label: "Copy link",
        pressErrorTitle: `Couldn’t copy ${messageNoun} link`,
        onPress: async () => {
            await writeTextToClipboard(getMessageUrl(message.index).toString());
        },
    });

    if (currentAccount.id === message.author.id) {
        actions.push({
            label: "Edit",
            onPress: () => {
                messageEditing.dispatch({
                    type: "StartEditing",
                    messageIndex: message.index,
                    messageRoomKey: message.getRoomKey(),
                    messagePayload,
                    isMobile,
                    returnFocusAfterEditing: null,
                });
            },
        });

        actions.push({
            label: "Delete",
            pressErrorTitle: `Couldn’t delete ${messageNoun}`,
            onPress: onShowDeleteConfirmationDialog,
        });
    }

    return (
        <>
            {/* NOCOMMIT: Need something to see message bounds? <Box
                position="absolute"
                zIndex="-10"
                top="-1"
                bottom="-1"
                right="-0.5"
                backgroundColor="grey-5"
                pointerEvents="none"
                opacity={isShowingActions ? "50" : "0"}
                borderRadius="1"
                style={{
                    left: subtractRemLengths(
                        addRemLengths(
                            spacing[messageView2AvatarSize],
                            spacing[messageView2RailGap],
                        ),
                        spacing["1.5"],
                    ),
                }}
            /> */}
            <Box
                position="absolute"
                zIndex="20"
                top="-5"
                right="-2"
                paddingLeft="1"
                paddingRight="0.5"
                color="grey-100"
                backgroundColor="grey-0"
                borderRadius="1.5"
                boxShadow="elevation-20"
                className={greyElevated2ClassName}
                pointerEvents={!isShowingActions ? "none" : undefined}
                opacity={isShowingActions ? "100" : "0"}
                {...focusWithinActionsProps}
            >
                <MessageViewActionButton description="Reply" onPress={onReplyToMessage}>
                    <ArrowArcLeft />
                </MessageViewActionButton>
                <MenuButton
                    placement="left-start"
                    offsetAlong="-1"
                    actions={actions}
                    onStateChange={state => {
                        setIsMoreMenuOpenTimeoutRef.current?.clear();
                        setIsMoreMenuOpenTimeoutRef.current = null;

                        const nextIsMoreMenuOpen = state.isExpanded;
                        if (isMoreMenuOpen && !nextIsMoreMenuOpen) {
                            // Wait a bit before setting `isMoreMenuOpen` to false so `isHovered` state can
                            // become true and actions don't temporarily blink out of existence.
                            setIsMoreMenuOpenTimeoutRef.current = createTimeout(() => {
                                setIsMoreMenuOpenTimeoutRef.current = null;
                                setIsMoreMenuOpen(nextIsMoreMenuOpen);
                            }, (!state.disableAnimationOut ? overlayFadeOutAnimationDurationMs : 0) + perceivedAsInstantLimitMs);
                        } else {
                            setIsMoreMenuOpen(nextIsMoreMenuOpen);
                        }
                    }}
                    extraOverlayBottom={
                        <MessageViewMenuCreatedTime
                            createdTime={message.createdTime}
                            // Never show the updated time in actions since the user can see it by hovering
                            // over the "(edited)" text. We only show the updated time on platforms where the
                            // user can't hover.
                            contentUpdatedTime={null}
                        />
                    }
                >
                    <MessageViewActionButton description="More">
                        <DotsThree />
                    </MessageViewActionButton>
                </MenuButton>
            </Box>
        </>
    );
}

const MessageViewActionButton = forwardRef(function MessageViewActionButton(
    {
        description,
        keyboardShortcutHint,
        isActive,
        onPress,
        children,
        dividerLeft,
        dividerRight,
    }: {
        description: string;
        keyboardShortcutHint?: string;
        isActive?: boolean;
        onPress?: () => void;
        children: ReactNode;
        dividerLeft?: boolean;
        dividerRight?: boolean;
    },
    ref: Ref<HTMLButtonElement>,
) {
    const localRef = useRef<HTMLButtonElement>(null);

    const {pressProps, isPressed} = usePress({
        ref: localRef,
        preventFocusOnPress: true,
        onPress,
    });

    const {hoverProps, isHovered} = useHover({});

    // Change this state only when `isPressed` changes. If it becomes active while
    // pressed we don't want to change the color.
    const [isPressedAndActive] = useStateWithDependencies(
        isPressed => isPressed && isActive,
        [isPressed],
    );

    return (
        <Tooltip
            placement="top"
            // Don't allow flipping the tooltip down into selection content.
            fallbackPlacements={emptyArray}
            content={
                keyboardShortcutHint ? (
                    <Box paddingY="0.5">
                        {description}
                        <Box color="grey-50">{keyboardShortcutHint}</Box>
                    </Box>
                ) : (
                    description
                )
            }
        >
            <FocusRing
                offset="0"
                insetY="1"
                insetLeft={dividerLeft ? "1" : undefined}
                insetRight={dividerRight ? "1" : "0.5"}
            >
                <button
                    {...mergeProps(pressProps, hoverProps)}
                    ref={useMergedRefs(localRef, ref)}
                    aria-label={description}
                    // Disable the ability to focus this icon button! The icon buttons in the
                    // selection toolbar are only mouse accessible. They are not keyboard
                    // accessible. By being focusable then the button steals focus when you click
                    // on it, so instead make the button not focusable. This also makes it so the
                    // button is not reachable in tab order.
                    tabIndex={undefined}
                    className={sprinkles({
                        paddingY: "1",
                        // You may notice our button doesn't have a pointer cursor. See:
                        // https://medium.com/simple-human/buttons-shouldnt-have-a-hand-cursor-b11e99ca374b
                        cursor: "default",
                        // While this border radius isn't visible we still need it so the `<FocusRing>`
                        // computes the right border radius.
                        borderRadius: "1",
                    })}
                >
                    <Box
                        // We implement dividers in this funky way so that as the mouse scrubs left and
                        // right over our toolbar the tooltips immediately disappear/reappear because
                        // there is no gap in between the hovered elements.
                        paddingRight={dividerRight ? "1" : "0.5"}
                        borderRight={dividerRight ? "grey-5" : undefined}
                        paddingLeft={dividerLeft ? "1" : undefined}
                    >
                        <Box
                            padding="1"
                            borderRadius="1"
                            color={isPressed || isActive ? "grey-100" : "grey-70"}
                            backgroundColor={
                                isPressedAndActive
                                    ? "grey-20"
                                    : isPressed || isActive
                                    ? "grey-10"
                                    : isHovered
                                    ? "grey-5"
                                    : undefined
                            }
                        >
                            <IconContext.Provider
                                value={{
                                    color: "currentColor",
                                    size: spacing["4"],
                                }}
                            >
                                {children}
                            </IconContext.Provider>
                        </Box>
                    </Box>
                </button>
            </FocusRing>
        </Tooltip>
    );
});
