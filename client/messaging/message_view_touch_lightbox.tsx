import {animate, timeline} from "motion";
import {
    ArrowArcLeft,
    ArrowBendUpLeft,
    Copy,
    Link as LinkIcon,
    PencilSimple,
    Trash,
} from "phosphor-react";
import {Fragment, ReactNode, useEffect, useMemo, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {AccountShortName} from "~/client/accounts/account_short_name.js";
import {ContentView} from "~/client/content/content_view.js";
import {writeContentToClipboard} from "~/client/content/write_content_to_clipboard.js";
import {Box} from "~/client/design/box.js";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {Menu, MenuAction} from "~/client/design/menu.js";
import {useOverlayRootPortalElement} from "~/client/design/overlay.js";
import {Spacer} from "~/client/design/spacer.js";
import {defaultTooltipOffset} from "~/client/design/tooltip.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {MessageViewMenuCreatedTime} from "~/client/messaging/internal/message_view_menu_created_time.js";
import {MessageEditing} from "~/client/messaging/message_editing.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    addRemLengths,
    convertRemLengthToPx,
    parseRemLengthNumber,
    screenPaddingX,
    spacing,
} from "~/shared/design/spacing.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {iterateEmojis} from "~/shared/helpers/string/iterate_emojis.js";
import {getTruncatedMessageContentForReplyPreview} from "~/shared/messaging/get_truncated_message_content_for_reply_preview.js";
import {emptyMessageContentWithReferences} from "~/shared/messaging/message_content_schema.js";
import {MessageModel, OptimisticMessageModel} from "~/shared/messaging/message_model.js";
import {
    getMessageBubbleMarginLeft,
    messageViewActionsWidthWithoutHoveringPrimaryInput,
    messageViewBubbleBorderRadius,
    messageViewBubbleMergedBorderRadius,
    messageViewBubbleMinWidth,
    messageViewBubblePaddingX,
    messageViewBubblePaddingY,
    messageViewReplyPreviewBubbleOpacity,
    messageViewReplyPreviewOpacity,
    messageViewReplyPreviewScale,
} from "~/shared/styles/messaging_shared_styles.js";
import {
    contentViewStyles,
    emojiFontFamily,
    messagingStyles,
    overlayAnimateFadeInFromBottomSlowedAnimation,
    overlayAnimateFadeOutFromBottomAnimation,
    pointerEventsNoneNotInheritedClassName,
    sprinkles,
} from "~/shared/styles/styles.js";

export function MessageViewTouchLightbox<
    RoomKey extends string,
    Message extends MessageModel<RoomKey>,
>({
    messageNoun,
    messageStartOfSentenceNoun,
    message,
    messageTextForBigEmojiMessage,
    parentMessage,
    initialMessageTop,
    getMessageTop,
    shouldMergeWithNextMessage,
    shouldMergeWithPreviousMessage,
    messageEditing,
    onReplyToMessage,
    onShowDeleteConfirmationDialog,
    getMessageUrl,
    onClose: onCloseWithoutAnimationProp,
}: {
    messageNoun: string;
    messageStartOfSentenceNoun: string;
    message: Message | OptimisticMessageModel;
    messageTextForBigEmojiMessage: string | null;
    parentMessage: Message | null;
    initialMessageTop: number;
    getMessageTop: () => number;
    shouldMergeWithNextMessage: boolean;
    shouldMergeWithPreviousMessage: boolean;
    messageEditing: MessageEditing<RoomKey>;
    onReplyToMessage: () => void;
    onShowDeleteConfirmationDialog: () => void;
    getMessageUrl: (messageIndex: number) => URL;
    onClose: () => void;
}) {
    const isMobile = useIsMobile();
    const {space, currentAccount} = useSpaceContext();
    const rootPortalElement = assertExists(
        useOverlayRootPortalElement(),
        "Can't server render `<MessageViewTouchLightbox>`",
    );

    const backdropRef = useRef<HTMLDivElement>(null);
    const presentedRef = useRef<HTMLDivElement>(null);

    const [isFadingOut, setIsFadingOut] = useState(false);

    const onCloseWithAnimation = () => setIsFadingOut(true);

    const onCloseWithoutAnimationCallbacksRef = useRef<Array<() => void>>([]);

    const onCloseWithoutAnimation = useEvent(() => {
        const callbacks = onCloseWithoutAnimationCallbacksRef.current;
        onCloseWithoutAnimationCallbacksRef.current = [];

        for (const callback of callbacks) {
            callback();
        }

        onCloseWithoutAnimationProp();
    });

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
        NativeMobileBridge?.tabBar.hide({isAnimated: true});
        return () => {
            NativeMobileBridge?.tabBar.unhide({isAnimated: true});
        };
    }, []);

    const [hasOpenTranslateYAnimationFinished, setHasOpenTranslateYAnimationFinished] =
        useState(false);

    const hasOpenTranslateYAnimationStartedRef = useRef(false);
    useEffect(() => {
        if (hasOpenTranslateYAnimationStartedRef.current) return;
        hasOpenTranslateYAnimationStartedRef.current = true;

        const backdropElement = assertExists(backdropRef.current);
        const presentedElement = assertExists(presentedRef.current);

        const backdropRect = backdropElement.getBoundingClientRect();
        const presentedRect = presentedElement.getBoundingClientRect();

        const translateY = Math.max(0, presentedRect.bottom - backdropRect.bottom);

        const animation = timeline([
            [
                presentedElement,
                {
                    y: [0, -translateY],
                },
                {
                    at: 0,
                    duration: 0.15,
                    easing: "ease",
                    // Make sure we use hardware acceleration for this animation in WebKit. By
                    // default `motion` turns it off.
                    // https://motion.dev/guides/performance#webkits-exceptions
                    allowWebkitAcceleration: true,
                },
            ],
            [
                presentedElement,
                {
                    x: [0, -convertRemLengthToPx(spacing["9"], getRemPxWithoutListening())],
                },
                {
                    at: translateY === 0 ? 0 : 0.1,
                    duration: 0.15,
                    easing: "ease",
                    // Make sure we use hardware acceleration for this animation in WebKit. By
                    // default `motion` turns it off.
                    // https://motion.dev/guides/performance#webkits-exceptions
                    allowWebkitAcceleration: true,
                },
            ],
        ]);

        void animation.finished.finally(() => {
            setHasOpenTranslateYAnimationFinished(true);
        });
    }, []);

    const hasCloseTranslateYAnimationStartedRef = useRef(false);
    useEffect(() => {
        if (!isFadingOut) return;

        if (hasCloseTranslateYAnimationStartedRef.current) return;
        hasCloseTranslateYAnimationStartedRef.current = true;

        const presentedElement = assertExists(presentedRef.current);

        const messageTop = getMessageTop();

        const translateY = messageTop - initialMessageTop;

        animate(
            presentedElement,
            {
                y: [null, translateY],
                x: [-convertRemLengthToPx(spacing["9"], getRemPxWithoutListening()), 0],
            },
            {
                duration: 0.2,
                easing: "ease",
                // Make sure we use hardware acceleration for this animation in WebKit. By
                // default `motion` turns it off.
                // https://motion.dev/guides/performance#webkits-exceptions
                allowWebkitAcceleration: true,
            },
        );
    }, [getMessageTop, initialMessageTop, isFadingOut]);

    let messageChildrenForBigEmojiMessage: Array<ReactNode> | null = null;

    // Render the message as a big emoji message if the content is just emojis.
    if (messageTextForBigEmojiMessage) {
        messageChildrenForBigEmojiMessage ??= [];

        let lastIndex = 0;
        for (const {index, emoji} of iterateEmojis(messageTextForBigEmojiMessage)) {
            if (lastIndex !== index) {
                messageChildrenForBigEmojiMessage.push(
                    <Fragment key={lastIndex}>
                        {messageTextForBigEmojiMessage.slice(lastIndex, index)}
                    </Fragment>,
                );
            }

            messageChildrenForBigEmojiMessage.push(
                <span key={index} style={{fontFamily: emojiFontFamily}}>
                    {emoji}
                </span>,
            );

            lastIndex = index + emoji.length;
        }

        if (lastIndex !== messageTextForBigEmojiMessage.length - 1) {
            messageChildrenForBigEmojiMessage.push(
                <Fragment key={lastIndex}>
                    {messageTextForBigEmojiMessage.slice(lastIndex)}
                </Fragment>,
            );
        }
    }

    const parentMessageNode = useMemo(() => {
        if (!parentMessage) return null;

        let height = addRemLengths(spacing["1.5"], contentViewStyles.truncatedHeight);

        // Remove some vertical padding from the parent message to move it closer to a
        // big emoji message which doesn't render in a bubble.
        if (!messageTextForBigEmojiMessage) height = addRemLengths(height, spacing["1.5"]);

        const scaledHeight = `${
            Math.round(parseRemLengthNumber(height) * messageViewReplyPreviewScale * 16) / 16
        }rem`;

        const truncatedContent = getTruncatedMessageContentForReplyPreview({
            message: parentMessage,
            messageStartOfSentenceNoun,
        });

        return (
            <Box
                position="relative"
                zIndex="10"
                className={pointerEventsNoneNotInheritedClassName}
                style={{
                    height: scaledHeight,
                    paddingLeft: getMessageBubbleMarginLeft(screenPaddingX.mobile),
                    paddingRight: addRemLengths(
                        spacing["3"],
                        // The lightbox should only open if the primary input can't hover.
                        spacing[messageViewActionsWidthWithoutHoveringPrimaryInput],
                        spacing[screenPaddingX.mobile],
                    ),
                }}
            >
                <div
                    className={sprinkles({
                        position: "relative",
                        zIndex: "0",
                        maxWidth: "full",
                        overflow: "hidden",
                        display: "inline-block",
                        paddingX: messageViewBubblePaddingX,
                        paddingTop: messageViewBubblePaddingY,
                        paddingBottom: "5",
                        borderRadius: messageViewBubbleBorderRadius,
                        borderBottomLeftRadius: messageViewBubbleMergedBorderRadius,
                    })}
                    style={{
                        opacity: messageViewReplyPreviewOpacity,
                        transform: `scale(${messageViewReplyPreviewScale})`,
                        transformOrigin: "0% 0% 0",
                    }}
                >
                    <div
                        className={sprinkles({
                            position: "absolute",
                            inset: "0",
                            zIndex: "-10",
                            borderRadius: messageViewBubbleBorderRadius,
                            borderBottomLeftRadius: messageViewBubbleMergedBorderRadius,
                            backgroundColor: "grey-5",
                        })}
                        style={{
                            opacity: messageViewReplyPreviewBubbleOpacity,
                        }}
                    />
                    <div className={sprinkles({overflow: "hidden", pointerEvents: "none"})}>
                        <ContentView
                            isInert={true}
                            isTruncated={true}
                            isCompact={true}
                            isExtraCompact={isMobile}
                            isBackgroundColorGrey5={true}
                            withUserSelectNone={true}
                            // Only rendered on mobile layouts.
                            withMobileLayout={true}
                            content={truncatedContent}
                            className={sprinkles({minWidth: messageViewBubbleMinWidth})}
                        />
                    </div>
                </div>
            </Box>
        );
    }, [isMobile, messageStartOfSentenceNoun, messageTextForBigEmojiMessage, parentMessage]);

    const menuActions: Array<Array<MenuAction>> = [];

    menuActions.push([
        {
            label: "Reply",
            icon: <ArrowBendUpLeft />,
            iconPlacement: "end",
            onPress: () => {
                // Start editing once the lightbox has finished animating shut. So the
                // animation completes smoothly. Otherwise the keyboard opening would throw
                // things off.
                onCloseWithoutAnimationCallbacksRef.current.push(onReplyToMessage);
            },
        },
    ]);

    {
        const copyMenuActions: Array<MenuAction> = [];

        if (message.payload.type === "Content") {
            copyMenuActions.push({
                label: "Copy text",
                icon: <Copy />,
                iconPlacement: "end",
                pressErrorTitle: `Couldn’t copy ${messageNoun} text`,
                onPress: async () => {
                    assert(message.payload.type === "Content");

                    await writeContentToClipboard(space.id, message.payload.content);
                },
            });
        }

        if (!message.isOptimistic) {
            copyMenuActions.push({
                label: "Copy link",
                icon: <LinkIcon />,
                iconPlacement: "end",
                pressErrorTitle: `Couldn’t copy ${messageNoun} link`,
                onPress: async () => {
                    await writeTextToClipboard(getMessageUrl(message.index).toString());
                },
            });
        }

        menuActions.push(copyMenuActions);
    }

    if (
        currentAccount.id === message.author.id &&
        !message.isOptimistic &&
        message.payload.type === "Content"
    ) {
        menuActions.push([
            {
                label: "Edit",
                icon: <PencilSimple />,
                iconPlacement: "end",
                onPress: () => {
                    // Start editing once the lightbox has finished animating shut. So the
                    // animation completes smoothly. Otherwise the keyboard opening would throw
                    // things off.
                    onCloseWithoutAnimationCallbacksRef.current.push(() => {
                        if (message.payload.type === "Content") {
                            messageEditing.dispatch({
                                type: "StartEditing",
                                messageIndex: message.index,
                                messageRoomKey: message.getRoomKey(),
                                messagePayload: message.payload,
                                isMobile,
                                returnFocusAfterEditing: null,
                            });
                        }
                    });
                },
            },
            {
                label: "Delete",
                icon: <Trash />,
                iconPlacement: "end",
                onPress: onShowDeleteConfirmationDialog,
            },
        ]);
    }

    return createPortal(
        <Box
            ref={backdropRef}
            position="fixed"
            inset="0"
            overflow="hidden"
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
                ref={presentedRef}
                position="absolute"
                width="full"
                overflow="hidden"
                className={pointerEventsNoneNotInheritedClassName}
                style={{
                    top: initialMessageTop,
                    paddingBottom: `calc(${spacing["4"]} + var(--safe-area-inset-bottom, 0px))`,
                }}
            >
                {parentMessage && (
                    <Box
                        fontSize="50"
                        fontStyle="truncate"
                        paddingTop="1"
                        paddingBottom="1"
                        paddingRight={screenPaddingX.mobile}
                        color="grey-50"
                        display="flex"
                        alignItems="center"
                        gap="0.5"
                        pointerEvents="none"
                        style={{
                            paddingLeft: addRemLengths(
                                getMessageBubbleMarginLeft(screenPaddingX.mobile),
                                parentMessage === null ? spacing["1.5"] : spacing["1"],
                            ),
                        }}
                    >
                        <ArrowArcLeft size={spacing["3"]} />
                        <span>
                            <AccountShortName account={message.author} />
                            {parentMessage !== null && (
                                <>
                                    {" "}
                                    replied to{" "}
                                    {message.author.id === parentMessage.author.id ? (
                                        "themself"
                                    ) : (
                                        <AccountShortName account={parentMessage.author} />
                                    )}
                                </>
                            )}
                        </span>
                    </Box>
                )}
                {parentMessageNode}
                <Box
                    paddingX={screenPaddingX.mobile}
                    display="flex"
                    className={pointerEventsNoneNotInheritedClassName}
                >
                    <Box pointerEvents="none" flexShrink="0" paddingRight="2">
                        <Spacer space="7" />
                    </Box>
                    {messageChildrenForBigEmojiMessage ? (
                        <Box
                            paddingLeft="1"
                            position="relative"
                            zIndex="20"
                            fontSize="600"
                            userSelect="none"
                        >
                            {messageChildrenForBigEmojiMessage}
                            {message.payload.type === "Content" &&
                                message.payload.contentUpdatedTime && (
                                    <span
                                        className={contentViewStyles.updatedNoteClassName}
                                        style={{paddingLeft: spacing["1"]}}
                                    >
                                        {" "}
                                        (updated)
                                    </span>
                                )}
                        </Box>
                    ) : (
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
                                !hasOpenTranslateYAnimationFinished || isFadingOut
                                    ? !shouldMergeWithPreviousMessage
                                        ? messageViewBubbleBorderRadius
                                        : messageViewBubbleMergedBorderRadius
                                    : messageViewBubbleBorderRadius
                            }
                            borderTopRightRadius={messageViewBubbleBorderRadius}
                            borderBottomLeftRadius={
                                !hasOpenTranslateYAnimationFinished || isFadingOut
                                    ? !shouldMergeWithNextMessage
                                        ? messageViewBubbleBorderRadius
                                        : messageViewBubbleMergedBorderRadius
                                    : messageViewBubbleBorderRadius
                            }
                            borderBottomRightRadius={messageViewBubbleBorderRadius}
                            pointerEvents="auto"
                            style={{
                                transition: "border-radius 200ms ease",
                            }}
                        >
                            <ContentView
                                isInert={true}
                                isCompact={true}
                                isExtraCompact={isMobile}
                                isBackgroundColorGrey5={true}
                                withUserSelectNone={true}
                                className={sprinkles({minWidth: messageViewBubbleMinWidth})}
                                // Only rendered on mobile layouts.
                                withMobileLayout={true}
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
                                        : null
                                }
                            />
                        </Box>
                    )}
                    <Box pointerEvents="none" flexShrink="0" paddingLeft="3">
                        <Box width={messageViewActionsWidthWithoutHoveringPrimaryInput} />
                    </Box>
                </Box>
                <Box
                    paddingRight={screenPaddingX.mobile}
                    // Display flex so we don't get the same width as the message bubble.
                    display="flex"
                    paddingTop={defaultTooltipOffset}
                    className={pointerEventsNoneNotInheritedClassName}
                    style={{
                        paddingLeft: addRemLengths(spacing[screenPaddingX.mobile], spacing["9"]),
                        opacity: !hasOpenTranslateYAnimationFinished ? 0 : undefined,
                        animation: hasOpenTranslateYAnimationFinished
                            ? !isFadingOut
                                ? overlayAnimateFadeInFromBottomSlowedAnimation
                                : overlayAnimateFadeOutFromBottomAnimation
                            : undefined,
                    }}
                >
                    <Menu
                        actions={menuActions}
                        extraBottom={
                            <MessageViewMenuCreatedTime
                                createdTime={message.createdTime}
                                contentUpdatedTime={
                                    message.payload.type === "Content"
                                        ? message.payload.contentUpdatedTime
                                        : null
                                }
                            />
                        }
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
