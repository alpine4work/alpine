import classNames from "classnames";
import {differenceInMinutes} from "date-fns/differenceInMinutes";
import {timeline} from "motion";
import {ArrowArcLeft, SpinnerGap, Trash} from "phosphor-react";
import {
    Fragment,
    Memo,
    MutableRefObject,
    ReactNode,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {AccountShortName} from "~/client/accounts/account_short_name.js";
import {ContentView} from "~/client/content/content_view.js";
import {ErrorIcon} from "~/client/design/error_icon.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {IconButton} from "~/client/design/icon_button.js";
import {OverlayScopeContextProvider} from "~/client/design/overlay_scope_context_provider.js";
import {
    PrettyAbsoluteDate,
    PrettyAbsoluteDateTooltipContent,
} from "~/client/design/pretty_absolute_date.js";
import {scheduleAfterNavigationAnimation} from "~/client/design/schedule_after_navigation_animation.js";
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
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {useCanPrimaryInputHover, usePlatform} from "~/client/remix/platform_context.js";
import {getRemPxWithoutListening} from "~/client/remix/spacing_scale_context.js";
import {useCurrentTimeRoundedToHour} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {
    getMessageBubbleMarginLeft,
    messageView2AccountNameFontSize,
    messageView2AccountNameMarginBottom,
    messageView2AvatarOffsetY,
    messageView2AvatarSize,
    messageView2RailGap,
    messageViewActionsWidth,
    messageViewActionsWidthWithoutHoveringPrimaryInput,
    messageViewBubbleBorderRadius,
    messageViewBubbleMergedBorderRadius,
    messageViewBubbleMinWidth,
    messageViewBubblePaddingX,
    messageViewBubblePaddingY,
    messageViewMarginY,
    messageViewMaxWidth,
    messageViewMergedMarginY,
    messageViewParentAvatarSize,
    messageViewReplyPreviewBubbleOpacity,
    messageViewParentFontSize,
    messageViewParentLineHeight,
    messageViewReplyPreviewOpacity,
    messageViewParentScale,
    messageView2AvatarOffsetYRem,
} from "~/client/styles/messaging_shared_styles.js";
import {
    colorSchemeVars,
    contentStyles,
    contentViewStyles,
    emojiFontFamily,
    fontSizes,
    spinAnimationClassName,
    sprinkles,
    wiggleAnimation,
    wiggleAnimationDuration,
} from "~/client/styles/styles.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {ContentBlockNodeTypeName} from "~/shared/content/content_node_type_name.js";
import {
    linkClassName,
    paragraphClassName,
    quoteBlockClassName,
} from "~/shared/content/content_styles.js";
import {easeOutExpo, parseCubicBezier} from "~/shared/design/core/easing.js";
import {
    RemLength,
    Spacing,
    addRemLengths,
    assertSpacing,
    parseRemLength,
    screenPaddingX,
    spacing,
    subtractRemLengths,
} from "~/shared/design/core/spacing.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {iterateEmojis} from "~/shared/helpers/string/iterate_emojis.js";
import {getTruncatedMessageContentForReplyPreview} from "~/client/messaging/get_truncated_message_content_for_reply_preview.js";
import {
    MessageModel,
    MessageModelBase,
    OptimisticMessageModel,
} from "~/shared/messaging/message_model.js";
import {minMessageViewTimestampDividerElapsedMinutes} from "~/shared/notifications/min_message_view_timestamp_divider_elapsed_minutes.js";
import {useAccountModel} from "~/client/accounts/account_client_store_context.js";
import {usePress} from "@react-aria/interactions";

// NOCOMMIT: Test
//
// - Emoji messages
// - Message editing
// - Deleted messages
// - Message timestamps
// - Message replies

/**
 * The buffered height we use for virtualized message views.
 *
 * Calculated by rendering 10,000 `<MessageShimmer>`s and get the height
 * divided by the number of messages. Approximately this value.
 */
export const bufferedMessageViewHeight: RemLength = "4rem";

const mergeMessageMinuteLimit = 5;

const messageViewTouchReplyIconSize = "5";
const messageViewTouchReplyIconSizeRem = parseRemLength(messageViewTouchReplyIconSize);

const messageViewTouchReplyIconStartOffset = "1.5";
const messageViewTouchReplyIconStartOffsetRem = parseRemLength(
    messageViewTouchReplyIconStartOffset,
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
function shouldMergeMessages(message1: MessageModelBase, message2: MessageModelBase): boolean {
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
    paddingX = screenPaddingX,
    centeringMarginRight,
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
    paddingX?: Spacing | Memo<{mobile: Spacing; desktop: Spacing}>;
    centeringMarginRight?: Spacing;
}) {
    const platform = usePlatform();
    const canPrimaryInputHover = useCanPrimaryInputHover();
    const {timeZone, locale} = useClientInfo();
    const currentTime = useCurrentTimeRoundedToHour();

    const messageAuthor = useAccountModel(message.author);

    const containerRef = useRef<HTMLDivElement>(null);
    // NOCOMMIT: Attach message ref to better place?
    const messageRef = useRef<HTMLDivElement>(null);
    const touchReplyIconRef = useRef<HTMLDivElement>(null);

    const shouldMergeWithPreviousMessage: boolean =
        !!previousMessage && shouldMergeMessages(previousMessage, message);

    const shouldMergeWithNextMessage: boolean =
        !!nextMessage && shouldMergeMessages(message, nextMessage);

    let marginBottom: Spacing;

    if (!shouldMergeWithNextMessage) {
        marginBottom = messageViewMarginY;
    } else {
        if (
            message.payload.type === "Content" &&
            message.payload.content.doc.childCount > 0 &&
            nextMessage?.payload.type === "Content" &&
            nextMessage.payload.content.doc.childCount > 0 &&
            (hasStandaloneMarginByContentBlockNodeTypeName[
                message.payload.content.doc.lastChild!.type.name
            ] ||
                hasStandaloneMarginByContentBlockNodeTypeName[
                    nextMessage.payload.content.doc.firstChild!.type.name
                ])
        ) {
            marginBottom = contentStyles.standaloneBlockMargin;
        } else {
            marginBottom = contentStyles.paragraphMargin;
        }
    }

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
    //
    // NOCOMMIT: Or is focus within?
    const [isHovered, setIsHovered] = useState(false);
    if (platform === "mobile" && isHovered) setIsHovered(false);

    // NOTE(calebmer): This can't be `onPointerEnter` or `onPointerLeave` props.
    // I've found that React doesn't call `onPointerLeave` when the
    // `<MessageViewActions>` menu closes.
    useEffect(() => {
        if (platform === "mobile") return;

        const containerElement = assertExists(containerRef.current);

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

        containerElement.addEventListener("pointerenter", handlePointerEnter);
        containerElement.addEventListener("pointerleave", handlePointerLeave);
        return () => {
            containerElement.removeEventListener("pointerenter", handlePointerEnter);
            containerElement.removeEventListener("pointerleave", handlePointerLeave);
        };
    }, []);

    const messageEditingForThisMessage =
        // If we're on a mobile device (with keyboard toolbars) then instead of editing
        // a message inline, we edit it within the sticky `<MessageInput>`.
        platform !== "mobile" &&
        messageEditing.state.isEditing &&
        !message.isOptimistic &&
        messageEditing.state.messageRoomKey === message.getRoomKey() &&
        messageEditing.state.messageIndex === message.index
            ? (messageEditing as MessageEditing<RoomKey> & {state: {isEditing: true}})
            : null;

    const isEditingThisMessage = !!messageEditingForThisMessage;

    const onReplyToMessage = useEvent(() => {
        // If we're currently editing a message on mobile then cancel editing when
        // trying to reply to a message. Otherwise `<MessageInput>` will override the
        // reply state with editing state.
        if (platform === "mobile" && messageEditing.state.isEditing) {
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
            const returnFocusAfterEditing = messageEditingForThisMessage
                ? messageEditingForThisMessage.state.returnFocusAfterEditing
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
                messageEditingForThisMessage.state.confirmationDialog !== null;

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

    // If the ref we were provided told us to highlight then update our state and
    // clear the ref so we only highlight once for the ref.
    useEffect(() => {
        if (!shouldHighlightRef?.current) return;

        let cleanup: (() => void) | undefined;

        const unschedule = scheduleAfterNavigationAnimation(() => {
            // Wait a bit before highlighting in case this component is immediately
            // unmounted. This will happen if while measuring content the virtualized
            // scroll view thinks this is offscreen before our scroll anchoring puts it
            // back in place. Arguably this is a bug in the virtualized scroll view.
            const timeout = createTimeout(() => {
                if (!shouldHighlightRef?.current) return;
                shouldHighlightRef.current = false;

                setShouldHighlight(true);
            }, 10);

            cleanup = () => timeout.clear();
        });

        return () => {
            unschedule();
            cleanup?.();
        };
    }, [shouldHighlightRef]);

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

    useEffect(() => {
        // NOCOMMIT: Re-enable effect
        if (true) return;

        if (message.payload.type !== "Content") return;

        // Reattach event listeners if the message payload changes. The `messageRef`
        // element may switch between deleted, emoji, and regular messages.
        //
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        message.payload;

        // If the message is being edited then `messageElement` and other refs won't be
        // mounted.
        if (isEditingThisMessage) return;

        const messageElement = assertExists(messageRef.current);
        const containerElement = assertExists(containerRef.current);
        const accountNameElement = hasParentMessage ? assertExists(accountNameRef.current) : null;
        const parentMessageElement = hasParentMessage
            ? assertExists(parentMessageRef.current)
            : null;

        let touchState: {
            gesture: "Reply" | "Other" | null;
            hasReplyGestureActivated: boolean;
            isReplyGestureDisabled: boolean;
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

            let isReplyGestureDisabled = false;

            if (event.target instanceof HTMLElement) {
                let element: HTMLElement | null = event.target;
                while (element && messageElement.contains(element)) {
                    // If the user is touching a link, then a long press won't open the lightbox.
                    // Instead it will open the link.
                    if (element.classList.contains(linkClassName)) {
                        return;
                    }

                    const {overflowX} = getComputedStyle(element);

                    // If the user is touching a horizontally scrollable element (e.g. a code
                    // block) then disable the reply gesture if it's been scrolled since swiping
                    // horizontally should scroll. Not reply.
                    if (
                        (overflowX === "scroll" ||
                            (overflowX === "auto" && element.scrollWidth > element.clientWidth)) &&
                        element.scrollLeft > 0
                    ) {
                        isReplyGestureDisabled = true;
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

                NativeMobileBridge?.haptic.playMediumImpact();

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

            // Support the case where we have 0 touches since this happens in integration
            // tests. Shouldn't happen in a production browser.
            const touch = event.touches[0] ?? {clientX: 0, clientY: 0};

            touchState = {
                gesture: null,
                hasReplyGestureActivated: false,
                isReplyGestureDisabled,
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
                void gestureFinishedPromise.finally(() => setShowTouchReplyIcon(false));
            }

            if (hasReplyGestureActivated) {
                onReplyToMessage();
            }
        };

        const handleTouchMove = (event: TouchEvent) => {
            touchState?.longTouchTimeout?.clear();
            if (touchState) touchState.longTouchTimeout = null;

            if (!touchState || event.touches.length !== 1) return;
            const touch = event.touches[0]!;

            if (touchState.gesture === null) {
                const clientXDifferenceMagnitude = Math.abs(
                    touch.clientX - touchState.initialClientX,
                );
                const clientYDifferenceMagnitude = Math.abs(
                    touch.clientY - touchState.initialClientY,
                );

                if (clientXDifferenceMagnitude > clientYDifferenceMagnitude) {
                    if (touch.clientX < touchState.initialClientX) {
                        touchState.gesture = "Other";
                    } else if (touchState.isReplyGestureDisabled) {
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
                } else if (clientXDifferenceMagnitude < clientYDifferenceMagnitude) {
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

                if (touchReplyIconElementTranslateX === maxTouchReplyIconElementTranslateX) {
                    if (!touchState.hasReplyGestureActivated) {
                        NativeMobileBridge?.haptic.playHeavyImpact();
                    }

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
        };

        const handleTouchCancel = () => {
            touchState?.longTouchTimeout?.clear();
            const gestureFinishedPromise = touchState?.finishGesture?.();
            touchState = null;

            if (!gestureFinishedPromise) {
                setShowTouchReplyIcon(false);
            } else {
                void gestureFinishedPromise.finally(() => setShowTouchReplyIcon(false));
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
    }, [
        canPrimaryInputHover,
        hasParentMessage,
        isEditingThisMessage,
        message.payload,
        onReplyToMessage,
    ]);

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
                    className={sprinkles({
                        fontSize: "600",
                        userSelect: canPrimaryInputHover ? "text" : "none",
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
            <ContentView
                isBackgroundColorGrey5={true}
                content={message.payload.content}
                contentUpdatedTime={message.payload.contentUpdatedTime}
                withUserSelectNone={!canPrimaryInputHover}
            />
        );
    }, [canPrimaryInputHover, message.payload, messageTextForBigEmojiMessage]);

    const deletedPayloadNode = useMemo(() => {
        if (message.payload.type !== "Deleted") return null;

        return (
            <Tooltip
                placement="bottom"
                content={
                    <>
                        Deleted{" "}
                        <PrettyAbsoluteDateTooltipContent
                            date={message.payload.deletedTime}
                            withoutWeekday
                        />
                    </>
                }
            >
                <div
                    className={sprinkles({
                        display: "inline",
                        color: "grey-60",
                        fontSize: "100",
                        userSelect: "text",
                    })}
                    style={{lineHeight: contentStyles.paragraphFontSize.lineHeight}}
                >
                    <Trash
                        size={spacing["4"]}
                        style={{
                            display: "inline",
                            verticalAlign: "top",
                            position: "relative",
                            // Optically align icon with text.
                            top: "0.1875rem",
                        }}
                    />{" "}
                    Deleted {messageNoun}
                </div>
            </Tooltip>
        );
    }, [message.payload, messageNoun]);

    const parentMessageNode = useMemo(() => {
        if (!parentMessage) return null;

        return (
            <MessageViewParent
                messageNoun={messageNoun}
                parentMessage={parentMessage}
                onJumpToMessage={onJumpToMessage}
            />
        );
    }, [messageNoun, onJumpToMessage, parentMessage]);

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
                    paddingTop: !isFirstMessage ? messageViewMarginY : undefined,
                    paddingBottom: messageViewMarginY,
                    display: "flex",
                    justifyContent: "center",
                    fontSize: "50",
                    fontStyle: "truncate",
                    color: "grey-50",
                    // The timestamp divider should be centered. For UI like `<PostListView>` we
                    // show a guideline to help the user see that comments are a child of the post.
                    // This guideline offsets messages to the left. To center timestamp dividers
                    // with the post we need to apply some extra margin on the right to balance
                    // things out.
                    paddingRight: centeringMarginRight,
                })}
            >
                {formattedDate}
            </div>
        );
    }, [
        centeringMarginRight,
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
                    maxWidth: contentStyles.contentMaxWidth,
                    marginX: "auto",
                    paddingX,
                    paddingBottom: marginBottom,
                })}
                style={{
                    animation: shouldHighlight ? wiggleAnimation : undefined,
                }}
                data-testid={
                    process.env.NODE_ENV !== "production"
                        ? `MessageView:${
                              message.isOptimistic
                                  ? `optimistic:${message.optimisticId}`
                                  : `${message.getRoomKey()}:${message.index}`
                          }`
                        : undefined
                }
            >
                {parentMessageNode}
                <div
                    className={sprinkles({
                        marginX: "center",
                        position: "relative",
                        zIndex: "0",
                        display: "flex",
                        gap: messageView2RailGap,
                    })}
                >
                    {useMemo(
                        () => (
                            <div
                                className={sprinkles({
                                    flexShrink: "0",
                                    width: messageView2AvatarSize,
                                })}
                            >
                                {!shouldMergeWithPreviousMessage && (
                                    <div
                                        className={sprinkles({position: "relative"})}
                                        style={{top: messageView2AvatarOffsetY}}
                                    >
                                        <AccountAvatar
                                            account={messageAuthor}
                                            size={messageView2AvatarSize}
                                        />
                                    </div>
                                )}
                            </div>
                        ),
                        [messageAuthor, shouldMergeWithPreviousMessage],
                    )}
                    <div
                        className={sprinkles({flexGrow: "1"})}
                        style={{
                            // Don't allow item to grow beyond flexbox bounds. By default flexbox items
                            // have `min-width: auto` which extends with content.
                            // https://stackoverflow.com/a/66689926/1568890
                            minWidth: 0,
                        }}
                    >
                        {!shouldMergeWithPreviousMessage && (
                            <div
                                className={sprinkles({
                                    fontSize: messageView2AccountNameFontSize,
                                    fontStyle: "truncate",
                                    paddingBottom: messageView2AccountNameMarginBottom,
                                    color: "grey-60",
                                })}
                            >
                                {messageAuthor.name}
                            </div>
                        )}
                        {/* NOCOMMIT: {parentMessageNode} */}
                        {message.payload.type === "Content" ? (
                            !messageEditingForThisMessage ? (
                                /* NOCOMMIT: {showTouchReplyIcon && (
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
                                )} */
                                contentPayloadNode
                            ) : (
                                /* NOCOMMIT: <div
                                    className={sprinkles({
                                        alignSelf: "center",
                                        paddingLeft: "3",
                                        pointerEvents: "auto",
                                    })}
                                >
                                    <div
                                        className={sprinkles({
                                            width: canPrimaryInputHover
                                                ? messageViewActionsWidth
                                                : messageViewActionsWidthWithoutHoveringPrimaryInput,
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
                                </div> */
                                <MessageViewEditor
                                    ref={messageEditorRef}
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
                    {platform !== "mobile" &&
                        !message.isOptimistic &&
                        message.payload.type === "Content" &&
                        !disableExpensiveFeaturesDuringScroll && (
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
                        )}
                </div>
            </div>
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

function MessageViewParent<RoomKey extends string, Message extends MessageModel<RoomKey>>({
    messageNoun,
    parentMessage,
    onJumpToMessage,
}: {
    messageNoun: string;
    parentMessage: Message;
    onJumpToMessage: Memo<(message: Message) => void>;
}) {
    // NOCOMMIT:
    //
    // // Remove some vertical padding from the parent message to move it closer to a
    // // big emoji message which doesn't render in a bubble.
    // if (!messageTextForBigEmojiMessage) height = addRemLengths(height, spacing["1.5"]);

    const truncatedContent = getTruncatedMessageContentForReplyPreview({
        message: parentMessage,
        messageNoun,
    });

    // NOCOMMIT: Press style?

    const avatarSizeRem = parseRemLength(messageView2AvatarSize);
    const parentOffsetRem = parseRemLength(messageView2RailGap) / 2;
    const parentAvatarSizeRem = parseRemLength(messageViewParentAvatarSize);
    const parentAvatarOffsetYRem =
        (parseRemLength(messageViewParentAvatarSize) -
            parseRemLength(fontSizes[messageViewParentFontSize].lineHeight)) /
        -2;

    const {isPressed, pressProps} = usePress({
        onPress: () => {
            onJumpToMessage(parentMessage);
        },
    });

    return (
        <FocusRing offset="1" insetX="0.5" insetBottom="0.5">
            <div
                {...pressProps}
                // This is a simulated link. When the user clicks on it our code navigates us
                // to the right message instead of relying on browser URL navigation.
                //
                // See: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/link_role
                role="link"
                tabIndex={0}
                className={sprinkles({
                    position: "relative",
                    display: "flex",
                    gap: "1.5",
                    width: "full",
                    marginTop: "1",
                    // Intentionally using `paragraphMargin` instead of `standaloneBlockMargin`
                    // since `standaloneBlockMargin` is too much margin for one line responses.
                    marginBottom: contentStyles.paragraphMargin,
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
                    marginLeft: `${avatarSizeRem + parentOffsetRem}rem`,
                }}
                // NOCOMMIT:
                // onKeyDown={event => {
                //     if (event.key === "Enter" || event.key === " ") {
                //         event.preventDefault();
                //         event.stopPropagation();
                //         onJumpToMessage(parentMessage);
                //         return;
                //     }
                // }}
            >
                <div
                    className={sprinkles({
                        position: "absolute",
                        borderLeft: "grey-5",
                        borderLeftWidth: "thick",
                        borderTop: "grey-5",
                        borderTopWidth: "thick",
                        borderTopLeftRadius: "2.5",
                    })}
                    style={{
                        top: `calc(${parentAvatarOffsetYRem + parentAvatarSizeRem / 2}rem - 1px)`,
                        bottom: `calc(-${
                            contentStyles.paragraphMarginRem + messageView2AvatarOffsetYRem
                        }rem + 2px)`,
                        left: `calc(-${avatarSizeRem / 2 + parentOffsetRem}rem - 1px)`,
                        width: `calc(${avatarSizeRem / 2 + parentOffsetRem}rem - 2px)`,
                    }}
                />
                <div
                    className={sprinkles({
                        flexShrink: "0",
                        position: "relative",
                        opacity: isPressed ? "60" : "100",
                    })}
                    style={{top: `${parentAvatarOffsetYRem}rem`}}
                >
                    <AccountAvatar
                        size={messageViewParentAvatarSize}
                        account={parentMessage.author}
                    />
                </div>
                <div
                    className={sprinkles({
                        flexGrow: "1",
                        overflow: "hidden",
                        color: "grey-80",
                        fontSize: messageViewParentFontSize,
                        fontStyle: "normal",
                        opacity: isPressed ? "60" : "100",
                    })}
                    style={{
                        minHeight: messageViewParentLineHeight,
                        lineHeight: messageViewParentLineHeight,
                        // Allow contextual alternate glyphs in regular text content.
                        fontFeatureSettings: '"calt" on',
                        // Truncate after 3 lines of text. Unofficial syntax that works in all browsers
                        // except IE.
                        // https://stackoverflow.com/questions/3922739/limit-text-length-to-n-lines-using-css
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        lineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        textOverflow: "ellipsis",
                    }}
                >
                    <AccountShortName account={parentMessage.author} />: {truncatedContent}
                </div>
            </div>
        </FocusRing>
    );
}

// True for all the block nodes that get standalone block margin in
// `content.css.ts` vs paragraph margin.
const hasStandaloneMarginByContentBlockNodeTypeName: {[key: string]: boolean} = cast<{
    [Key in ContentBlockNodeTypeName]: boolean;
}>({
    paragraph: false,
    unorderedListItem: false,
    orderedListItem: false,
    checkListItem: false,
    heading: false,
    divider: false,
    fileFloat: false,
    quoteBlock: true,
    codeBlock: true,
    fileRow: true,
});
