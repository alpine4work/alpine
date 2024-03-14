import {ArrowBendUpLeft, Copy, Link as LinkIcon, PencilSimple, Trash} from "phosphor-react";
import {useEffect, useState} from "react";
import {createPortal} from "react-dom";
import {ContentView} from "~/client/content/content_view.js";
import {Box} from "~/client/design/box.js";
import {Menu} from "~/client/design/menu_button.js";
import {useOverlayRootPortalElement} from "~/client/design/overlay.js";
import {Spacer} from "~/client/design/spacer.js";
import {defaultTooltipOffset} from "~/client/design/tooltip.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {
    messageViewActionsWidth,
    messageViewBubbleMinWidth,
} from "~/client/messaging/message_view.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {spacing} from "~/shared/design/spacing.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {emptyMessageContentWithReferences} from "~/shared/messaging/message_content_schema.js";
import {MessageModel, OptimisticMessageModel} from "~/shared/messaging/message_model.js";
import {
    messageViewBubbleBorderRadius,
    messageViewBubbleMergedBorderRadius,
    messageViewBubblePaddingX,
    messageViewBubblePaddingY,
} from "~/shared/messaging/messaging_shared_styles.js";
import {
    messagingStyles,
    overlayAnimateFadeInFromBottomSlowedAnimation,
    overlayAnimateFadeOutFromBottomAnimation,
    pointerEventsNoneNotInheritedClassName,
    sprinkles,
} from "~/shared/styles/styles.js";

// NOCOMMIT:
//
// - Emoji messages
// - Replies
// - Links
// - Translate if offscreen

export function MessageViewTouchLightbox<
    RoomKey extends string,
    Message extends MessageModel<RoomKey>,
>({
    message,
    messageTop,
    shouldMergeWithNextMessage,
    shouldMergeWithPreviousMessage,
    onClose: onCloseWithoutAnimationProp,
}: {
    message: Message | OptimisticMessageModel;
    messageTop: number;
    shouldMergeWithNextMessage: boolean;
    shouldMergeWithPreviousMessage: boolean;
    onClose: () => void;
}) {
    const rootPortalElement = assertExists(
        useOverlayRootPortalElement(),
        "Can't server render `<MessageViewTouchLightbox>`",
    );

    const [isInitialPaint, setIsInitialPaint] = useState(true);
    useEffect(() => {
        if (!isInitialPaint) return;

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                setIsInitialPaint(false);
            });
        });
    }, [isInitialPaint]);

    const [isFadingOut, setIsFadingOut] = useState(false);

    const onCloseWithAnimation = () => setIsFadingOut(true);
    const onCloseWithoutAnimation = useEvent(onCloseWithoutAnimationProp);

    useEffect(() => {
        if (!isFadingOut) return;

        const timeout = createTimeout(
            onCloseWithoutAnimation,
            messagingStyles.backdropFadeAnimationDurationMs,
        );

        return () => {
            timeout.clear();
        };
    }, [isFadingOut, onCloseWithoutAnimation]);

    // Our blur can't cover the tab bar (which is rendered in native code) so
    // disable the tab bar while the lightbox is open.
    useEffect(() => {
        NativeMobileBridge?.tabBar.disable({isAnimated: true});
        return () => {
            NativeMobileBridge?.tabBar.enable({isAnimated: true});
        };
    }, []);

    return createPortal(
        <Box
            position="fixed"
            inset="0"
            className={
                !isFadingOut
                    ? messagingStyles.backdropFadeInClassName
                    : messagingStyles.backdropFadeOutClassName
            }
            onPointerDown={event => {
                if (event.target === event.currentTarget) {
                    onCloseWithAnimation();
                }
            }}
        >
            <Box
                position="absolute"
                paddingX="4"
                style={{top: messageTop}}
                className={pointerEventsNoneNotInheritedClassName}
            >
                <Box display="flex" className={pointerEventsNoneNotInheritedClassName}>
                    <Box pointerEvents="none" flexShrink="0" paddingRight="2">
                        <Spacer space="7" />
                    </Box>
                    <Box
                        position="relative"
                        zIndex="20"
                        backgroundColor="grey-5"
                        maxWidth="full"
                        overflow="hidden"
                        display="inline-block"
                        paddingX={messageViewBubblePaddingX}
                        paddingY={messageViewBubblePaddingY}
                        borderTopLeftRadius={
                            isInitialPaint || isFadingOut
                                ? !shouldMergeWithPreviousMessage
                                    ? messageViewBubbleBorderRadius
                                    : messageViewBubbleMergedBorderRadius
                                : messageViewBubbleBorderRadius
                        }
                        borderTopRightRadius={messageViewBubbleBorderRadius}
                        borderBottomLeftRadius={
                            isInitialPaint || isFadingOut
                                ? !shouldMergeWithNextMessage
                                    ? messageViewBubbleBorderRadius
                                    : messageViewBubbleMergedBorderRadius
                                : messageViewBubbleBorderRadius
                        }
                        borderBottomRightRadius={messageViewBubbleBorderRadius}
                        pointerEvents="auto"
                        style={{
                            transform: `translateX(-${
                                isInitialPaint || isFadingOut ? "0rem" : spacing["9"]
                            })`,
                            transition: `transform 200ms 50ms ease, border-radius 200ms 50ms ease`,
                        }}
                    >
                        <ContentView
                            isInert={true}
                            withUserSelectNone={true}
                            className={sprinkles({minWidth: messageViewBubbleMinWidth})}
                            content={
                                // Should only be able to open a lightbox for a message with content. If a
                                // message is deleted then show nothing. (Message may be deleted in realtime.)
                                message.payload.type === "Content"
                                    ? message.payload.content
                                    : emptyMessageContentWithReferences
                            }
                            contentUpdatedTime={
                                message.payload.type === "Content"
                                    ? message.payload.contentUpdatedTime
                                    : message.payload.deletedTime
                            }
                        />
                    </Box>
                    <Box pointerEvents="none" flexShrink="0" paddingLeft="3">
                        <Box width={messageViewActionsWidth} />
                    </Box>
                </Box>
                <Box
                    // Display flex so we don't get the same width as the message bubble.
                    display="flex"
                    paddingTop={defaultTooltipOffset}
                    className={pointerEventsNoneNotInheritedClassName}
                    style={{
                        animation: !isFadingOut
                            ? overlayAnimateFadeInFromBottomSlowedAnimation
                            : overlayAnimateFadeOutFromBottomAnimation,
                    }}
                >
                    <Menu
                        actions={[
                            [
                                {
                                    label: "Reply",
                                    icon: <ArrowBendUpLeft />,
                                    iconPlacement: "end",
                                    onPress: () => {
                                        // NOCOMMIT
                                    },
                                },
                            ],
                            [
                                {
                                    label: "Copy text",
                                    icon: <Copy />,
                                    iconPlacement: "end",
                                    onPress: () => {
                                        // NOCOMMIT
                                    },
                                },
                                {
                                    label: "Copy link",
                                    icon: <LinkIcon />,
                                    iconPlacement: "end",
                                    onPress: () => {
                                        // NOCOMMIT
                                    },
                                },
                            ],
                            [
                                {
                                    label: "Edit",
                                    icon: <PencilSimple />,
                                    iconPlacement: "end",
                                    onPress: () => {
                                        // NOCOMMIT
                                    },
                                },
                                {
                                    label: "Delete",
                                    icon: <Trash />,
                                    iconPlacement: "end",
                                    onPress: () => {
                                        // NOCOMMIT
                                    },
                                },
                            ],
                        ]}
                        onCloseWithAnimation={onCloseWithAnimation}
                        // Always close lightbox with animation.
                        onCloseWithoutAnimation={onCloseWithAnimation}
                    />
                </Box>
            </Box>
        </Box>,
        rootPortalElement,
    );
}
