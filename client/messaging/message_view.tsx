import {ArrowArcLeft, SpinnerGap} from "@phosphor-icons/react";
import {differenceInMinutes} from "date-fns";
import {Fragment, Memo, MutableRefObject, useEffect, useMemo, useRef, useState} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {AccountShortName} from "~/client/accounts/account_short_name";
import {ContentView} from "~/client/content/content_view";
import {ErrorIcon} from "~/client/design/error_icon";
import {FocusRing} from "~/client/design/focus_ring";
import {IconButton} from "~/client/design/icon_button";
import {ModalDialog} from "~/client/design/modal_dialog";
import {OverlayScopeContextProvider} from "~/client/design/overlay";
import {PrettyAbsoluteDateTooltipContent} from "~/client/design/pretty_absolute_date";
import {Tooltip} from "~/client/design/tooltip";
import {isElementOwnedBy} from "~/client/helpers/is_element_owned_by";
import {MessageDeleteConfirmationDialog} from "~/client/messaging/internal/message_delete_confirmation_dialog";
import {MessageViewActions} from "~/client/messaging/internal/message_view_actions";
import {
    MessageViewEditor,
    MessageViewEditorRef,
} from "~/client/messaging/internal/message_view_editor";
import {shouldDisplayTextAsBigEmojiMessage} from "~/client/messaging/internal/should_display_text_as_big_emoji_message";
import {MessageEditing} from "~/client/messaging/message_editing";
import {MessageList} from "~/client/messaging/message_list";
import {useIsPeekAnimatingOpen} from "~/client/peek/peek_stack";
import {useClientInfo} from "~/client/remix/client_info_context";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/content/message_content_schema";
import {
    RemLength,
    Spacing,
    addRemLengths,
    parseRemLengthNumber,
    spacing,
} from "~/shared/design/spacing";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {iterateEmojis} from "~/shared/helpers/string/iterate_emojis";
import {emptyContentReferences} from "~/shared/models/content_references";
import {
    MessageContentWithReferences,
    MessageModel,
    MessageModelBase,
    OptimisticMessageModel,
} from "~/shared/models/message_model";
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

/**
 * The minimum width of a message bubble.
 */
export const messageViewBubbleMinWidth: Spacing = "6";

const mergeMessageMinuteLimit = 5;

export const messageViewBubbleBorderRadius = "xl" as const;
export const messageViewBubbleMergedBorderRadius = "base" as const;
export const messageViewBubblePaddingX: Spacing = "0.5";
export const messageViewBubblePaddingY: Spacing = "1.5";
export const messageViewActionsWidth: Spacing = "10";
export const messageViewPreviewScale =
    fontSizesByPlatform["50"].desktop.fontSize / fontSizesByPlatform["100"].desktop.fontSize;
export const messageViewReplyPreviewOpacity = 0.6;
export const messageViewReplyPreviewBubbleOpacity = 0.7;
export const messageViewMarginX: Spacing = "5";
export const messageViewMarginY: Spacing = "3";
export const messageViewMergedMarginY: Spacing = "0.5";

export const messageBubbleMarginLeft = addRemLengths(
    spacing[messageViewMarginX],
    spacing["7"],
    spacing["2"],
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
    onReplyToMessage,
    onDeleteMessage,
    getCopyLinkUrl,
    roomDisplayedCreatedTime,
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
    getCopyLinkUrl: (messageIndex: number) => URL;
    roomDisplayedCreatedTime?: Date;
}) {
    const {timeZone} = useClientInfo();

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

    const messageEditingForThisMessage =
        messageEditing.state.isEditing &&
        !message.isOptimistic &&
        messageEditing.state.messageRoomKey === message.getRoomKey() &&
        messageEditing.state.messageIndex === message.index
            ? messageEditing
            : null;

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
                if (lastIndex !== index)
                    children.push(
                        <Fragment key={lastIndex}>
                            {messageTextForBigEmojiMessage.slice(lastIndex, index)}
                        </Fragment>,
                    );

                children.push(
                    <span key={index} style={{fontFamily: emojiFontFamily}}>
                        {emoji}
                    </span>,
                );

                lastIndex = index + emoji.length;
            }

            if (lastIndex !== messageTextForBigEmojiMessage.length - 1)
                children.push(
                    <Fragment key={lastIndex}>
                        {messageTextForBigEmojiMessage.slice(lastIndex)}
                    </Fragment>,
                );

            return (
                <div className={sprinkles({fontSize: "600", userSelect: "text"})}>
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
                })}
            >
                <ContentView
                    content={message.payload.content}
                    contentUpdatedTime={message.payload.contentUpdatedTime}
                    className={sprinkles({minWidth: messageViewBubbleMinWidth})}
                />
            </div>
        );
    }, [
        message.payload,
        messageTextForBigEmojiMessage,
        shouldMergeWithNextMessage,
        shouldMergeWithPreviousMessage,
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
                    userSelect: "text",
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
                className={sprinkles({
                    position: "relative",
                    zIndex: "10",
                })}
                style={{
                    height: scaledHeight,
                    paddingLeft: messageBubbleMarginLeft,
                    paddingRight: addRemLengths(
                        spacing["3"],
                        spacing[messageViewActionsWidth],
                        spacing[messageViewMarginX],
                    ),
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
                                    content={truncatedContent}
                                    className={sprinkles({minWidth: messageViewBubbleMinWidth})}
                                />
                            </div>
                        </div>
                    </FocusRing>
                </OverlayScopeContextProvider>
            </div>
        );
    }, [messageStartOfSentenceNoun, messageTextForBigEmojiMessage, onJumpToMessage, parentMessage]);

    const timestampDividerNode = useMemo(() => {
        // If an hour passed without a message, insert a divider between messages. We
        // use an hour since that's a pretty standard meeting time. If an hour long
        // meeting has passed we assume context is lost so revealing the time
        // is useful.
        const minElapsedMinutes = 60;

        const shouldShowTimestampBeforeMessage = isFirstMessage
            ? !roomDisplayedCreatedTime ||
              differenceInMinutes(message.createdTime, roomDisplayedCreatedTime) > minElapsedMinutes
            : previousMessage &&
              differenceInMinutes(message.createdTime, previousMessage.createdTime) >
                  minElapsedMinutes;
        if (!shouldShowTimestampBeforeMessage) return null;

        const isCurrentYear = new Date().getFullYear() === message.createdTime.getFullYear();

        const formatter = new Intl.DateTimeFormat("en-US", {
            timeZone,
            calendar: "iso8601",
            year: !isCurrentYear ? "numeric" : undefined,
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        });

        const formattedDate = formatter.format(message.createdTime);

        return (
            <div className={sprinkles({paddingTop: "6", paddingBottom: "3"})}>
                <div
                    className={sprinkles({
                        position: "relative",
                        zIndex: "0",
                        display: "flex",
                        justifyContent: "center",
                    })}
                >
                    <div
                        className={sprinkles({
                            position: "relative",
                            zIndex: "20",
                            fontSize: "50",
                            fontStyle: "truncate",
                            color: "grey-50",
                            backgroundColor: "grey-0",
                            paddingX: "6",
                        })}
                    >
                        {formattedDate}
                    </div>
                    <div
                        className={sprinkles({
                            position: "absolute",
                            zIndex: "10",
                            left: "12",
                            right: "12",
                            backgroundColor: "grey-5",
                        })}
                        style={{height: 1, top: "50%"}}
                    />
                </div>
            </div>
        );
    }, [isFirstMessage, message.createdTime, previousMessage, roomDisplayedCreatedTime, timeZone]);

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
                className={sprinkles({position: "relative", zIndex: "0"})}
                style={{
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
                                className={sprinkles({
                                    fontSize: "50",
                                    fontStyle: "truncate",
                                    paddingTop: "0.5",
                                    paddingBottom: parentMessage === null ? "0.5" : "1",
                                    paddingRight: messageViewMarginX,
                                    color: "grey-50",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "0.5",
                                })}
                                style={{
                                    paddingLeft: addRemLengths(
                                        messageBubbleMarginLeft,
                                        spacing["0.5"],
                                    ),
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
                    [message.author, parentMessage, shouldMergeWithPreviousMessage],
                )}
                {parentMessageNode}
                <div
                    ref={hoverRef}
                    className={sprinkles({
                        display: "flex",
                        paddingX: messageViewMarginX,
                        paddingBottom: !shouldMergeWithNextMessage
                            ? messageViewMarginY
                            : messageViewMergedMarginY,
                    })}
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
                        <div
                            className={sprinkles({
                                display: "flex",
                                position: "relative",
                                zIndex: "10",
                            })}
                            onBlur={event => {
                                // Ignore blur events where focus is moving within the element.
                                //
                                // We need to use element ownership instead of `document.body.contains()` to
                                // handle modals.
                                if (
                                    !event.relatedTarget ||
                                    !isElementOwnedBy(event.currentTarget, event.relatedTarget)
                                ) {
                                    messageEditingForThisMessage?.dispatch({
                                        type: "MaybeCancelEditing",
                                    });
                                }
                            }}
                        >
                            {!messageEditingForThisMessage ? (
                                contentPayloadNode
                            ) : (
                                <MessageViewEditor
                                    ref={messageEditorRef}
                                    messageNoun={messageNoun}
                                    messageStartOfSentenceNoun={messageStartOfSentenceNoun}
                                    shouldMergeWithPreviousMessage={shouldMergeWithPreviousMessage}
                                    shouldMergeWithNextMessage={shouldMergeWithNextMessage}
                                    messageEditing={messageEditing}
                                />
                            )}
                            <div
                                className={sprinkles({
                                    alignSelf: "center",
                                    paddingLeft: "3",
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
                                                onPress={message.optimisticRequestErrorState.retry}
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
                                                onDeleteMessage={onDeleteMessage}
                                                isEditing={!!messageEditingForThisMessage}
                                                getCopyLinkUrl={getCopyLinkUrl}
                                            />
                                        )
                                    )}
                                </div>
                            </div>
                        </div>
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
                    message.payload.content.doc.cut(
                        0,
                        Math.min(
                            message.payload.content.doc.content.size,
                            // Arbitrarily picked as close to the number of characters in a string of only
                            // "x"s that wraps to two lines on my wide monitor. Rounded up to the nearest
                            // 100 to count for structural nodes.
                            600,
                        ),
                    ),
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
