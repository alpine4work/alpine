import {differenceInMinutes} from "date-fns";
import {timeline} from "motion";
import {ArrowArcLeft, SpinnerGap} from "phosphor-react";
import {Fragment, Memo, MutableRefObject, useEffect, useMemo, useRef, useState} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {AccountShortName} from "~/client/accounts/account_short_name.js";
import {ContentView} from "~/client/content/content_view.js";
import {ErrorIcon} from "~/client/design/error_icon.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {IconButton} from "~/client/design/icon_button.js";
import {ModalDialog} from "~/client/design/modal_dialog.js";
import {OverlayScopeContextProvider} from "~/client/design/overlay.js";
import {PrettyAbsoluteDateTooltipContent} from "~/client/design/pretty_absolute_date.js";
import {Tooltip} from "~/client/design/tooltip.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {formatMessageViewTimestampDividerDate} from "~/client/messaging/format_message_view_timestamp_divider_date.js";
import {MessageDeleteConfirmationDialog} from "~/client/messaging/internal/message_delete_confirmation_dialog.js";
import {MessageViewActions} from "~/client/messaging/internal/message_view_actions.js";
import {
    MessageViewEditor,
    MessageViewEditorRef,
} from "~/client/messaging/internal/message_view_editor.js";
import {shouldDisplayTextAsBigEmojiMessage} from "~/client/messaging/internal/should_display_text_as_big_emoji_message.js";
import {MessageEditing} from "~/client/messaging/message_editing.js";
import {MessageList} from "~/client/messaging/message_list.js";
import {MessageViewTouchLightbox} from "~/client/messaging/message_view_touch_lightbox.js";
import {useIsPeekAnimatingOpen} from "~/client/peek/peek_stack.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useCurrentTimeRoundedToHour} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {useCanPrimaryInputHover, useIsMobile} from "~/client/remix/use_is_mobile.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {getContentSnippet} from "~/shared/content/get_content_snippet.js";
import {easeOutExpo, parseCubicBezier} from "~/shared/design/easing.js";
import {
    RemLength,
    Spacing,
    addRemLengths,
    parseRemLengthNumber,
    spacing,
} from "~/shared/design/spacing.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {iterateEmojis} from "~/shared/helpers/string/iterate_emojis.js";
import {
    MessageContentProsemirrorSchema,
    MessageContentWithReferences,
    assertMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {
    MessageModel,
    MessageModelBase,
    OptimisticMessageModel,
} from "~/shared/messaging/message_model.js";
import {
    messageViewBubbleBorderRadius,
    messageViewBubbleMergedBorderRadius,
    messageViewBubblePaddingX,
    messageViewBubblePaddingY,
    messageViewMergedMarginY,
    minMessageViewTimestampDividerElapsedMinutes,
} from "~/shared/messaging/messaging_shared_styles.js";
import {
    colorSchemeVars,
    contentSchemaStyles,
    contentViewStyles,
    emojiFontFamily,
    fontSizesByPlatform,
    spinAnimationClassName,
    sprinkles,
    wiggleAnimation,
    wiggleAnimationDuration,
} from "~/shared/styles/styles.js";

const {paragraphFontSize} = contentSchemaStyles;

/**
 * The buffered height we use for virtualized message views.
 *
 * Calculated by rendering 10,000 `<MessageShimmer>`s and get the height
 * divided by the number of messages. Approximately this value.
 */
export const bufferedMessageViewHeight: RemLength = "4rem";

/**
 * The minimum width of a message bubble.
 */
export const messageViewBubbleMinWidth: Spacing = "6";

const mergeMessageMinuteLimit = 5;

export const messageViewActionsWidth: Spacing = "10";
export const messageViewPreviewScale =
    fontSizesByPlatform["50"].desktop.fontSize / fontSizesByPlatform["100"].desktop.fontSize;
export const messageViewReplyPreviewOpacity = 0.6;
export const messageViewReplyPreviewBubbleOpacity = 0.7;
export const defaultMessageViewMarginX: Spacing = "5";
export const messageViewMarginY: Spacing = "3";

export const getMessageBubbleMarginLeft = (marginX: Spacing) =>
    addRemLengths(spacing[marginX], spacing["7"], spacing["2"]);

const messageViewTouchReplyIconSize = "5";
const messageViewTouchReplyIconSizeRem = parseRemLengthNumber(
    spacing[messageViewTouchReplyIconSize],
);

const messageViewTouchReplyIconStartOffset = "1.5";
const messageViewTouchReplyIconStartOffsetRem = parseRemLengthNumber(
    spacing[messageViewTouchReplyIconStartOffset],
);

// NOTE(calebmer): You are not allowed to use the `<Box>` component in this
// file. It is critical for scroll performance that this component renders
// fast. Manually use the `sprinkles()` function instead. This reduces the
// number of fibers React needs to render. One day we'd like to introduce
// transformations that automatically inline `<Box>` components and
// `sprinkles()` functions at which point using `<Box>` would not make a
// performance difference.
//
// Assign a variable to null so you get a TypeScript error if you try to
// use `<Box>`.
//
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const Box = null;

/**
 * Should two messages merge together?
 */
export function shouldMergeMessages(
    message1: MessageModelBase,
    message2: MessageModelBase,
): boolean {
    return (
        message1.author.id === message2.author.id &&
        Math.abs(differenceInMinutes(message1.createdTime, message2.createdTime)) <
            mergeMessageMinuteLimit &&
        (message2.payload.type !== "Content" || message2.payload.parentMessageIndex === null)
    );
}

export function MessageView<RoomKey extends string, Message extends MessageModel<RoomKey>>({
    messageNoun = "message",
    messageStartOfSentenceNoun = messageNoun.slice(0, 1).toUpperCase() + messageNoun.slice(1),
    message,
    isFirstMessage,
    previousMessage,
    nextMessage,
    messages,
    messageEditing,
    disableExpensiveFeaturesDuringScroll,
    shouldHighlightRef,
    onJumpToMessage,
    onReplyToMessage: onReplyToMessageProp,
    onDeleteMessage,
    getMessageUrl,
    roomDisplayedCreatedTime,
    marginX = defaultMessageViewMarginX,
}: {
    messageNoun?: string;
    messageStartOfSentenceNoun?: string;
    message: Message | OptimisticMessageModel;
    isFirstMessage: boolean;
    previousMessage: MessageModelBase | null;
    nextMessage: MessageModelBase | null;
    messages: MessageList<Message>;
    messageEditing: MessageEditing<RoomKey>;
    disableExpensiveFeaturesDuringScroll: boolean;
    shouldHighlightRef: MutableRefObject<boolean> | null;
    onJumpToMessage: Memo<(message: Message) => void>;
    onReplyToMessage: () => void;
    onDeleteMessage: () => Promise<void>;
    getMessageUrl: (messageIndex: number) => URL;
    roomDisplayedCreatedTime?: Date;
    marginX?: Spacing;
}) {
    const isMobile = useIsMobile();
    const canPrimaryInputHover = useCanPrimaryInputHover();
    const {timeZone, locale} = useClientInfo();
    const currentTime = useCurrentTimeRoundedToHour();

    const containerRef = useRef<HTMLDivElement>(null);
    const messageRef = useRef<HTMLDivElement>(null);
    const accountNameRef = useRef<HTMLDivElement>(null);
    const parentMessageRef = useRef<HTMLDivElement>(null);
    const touchReplyIconRef = useRef<HTMLDivElement>(null);

    const shouldMergeWithPreviousMessage: boolean =
        !!previousMessage && shouldMergeMessages(previousMessage, message);

    const shouldMergeWithNextMessage: boolean =
        !!nextMessage && shouldMergeMessages(message, nextMessage);

    const parentMessage =
        message.payload.type === "Content" && message.payload.parentMessageIndex !== null
            ? assertExists(
                  messages.getLoadedMessageIfExists(message.payload.parentMessageIndex),
                  "Parent message should have been loaded",
              )
            : null;

    // Manually implement hovering state by attaching event listeners (instead of
    // using `useHover()` from `react-aria`). React doesn't deliver a
    // `pointerleave` event when the pointer goes into a portalled element.
    const hoverRef = useRef<HTMLDivElement>(null);
    const [isHovered, setIsHovered] = useState(false);

    // NOTE(calebmer): This can't be `onPointerEnter` or `onPointerLeave` props.
    // I've found that React doesn't call `onPointerLeave` when the
    // `<MessageViewActions>` menu closes.
    useEffect(() => {
        const hoverElement = assertExists(hoverRef.current);

        const handlePointerEnter = (event: PointerEvent) => {
            // Ignore iOS touch pointer enter/leave events.
            if (event.pointerType !== "mouse") return;

            setIsHovered(true);
        };

        const handlePointerLeave = (event: PointerEvent) => {
            // Ignore iOS touch pointer enter/leave events.
            if (event.pointerType !== "mouse") return;

            setIsHovered(false);
        };

        hoverElement.addEventListener("pointerenter", handlePointerEnter);
        hoverElement.addEventListener("pointerleave", handlePointerLeave);
        return () => {
            hoverElement.removeEventListener("pointerenter", handlePointerEnter);
            hoverElement.removeEventListener("pointerleave", handlePointerLeave);
        };
    }, [isMobile]);

    const messageEditingForThisMessage =
        // If we're on a mobile device (with keyboard toolbars) then instead of editing
        // a message inline, we edit it within the sticky `<MessageInput>`.
        !isMobile &&
        messageEditing.state.isEditing &&
        !message.isOptimistic &&
        messageEditing.state.messageRoomKey === message.getRoomKey() &&
        messageEditing.state.messageIndex === message.index
            ? messageEditing
            : null;

    const onReplyToMessage = useEvent(() => {
        // If we're currently editing a message on mobile then cancel editing when
        // trying to reply to a message. Otherwise `<MessageInput>` will override the
        // reply state with editing state.
        if (isMobile && messageEditing.state.isEditing) {
            messageEditing.dispatch({type: "CancelEditing"});
        }

        onReplyToMessageProp();
    });

    const messageEditorRef = useRef<MessageViewEditorRef>(null);
    const returnFocusAfterMessageEditingRef = useRef<(() => void) | null>(null);
    const hasMessageEditingConfirmationDialogRef = useRef(false);

    useEffect(() => {
        // When we finish editing, call the return focus function if there was one on
        // our message editing state.
        {
            const returnFocusAfterEditing =
                messageEditingForThisMessage && messageEditing.state.isEditing
                    ? messageEditing.state.returnFocusAfterEditing
                    : null;

            if (
                returnFocusAfterMessageEditingRef.current !== null &&
                returnFocusAfterEditing === null
            ) {
                returnFocusAfterMessageEditingRef.current();
            }

            returnFocusAfterMessageEditingRef.current = returnFocusAfterEditing;
        }

        // If a confirmation dialog modal closes and we're still editing then return focus
        // to the message editor.
        {
            const hasConfirmationDialog =
                !!messageEditingForThisMessage &&
                messageEditing.state.isEditing &&
                messageEditing.state.confirmationDialog !== null;

            if (
                hasMessageEditingConfirmationDialogRef.current &&
                !hasConfirmationDialog &&
                messageEditingForThisMessage
            ) {
                messageEditorRef.current?.focus();
            }

            hasMessageEditingConfirmationDialogRef.current = hasConfirmationDialog;
        }
    }, [messageEditing.state, messageEditingForThisMessage]);

    const [shouldShowOptimisticLoadingIndicator, setShouldShowOptimisticLoadingShimmer] =
        useState(false);

    const shouldShowOptimisticLoadingIndicatorAfterDelay =
        message.isOptimistic && !message.optimisticRequestErrorState.hasError;

    useEffect(() => {
        if (!shouldShowOptimisticLoadingIndicatorAfterDelay) {
            setShouldShowOptimisticLoadingShimmer(false);
            return;
        }

        const timeout = createTimeout(() => {
            setShouldShowOptimisticLoadingShimmer(true);
            // Use a longer timeout than `delayLoadingIndicatorLimitMs` since most of the
            // time the optimistic placement is the correct end state.
        }, 1000);

        return () => {
            timeout.clear();
        };
    }, [shouldShowOptimisticLoadingIndicatorAfterDelay]);

    const [shouldHighlight, setShouldHighlight] = useState(false);
    const isPeekAnimatingOpen = useIsPeekAnimatingOpen();

    // If the ref we were provided told us to highlight then update our state and
    // clear the ref so we only highlight once for the ref.
    useEffect(() => {
        // Delay our message highlight animation until after the peek is open.
        if (isPeekAnimatingOpen) return;

        if (!shouldHighlightRef?.current) return;

        // Wait a bit before highlighting in case this component is immediately
        // unmounted. This will happen if while measuring content the virtualized
        // scroll view thinks this is offscreen before our scroll anchoring puts it
        // back in place. Arguably this is a bug in the virtualized scroll view.
        const timeout = createTimeout(() => {
            if (!shouldHighlightRef?.current) return;
            shouldHighlightRef.current = false;

            setShouldHighlight(true);
        }, 10);

        return () => timeout.clear();
    }, [isPeekAnimatingOpen, shouldHighlightRef]);

    useEffect(() => {
        if (!shouldHighlight) return;

        const timeout = createTimeout(() => {
            setShouldHighlight(false);
        }, wiggleAnimationDuration);

        return () => {
            timeout.clear();
        };
    }, [shouldHighlight]);

    const [showDeleteConfirmationDialog, setShowDeleteConfirmationDialog] = useState(false);

    const messageTextForBigEmojiMessage = useMemo(() => {
        if (message.payload.type !== "Content") return null;

        if (
            message.payload.content.doc.marks.length === 0 &&
            message.payload.content.doc.childCount === 1 &&
            message.payload.content.doc.firstChild!.type.name === "paragraph" &&
            message.payload.content.doc.firstChild!.marks.length === 0 &&
            message.payload.content.doc.firstChild!.childCount === 1 &&
            message.payload.content.doc.firstChild!.firstChild!.type.name === "text" &&
            message.payload.content.doc.firstChild!.firstChild!.marks.length === 0
        ) {
            const text = message.payload.content.doc.firstChild!.firstChild!.text!;
            if (shouldDisplayTextAsBigEmojiMessage(text)) {
                return text;
            }
        }
        return null;
    }, [message.payload]);

    const hasParentMessage = !!parentMessage;

    const [showTouchReplyIcon, setShowTouchReplyIcon] = useState(false);
    const [touchLightboxState, setTouchLightboxState] = useState<{
        initialMessageTop: number;
        getMessageTop: () => number;
    } | null>(null);

    useEffect(() => {
        if (message.payload.type !== "Content") return;

        // Reattach event listeners if the message payload changes. The `messageRef`
        // element may switch between deleted, emoji, and regular messages.
        //
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        message.payload;

        const messageElement = assertExists(messageRef.current);
        const containerElement = assertExists(containerRef.current);
        const accountNameElement = hasParentMessage ? assertExists(accountNameRef.current) : null;
        const parentMessageElement = hasParentMessage
            ? assertExists(parentMessageRef.current)
            : null;

        let touchState: {
            gesture: "Reply" | "Other" | null;
            hasReplyGestureActivated: boolean;
            initialClientX: number;
            initialClientY: number;
            longTouchTimeout: Timeout | null;
            finishGesture: (() => Promise<void>) | null;
        } | null = null;

        const handleTouchStart = (event: TouchEvent) => {
            touchState?.longTouchTimeout?.clear();
            void touchState?.finishGesture?.();
            touchState = null;

            // If the user can hover, let them hover over the message to see message
            // actions. Instead of opening a lightbox on touch which conflicts with text
            // selection.
            if (canPrimaryInputHover) {
                setShowTouchReplyIcon(false);
                return;
            }

            if (event.touches.length > 1) {
                setShowTouchReplyIcon(false);
                return;
            }

            // If the user is touching a link, then a long press won't open the lightbox.
            // Instead it will open the link.
            if (event.target instanceof HTMLElement) {
                let element: HTMLElement | null = event.target;
                while (element) {
                    if (element.classList.contains(contentSchemaStyles.linkClassName)) {
                        return;
                    }
                    element = element.parentElement;
                }
            }

            // Emulate a `UILongPressGestureRecognizer` on iOS. Which [waits for a touch to
            // last 0.5 seconds][1] before firing.
            //
            // [1]: https://developer.apple.com/documentation/uikit/uilongpressgesturerecognizer/1616423-minimumpressduration
            const longTouchTimeout = createTimeout(() => {
                if (touchState?.longTouchTimeout === longTouchTimeout)
                    touchState.longTouchTimeout = null;

                // Unfocus whatever the focused element is to close the keyboard.
                if (document.activeElement instanceof HTMLElement) {
                    document.activeElement.blur();
                }

                const initialMessageTop = (
                    hasParentMessage ? containerElement : messageElement
                ).getBoundingClientRect().top;

                // NOCOMMIT: Haptic feedback when opening lightbox
                setTouchLightboxState({
                    initialMessageTop,
                    getMessageTop: () => {
                        // Safeguard against the message being removed from the DOM.
                        if (!document.body.contains(messageElement)) return initialMessageTop;

                        return (
                            hasParentMessage ? containerElement : messageElement
                        ).getBoundingClientRect().top;
                    },
                });
            }, 500);

            const touch = event.touches[0]!;

            touchState = {
                gesture: null,
                hasReplyGestureActivated: false,
                initialClientX: touch.clientX,
                initialClientY: touch.clientY,
                longTouchTimeout,
                finishGesture: null,
            };
            setShowTouchReplyIcon(true);
        };

        const handleTouchEnd = () => {
            touchState?.longTouchTimeout?.clear();
            const gestureFinishedPromise = touchState?.finishGesture?.();
            const hasReplyGestureActivated = touchState?.hasReplyGestureActivated ?? false;
            touchState = null;
            if (!gestureFinishedPromise) {
                setShowTouchReplyIcon(false);
            } else {
                gestureFinishedPromise.finally(() => setShowTouchReplyIcon(false));
            }

            if (hasReplyGestureActivated) {
                onReplyToMessage();
            }
        };

        const handleTouchMove = (event: TouchEvent) => {
            touchState?.longTouchTimeout?.clear();
            if (touchState) touchState.longTouchTimeout = null;

            if (touchState && event.touches.length === 1) {
                const touch = event.touches[0]!;

                if (touchState.gesture === null) {
                    if (Math.abs(touch.clientX - touchState.initialClientX) >= 10) {
                        if (touch.clientX < touchState.initialClientX) {
                            touchState.gesture = "Other";
                        } else {
                            touchState.gesture = "Reply";

                            touchState.finishGesture = () => {
                                const elements = [messageElement];
                                if (accountNameElement) elements.push(accountNameElement);
                                if (parentMessageElement) elements.push(parentMessageElement);

                                const touchReplyIconElement = touchReplyIconRef.current;

                                const animation = timeline(
                                    [
                                        [
                                            elements,
                                            {x: 0},
                                            {
                                                easing: parseCubicBezier(easeOutExpo.cubicBezier),
                                                // Make sure we use hardware acceleration for this animation in WebKit. By
                                                // default `motion` turns it off.
                                                // https://motion.dev/guides/performance#webkits-exceptions
                                                allowWebkitAcceleration: true,
                                            },
                                        ],
                                        [
                                            touchReplyIconElement ?? [],
                                            {x: 0, opacity: 0},
                                            {
                                                at: 0,
                                                easing: parseCubicBezier(easeOutExpo.cubicBezier),
                                                // Make sure we use hardware acceleration for this animation in WebKit. By
                                                // default `motion` turns it off.
                                                // https://motion.dev/guides/performance#webkits-exceptions
                                                allowWebkitAcceleration: true,
                                            },
                                        ],
                                    ],
                                    {
                                        duration: 0.5,
                                    },
                                );

                                return animation.finished;
                            };
                        }
                    } else if (Math.abs(touch.clientY - touchState.initialClientY) >= 10) {
                        touchState.gesture = "Other";
                    }
                }

                if (touchState.gesture === "Reply") {
                    event.preventDefault();

                    const translateX = Math.max(
                        0,
                        (touch.clientX - touchState.initialClientX - 10) *
                            // We slow the drag animation down to make it feel like the user is dragging
                            // something heavy. But also this ends up smoothing out the animation! We only
                            // get `touchmove` events every whole pixel. But on devices like iPhone every
                            // virtual pixel is actually rendered by 2 to 3 hardware pixels. So animating
                            // 1:1 with `touchmove` events can looking subtly coarse since we're jumping
                            // across multiple hardware pixels per move.
                            (1 / 3),
                    );

                    const elements = [messageElement];
                    if (accountNameElement) elements.push(accountNameElement);
                    if (parentMessageElement) elements.push(parentMessageElement);

                    const touchReplyIconElement = touchReplyIconRef.current;

                    const remPx = getRemPxWithoutListening();

                    const maxTouchReplyIconElementTranslateX =
                        messageViewTouchReplyIconStartOffsetRem * remPx;

                    const touchReplyIconElementTranslateX = Math.min(
                        Math.max(
                            0,
                            translateX -
                                // Start translating the touch reply icon once the message bubble has moved out
                                // of the way.
                                (messageViewTouchReplyIconSizeRem -
                                    messageViewTouchReplyIconStartOffsetRem) *
                                    remPx,
                        ) *
                            // The touch reply icon should move slower than the message bubble.
                            (1 / 2),
                        // The touch reply icon finishes its animation once its left edge is where the
                        // message bubble left edge started.
                        maxTouchReplyIconElementTranslateX,
                    );

                    // NOCOMMIT: Haptic feedback when reply gesture activates.
                    if (touchReplyIconElementTranslateX === maxTouchReplyIconElementTranslateX) {
                        touchState.hasReplyGestureActivated = true;
                    } else {
                        touchState.hasReplyGestureActivated = false;
                    }

                    timeline(
                        [
                            [elements, {x: translateX}],
                            [
                                touchReplyIconElement ?? [],
                                {
                                    x: touchReplyIconElementTranslateX,
                                    opacity:
                                        touchReplyIconElementTranslateX /
                                        maxTouchReplyIconElementTranslateX,
                                },
                                {at: 0},
                            ],
                        ],
                        {duration: 0},
                    );
                }
            }
        };

        const handleTouchCancel = () => {
            touchState?.longTouchTimeout?.clear();
            const gestureFinishedPromise = touchState?.finishGesture?.();
            touchState = null;

            if (!gestureFinishedPromise) {
                setShowTouchReplyIcon(false);
            } else {
                gestureFinishedPromise.finally(() => setShowTouchReplyIcon(false));
            }
        };

        messageElement.addEventListener("touchstart", handleTouchStart);
        messageElement.addEventListener("touchend", handleTouchEnd);
        messageElement.addEventListener("touchmove", handleTouchMove, {passive: false});
        messageElement.addEventListener("touchcancel", handleTouchCancel);

        return () => {
            messageElement.removeEventListener("touchstart", handleTouchStart);
            messageElement.removeEventListener("touchend", handleTouchEnd);
            messageElement.removeEventListener("touchmove", handleTouchMove);
            messageElement.removeEventListener("touchcancel", handleTouchCancel);
        };
    }, [canPrimaryInputHover, hasParentMessage, message.payload, onReplyToMessage]);

    // We try to memoize any UI in this component that changes infrequently to
    // speed up React rendering. Because `<MessageView>` renders during scroll
    // animations it's important to keep it fast.
    const contentPayloadNode = useMemo(() => {
        if (message.payload.type !== "Content") return null;

        // Render the message as a big emoji message if the content is just emojis.
        if (messageTextForBigEmojiMessage) {
            const children = [];

            let lastIndex = 0;
            for (const {index, emoji} of iterateEmojis(messageTextForBigEmojiMessage)) {
                if (lastIndex !== index) {
                    children.push(
                        <Fragment key={lastIndex}>
                            {messageTextForBigEmojiMessage.slice(lastIndex, index)}
                        </Fragment>,
                    );
                }

                children.push(
                    <span key={index} style={{fontFamily: emojiFontFamily}}>
                        {emoji}
                    </span>,
                );

                lastIndex = index + emoji.length;
            }

            if (lastIndex !== messageTextForBigEmojiMessage.length - 1) {
                children.push(
                    <Fragment key={lastIndex}>
                        {messageTextForBigEmojiMessage.slice(lastIndex)}
                    </Fragment>,
                );
            }

            return (
                <div
                    ref={messageRef}
                    className={sprinkles({
                        paddingLeft: "1",
                        fontSize: "600",
                        userSelect: canPrimaryInputHover ? "text" : "none",
                        pointerEvents: "auto",
                        // Hide message while lightbox is open so its blur doesn't bleed into
                        // the background.
                        opacity: touchLightboxState ? "0" : undefined,
                    })}
                >
                    {children}
                    {message.payload.contentUpdatedTime && (
                        <Tooltip
                            placement="bottom"
                            content={
                                <PrettyAbsoluteDateTooltipContent
                                    date={message.payload.contentUpdatedTime}
                                />
                            }
                        >
                            <span
                                className={contentViewStyles.updatedNoteClassName}
                                style={{paddingLeft: spacing["1"]}}
                            >
                                {" "}
                                (updated)
                            </span>
                        </Tooltip>
                    )}
                </div>
            );
        }

        return (
            <div
                ref={messageRef}
                className={sprinkles({
                    position: "relative",
                    zIndex: "20",
                    backgroundColor: "grey-5",
                    maxWidth: "full",
                    overflow: "hidden",
                    display: "inline-block",
                    paddingX: messageViewBubblePaddingX,
                    paddingY: messageViewBubblePaddingY,
                    borderTopLeftRadius: !shouldMergeWithPreviousMessage
                        ? messageViewBubbleBorderRadius
                        : messageViewBubbleMergedBorderRadius,
                    borderTopRightRadius: messageViewBubbleBorderRadius,
                    borderBottomLeftRadius: !shouldMergeWithNextMessage
                        ? messageViewBubbleBorderRadius
                        : messageViewBubbleMergedBorderRadius,
                    borderBottomRightRadius: messageViewBubbleBorderRadius,
                    pointerEvents: "auto",
                    // Hide message while lightbox is open so its blur doesn't bleed into
                    // the background.
                    opacity: touchLightboxState ? "0" : undefined,
                })}
            >
                <ContentView
                    content={message.payload.content}
                    contentUpdatedTime={message.payload.contentUpdatedTime}
                    className={sprinkles({minWidth: messageViewBubbleMinWidth})}
                    withUserSelectNone={!canPrimaryInputHover}
                />
            </div>
        );
    }, [
        canPrimaryInputHover,
        message.payload,
        messageTextForBigEmojiMessage,
        shouldMergeWithNextMessage,
        shouldMergeWithPreviousMessage,
        touchLightboxState,
    ]);

    const deletedPayloadNode = useMemo(() => {
        if (message.payload.type !== "Deleted") return null;

        return (
            <div
                className={sprinkles({
                    position: "relative",
                    zIndex: "20",
                    paddingX: messageViewBubblePaddingX,
                    paddingY: messageViewBubblePaddingY,
                    display: "flex",
                    alignItems: "center",
                    borderTopLeftRadius: !shouldMergeWithPreviousMessage
                        ? messageViewBubbleBorderRadius
                        : messageViewBubbleMergedBorderRadius,
                    borderTopRightRadius: messageViewBubbleBorderRadius,
                    borderBottomLeftRadius: !shouldMergeWithNextMessage
                        ? messageViewBubbleBorderRadius
                        : messageViewBubbleMergedBorderRadius,
                    borderBottomRightRadius: messageViewBubbleBorderRadius,
                    userSelect: canPrimaryInputHover ? "text" : "none",
                })}
                style={{
                    boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`,
                }}
            >
                <div
                    className={sprinkles({
                        paddingX: "2",
                        color: "grey-40",
                        fontSize: "75",
                    })}
                    style={{lineHeight: paragraphFontSize.lineHeight}}
                >
                    {`${messageStartOfSentenceNoun} deleted`}
                </div>
            </div>
        );
    }, [
        canPrimaryInputHover,
        message.payload.type,
        messageStartOfSentenceNoun,
        shouldMergeWithNextMessage,
        shouldMergeWithPreviousMessage,
    ]);

    const parentMessageNode = useMemo(() => {
        if (!parentMessage) return null;

        let height = addRemLengths(spacing["1.5"], contentViewStyles.truncatedHeight);

        // Remove some vertical padding from the parent message to move it closer to a
        // big emoji message which doesn't render in a bubble.
        if (!messageTextForBigEmojiMessage) height = addRemLengths(height, spacing["1.5"]);

        const scaledHeight = `${
            Math.round(parseRemLengthNumber(height) * messageViewPreviewScale * 16) / 16
        }rem`;

        const truncatedContent = getTruncatedMessageContentForReplyPreview({
            message: parentMessage,
            messageStartOfSentenceNoun,
        });

        return (
            <div
                ref={parentMessageRef}
                className={sprinkles({
                    position: "relative",
                    zIndex: "10",
                })}
                style={{
                    height: scaledHeight,
                    paddingLeft: getMessageBubbleMarginLeft(marginX),
                    paddingRight: addRemLengths(
                        spacing["3"],
                        spacing[messageViewActionsWidth],
                        spacing[marginX],
                    ),
                    // Hide message while lightbox is open so its blur doesn't bleed into
                    // the background.
                    opacity: touchLightboxState ? "0" : undefined,
                }}
            >
                <OverlayScopeContextProvider
                // We render an overlay scope here so that a focus ring around the reply
                // preview will render underneath the replying message instead of on top.
                >
                    <FocusRing>
                        <div
                            // This is a simulated link. When the user clicks on it our code navigates us
                            // to the right message instead of relying on browser URL navigation.
                            //
                            // See: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/link_role
                            role="link"
                            tabIndex={0}
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
                                // We don't use a pointer cursor for buttons in our product because buttons
                                // they clearly appear clickable. We call this a strong affordance. A reply
                                // preview is clickable and gives some affordance (different color) but it's a
                                // weak affordance. So we use a pointer to make this element unambiguously
                                // clickable.
                                //
                                // Also, this element is semantically a link which the pointer cursor was
                                // originally designed for.
                                //
                                // See: https://medium.com/simple-human/buttons-shouldnt-have-a-hand-cursor-b11e99ca374b
                                cursor: "pointer",
                            })}
                            style={{
                                opacity: messageViewReplyPreviewOpacity,
                                transform: `scale(${messageViewPreviewScale})`,
                                transformOrigin: "0% 0% 0",
                            }}
                            onClick={() => onJumpToMessage(parentMessage)}
                            onKeyDown={event => {
                                if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onJumpToMessage(parentMessage);
                                    return;
                                }
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
                                    withUserSelectNone={true}
                                    content={truncatedContent}
                                    className={sprinkles({minWidth: messageViewBubbleMinWidth})}
                                />
                            </div>
                        </div>
                    </FocusRing>
                </OverlayScopeContextProvider>
            </div>
        );
    }, [
        marginX,
        messageStartOfSentenceNoun,
        messageTextForBigEmojiMessage,
        onJumpToMessage,
        parentMessage,
        touchLightboxState,
    ]);

    const timestampDividerNode = useMemo(() => {
        const shouldShowTimestampBeforeMessage = isFirstMessage
            ? !roomDisplayedCreatedTime ||
              differenceInMinutes(message.createdTime, roomDisplayedCreatedTime) >
                  minMessageViewTimestampDividerElapsedMinutes
            : previousMessage &&
              differenceInMinutes(message.createdTime, previousMessage.createdTime) >
                  minMessageViewTimestampDividerElapsedMinutes;
        if (!shouldShowTimestampBeforeMessage) return null;

        const formattedDate = formatMessageViewTimestampDividerDate(message.createdTime, {
            currentTime,
            locale,
            timeZone,
        });

        return (
            <div
                className={sprinkles({
                    paddingTop: "8",
                    paddingBottom: "2",
                    display: "flex",
                    justifyContent: "center",
                    fontSize: "50",
                    fontStyle: "truncate",
                    color: "grey-50",
                })}
            >
                {formattedDate}
            </div>
        );
    }, [
        currentTime,
        isFirstMessage,
        locale,
        message.createdTime,
        previousMessage,
        roomDisplayedCreatedTime,
        timeZone,
    ]);

    // IMPORTANT(calebmer): Be careful about what you put in this component!
    // `<MessageView>` needs to render fast for us to get good FPS when scrolling
    // through messages. We've directly observed slow hook implementations or too
    // many sub-components slowing down FPS. (Reason why we don't allow `<Box>` in
    // this file.) Before adding new logic to this render function, consider
    // whether you could add it to a child component. Or inline some of the logic.

    return (
        <>
            {timestampDividerNode}
            <div
                ref={containerRef}
                className={sprinkles({
                    width: "full",
                    maxWidth: "160",
                    position: "relative",
                    zIndex: "0",
                })}
                style={{
                    margin: "0 auto",
                    animation: shouldHighlight ? wiggleAnimation : undefined,
                }}
                data-testid={`MessageView:${
                    message.isOptimistic
                        ? `optimistic:${message.optimisticId}`
                        : `${message.getRoomKey()}:${message.index}`
                }`}
            >
                {useMemo(
                    () =>
                        !shouldMergeWithPreviousMessage && (
                            <div
                                ref={accountNameRef}
                                className={sprinkles({
                                    fontSize: "50",
                                    fontStyle: "truncate",
                                    paddingTop: parentMessage === null ? "0.5" : "1",
                                    paddingBottom: parentMessage === null ? "0.5" : "1",
                                    paddingRight: marginX,
                                    color: "grey-50",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "0.5",
                                })}
                                style={{
                                    paddingLeft: addRemLengths(
                                        getMessageBubbleMarginLeft(marginX),
                                        parentMessage === null ? spacing["1.5"] : spacing["1"],
                                    ),
                                    // Hide message while lightbox is open so its blur doesn't bleed into
                                    // the background.
                                    opacity:
                                        parentMessage !== null && touchLightboxState
                                            ? "0"
                                            : undefined,
                                }}
                            >
                                {parentMessage !== null && <ArrowArcLeft size={spacing["3"]} />}
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
                            </div>
                        ),
                    [
                        marginX,
                        message.author,
                        parentMessage,
                        shouldMergeWithPreviousMessage,
                        touchLightboxState,
                    ],
                )}
                {parentMessageNode}
                <div
                    ref={hoverRef}
                    className={sprinkles({
                        display: "flex",
                        paddingX: marginX,
                        paddingBottom: !shouldMergeWithNextMessage
                            ? messageViewMarginY
                            : messageViewMergedMarginY,
                        maxWidth: "full",
                    })}
                    style={{
                        // The width of the element should fit its content, not extend to 100% of the
                        // parent width. This way the hover target will just be the message, its
                        // actions, and some padding. Moving your mouse around in empty space won't
                        // cause a bunch of message actions to appear/disappear.
                        width: "fit-content",
                    }}
                >
                    {useMemo(
                        () => (
                            <div
                                className={sprinkles({
                                    flexShrink: "0",
                                    paddingRight: "2",
                                })}
                            >
                                <div
                                    className={sprinkles({
                                        width: "7",
                                        height: "full",
                                        display: "flex",
                                        alignItems: "flex-end",
                                    })}
                                >
                                    {!shouldMergeWithNextMessage && (
                                        <div className={sprinkles({paddingY: "0.5"})}>
                                            <AccountAvatar account={message.author} size="7" />
                                        </div>
                                    )}
                                </div>
                            </div>
                        ),
                        [message.author, shouldMergeWithNextMessage],
                    )}
                    {message.payload.type === "Content" ? (
                        !messageEditingForThisMessage ? (
                            <div
                                className={sprinkles({
                                    flexGrow: "1",
                                    display: "flex",
                                    position: "relative",
                                    zIndex: "10",
                                    // No pointer events so if we are a small message rendering on top of a large
                                    // parent message then the part of the parent message that underlaps our
                                    // message bubble is clickable.
                                    pointerEvents: "none",
                                })}
                                style={{
                                    maxWidth: `calc(100% - ${spacing["9"]})`,
                                }}
                            >
                                {showTouchReplyIcon && (
                                    <div
                                        ref={touchReplyIconRef}
                                        className={sprinkles({
                                            position: "absolute",
                                            left: `-${messageViewTouchReplyIconStartOffset}`,
                                            width: messageViewTouchReplyIconSize,
                                            height: messageViewTouchReplyIconSize,
                                            display: "flex",
                                            justifyContent: "center",
                                            alignItems: "center",
                                            color: "grey-70",
                                            backgroundColor: "grey-5",
                                            borderRadius: "full",
                                            pointerEvents: "none",
                                            // Start at opacity 0 and our animation will make it visible.
                                            opacity: "0",
                                        })}
                                        style={{
                                            top: `calc(50% - ${spacing["2.5"]})`,
                                        }}
                                    >
                                        <ArrowArcLeft size={spacing["3"]} />
                                    </div>
                                )}
                                {contentPayloadNode}
                                <div
                                    className={sprinkles({
                                        alignSelf: "center",
                                        paddingLeft: "3",
                                        pointerEvents: "auto",
                                    })}
                                >
                                    <div
                                        className={sprinkles({
                                            width: messageViewActionsWidth,
                                            position: "relative",
                                            zIndex: "20",
                                        })}
                                    >
                                        {message.isOptimistic &&
                                        message.optimisticRequestErrorState.hasError ? (
                                            <div>
                                                <IconButton
                                                    // NOTE(calebmer): I think we can use "click" in copy here since the
                                                    // description is part of a tooltip which is fundamentally a mouse/pointer
                                                    // thing. On mobile we need to pop open a modal or alert or something.
                                                    description={`Couldn’t create ${messageNoun}. Click to try again`}
                                                    size="sm"
                                                    onPress={
                                                        message.optimisticRequestErrorState.retry
                                                    }
                                                >
                                                    <ErrorIcon />
                                                </IconButton>
                                            </div>
                                        ) : shouldShowOptimisticLoadingIndicator ? (
                                            <div>
                                                <SpinnerGap
                                                    className={spinAnimationClassName}
                                                    size={spacing["4"]}
                                                />
                                            </div>
                                        ) : (
                                            // If the primary input device can't hover, improve performance by not
                                            // rendering message view actions.
                                            canPrimaryInputHover &&
                                            !message.isOptimistic &&
                                            !disableExpensiveFeaturesDuringScroll &&
                                            !shouldHighlight && (
                                                <MessageViewActions
                                                    messageNoun={messageNoun}
                                                    message={message}
                                                    messagePayload={message.payload}
                                                    messageEditing={messageEditing}
                                                    isHovered={isHovered}
                                                    onReplyToMessage={onReplyToMessage}
                                                    onShowDeleteConfirmationDialog={() =>
                                                        setShowDeleteConfirmationDialog(true)
                                                    }
                                                    getMessageUrl={getMessageUrl}
                                                />
                                            )
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <MessageViewEditor
                                ref={messageEditorRef}
                                messageNoun={messageNoun}
                                messageStartOfSentenceNoun={messageStartOfSentenceNoun}
                                shouldMergeWithPreviousMessage={shouldMergeWithPreviousMessage}
                                shouldMergeWithNextMessage={shouldMergeWithNextMessage}
                                messageEditing={messageEditing}
                            />
                        )
                    ) : (
                        deletedPayloadNode
                    )}
                </div>
                {messageEditingForThisMessage?.state.isEditing &&
                    messageEditingForThisMessage.state.confirmationDialog === "Save" && (
                        <ModalDialog
                            title={`Save ${messageNoun}`}
                            description={`Would you like to save the changes you made to this ${messageNoun}?`}
                            onClose={() =>
                                messageEditingForThisMessage.dispatch({
                                    type: "CloseConfirmingDialog",
                                    confirmationDialog: "Save",
                                })
                            }
                            primaryButtonLabel="Save"
                            onPrimaryButtonPress={() => {
                                messageEditing.dispatch({
                                    type: "SaveEditedContent",
                                    messageNoun,
                                });
                            }}
                            cancelButtonLabel="Discard changes"
                            onCancelButtonPress={() => {
                                messageEditing.dispatch({type: "CancelEditing"});
                            }}
                        />
                    )}
                {messageEditingForThisMessage?.state.isEditing &&
                    messageEditingForThisMessage.state.confirmationDialog === "Delete" && (
                        <MessageDeleteConfirmationDialog
                            messageNoun={messageNoun}
                            onClose={() =>
                                messageEditingForThisMessage.dispatch({
                                    type: "CloseConfirmingDialog",
                                    confirmationDialog: "Delete",
                                })
                            }
                            onDeleteMessage={onDeleteMessage}
                        />
                    )}
            </div>
            {showDeleteConfirmationDialog && (
                <MessageDeleteConfirmationDialog
                    messageNoun={messageNoun}
                    onClose={() => setShowDeleteConfirmationDialog(false)}
                    onDeleteMessage={onDeleteMessage}
                />
            )}
            {touchLightboxState && (
                <MessageViewTouchLightbox
                    messageNoun={messageNoun}
                    messageStartOfSentenceNoun={messageStartOfSentenceNoun}
                    message={message}
                    messageTextForBigEmojiMessage={messageTextForBigEmojiMessage}
                    parentMessage={parentMessage}
                    initialMessageTop={touchLightboxState.initialMessageTop}
                    getMessageTop={touchLightboxState.getMessageTop}
                    shouldMergeWithNextMessage={shouldMergeWithNextMessage}
                    shouldMergeWithPreviousMessage={shouldMergeWithPreviousMessage}
                    messageEditing={messageEditing}
                    onReplyToMessage={onReplyToMessage}
                    onShowDeleteConfirmationDialog={() => setShowDeleteConfirmationDialog(true)}
                    getMessageUrl={getMessageUrl}
                    onClose={() => setTouchLightboxState(null)}
                />
            )}
        </>
    );
}

/**
 * Get the content to render in a reply preview of a message. A content payload
 * will be truncated to enough content to fill a single line. A deleted payload
 * will show a placeholder informing the user the message is deleted.
 */
export function getTruncatedMessageContentForReplyPreview({
    message,
    messageStartOfSentenceNoun,
}: {
    message: MessageModel;
    messageStartOfSentenceNoun: string;
}): MessageContentWithReferences {
    switch (message.payload.type) {
        case "Content": {
            return {
                doc: assertMessageContent(
                    getContentSnippet(message.payload.content.doc.resolve(0), 1),
                ),
                references: message.payload.content.references,
            };
        }
        case "Deleted": {
            // NOTE(calebmer): We render deleted messages with the same style as a normal
            // message in a reply because if we render with the deleted style (no
            // background, 1px border) it's just too light when scaled down and made
            // translucent. The user can click on the reply to jump to the actual message
            // with the correct treatment.
            return {
                doc: assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text(
                                `${messageStartOfSentenceNoun} deleted`,
                                [MessageContentProsemirrorSchema.mark("italic")],
                            ),
                        ]),
                    ]),
                ),
                references: emptyContentReferences,
            };
        }
        default:
            throw exhaustive(message.payload);
    }
}
