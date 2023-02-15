import {differenceInMinutes} from "date-fns";
import {ArrowArcLeft, SpinnerGap} from "phosphor-react";
import {useEffect, useMemo, useRef, useState} from "react";
import {useNavigate} from "react-router-dom";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {AccountShortName} from "~/client/accounts/account_short_name";
import {ContentView} from "~/client/content/content_view";
import {ErrorIcon} from "~/client/design/error_icon";
import {IconButton} from "~/client/design/icon_button";
import {MessageEditing} from "~/client/messaging/message_editing";
import {MessageList} from "~/client/messaging/message_list";
import {MessageViewActions} from "~/client/messaging/message_view_actions";
import {MessageViewEditor} from "~/client/messaging/message_view_editor";
import {MessageContentProsemirrorSchema} from "~/shared/content/message_content_schema";
import {
    RemLength,
    Spacing,
    addRemLengths,
    parseRemLengthNumber,
    spacing,
} from "~/shared/design/spacing";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {
    MessageInterface,
    MessageInterfaceBase,
    OptimisticMessageInterface,
} from "~/shared/models/message_interface";
import {
    borderRadius,
    colorSchemeVars,
    contentSchemaStyles,
    contentViewStyles,
    fontSizesByPlatform,
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

/**
 * The minimum width of a message bubble.
 */
export const messageViewBubbleMinWidth: Spacing = "6";

const mergeMessageMinuteLimit = 5;

export const messageBubbleMarginLeft = addRemLengths(spacing["3"], spacing["7"], spacing["2"]);

export const messageViewBubbleBorderRadius = "xl" as const;
export const messageViewBubbleMergedBorderRadius = "base" as const;
export const messageViewBubblePaddingX: Spacing = "0.5";
export const messageViewBubblePaddingY: Spacing = "1.5";
export const messageViewActionsWidth: Spacing = "10";

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

function shouldMergeMessages(
    message1: MessageInterfaceBase,
    message2: MessageInterfaceBase,
): boolean {
    return (
        message1.author.id === message2.author.id &&
        Math.abs(differenceInMinutes(message1.createdTime, message2.createdTime)) <
            mergeMessageMinuteLimit &&
        (message2.payload.type !== "Content" || message2.payload.parentMessageIndex === null)
    );
}

export function MessageView<RoomKey extends string, Message extends MessageInterface<RoomKey>>({
    messageNoun = "message",
    messageStartOfSentenceNoun = messageNoun.slice(0, 1).toUpperCase() + messageNoun.slice(1),
    message,
    previousMessage,
    nextMessage,
    messages,
    messageEditing,
    disableExpensiveFeaturesDuringScroll,
    onReplyToMessage,
    onDeleteMessage,
}: {
    messageNoun?: string;
    messageStartOfSentenceNoun?: string;
    message: Message | OptimisticMessageInterface;
    previousMessage: MessageInterfaceBase | null;
    nextMessage: MessageInterfaceBase | null;
    messages: MessageList<Message>;
    messageEditing: MessageEditing<RoomKey>;
    disableExpensiveFeaturesDuringScroll: boolean;
    onReplyToMessage: () => void;
    onDeleteMessage: () => Promise<void>;
}) {
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

    const navigate = useNavigate();

    const isEditing =
        messageEditing.state.isEditing &&
        messageEditing.state.messageRoomKey === message.getRoomKey() &&
        !message.isOptimistic &&
        messageEditing.state.messageIndex === message.index;

    const shouldFocusMessageContentEditorRef = useRef(false);

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

    // We try to memoize any UI in this component that changes infrequently to
    // speed up React rendering. Because `<MessageView>` renders during scroll
    // animations it's important to keep it fast.
    const contentPayloadNode = useMemo(() => {
        if (message.payload.type !== "Content") return null;

        return (
            <div
                className={sprinkles({
                    backgroundColor: "grey-bubble",
                    maxWidth: "full",
                    overflow: "hidden",
                    display: "inline-block",
                    paddingX: messageViewBubblePaddingX,
                    paddingY: messageViewBubblePaddingY,
                    borderTopLeftRadius:
                        !shouldMergeWithPreviousMessage && !parentMessage
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
                    onNavigate={navigate}
                    className={sprinkles({minWidth: messageViewBubbleMinWidth})}
                />
            </div>
        );
    }, [
        message.payload,
        navigate,
        parentMessage,
        shouldMergeWithNextMessage,
        shouldMergeWithPreviousMessage,
    ]);

    const deletedPayloadNode = useMemo(() => {
        if (message.payload.type !== "Deleted") return null;

        return (
            <div
                className={sprinkles({
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

        const height = addRemLengths(
            spacing["1.5"],
            contentViewStyles.truncatedHeight,
            spacing["1.5"],
        );

        const scale =
            fontSizesByPlatform["50"].desktop.fontSize /
            fontSizesByPlatform["100"].desktop.fontSize;

        const scaledHeight = `${Math.round(parseRemLengthNumber(height) * scale * 16) / 16}rem`;

        // Scale up our border radius so visually it looks like the `base` size even
        // though we've scaled the element down.
        const scaledMergedBorderRadius = `${
            parseRemLengthNumber(borderRadius[messageViewBubbleMergedBorderRadius]) / scale
        }rem`;

        const opacity = 0.5;

        const truncatedContent =
            parentMessage.payload.type === "Content"
                ? parentMessage.payload.content.cut(
                      0,
                      Math.min(
                          parentMessage.payload.content.content.size,
                          // Arbitrarily picked as close to the number of characters in a string of only
                          // "x"s that wraps to two lines on my wide monitor. Rounded up to the nearest
                          // 100 to count for structural nodes.
                          600,
                      ),
                  )
                : // NOTE(calebmer): We render deleted messages with the same style as a normal
                  // message in a reply because if we render with the deleted style (no
                  // background, 1px border) it's just too light when scaled down and made
                  // translucent. The user can click on the reply to jump to the actual message
                  // with the correct treatment.
                  MessageContentProsemirrorSchema.node("doc", {}, [
                      MessageContentProsemirrorSchema.node("paragraph", {}, [
                          MessageContentProsemirrorSchema.text(
                              `${messageStartOfSentenceNoun} deleted`,
                              [MessageContentProsemirrorSchema.mark("italic")],
                          ),
                      ]),
                  ]);

        return (
            <div
                className={sprinkles({
                    marginBottom: "0.5",
                    overflow: "hidden",
                })}
                style={{
                    height: scaledHeight,
                    paddingLeft: messageBubbleMarginLeft,
                    paddingRight: addRemLengths(
                        spacing["3"],
                        spacing[messageViewActionsWidth],
                        spacing["3"],
                    ),
                }}
            >
                <div
                    className={sprinkles({
                        backgroundColor: "grey-bubble",
                        maxWidth: "full",
                        overflow: "hidden",
                        display: "inline-block",
                        paddingX: messageViewBubblePaddingX,
                        paddingY: messageViewBubblePaddingY,
                        borderRadius: messageViewBubbleBorderRadius,
                    })}
                    style={{
                        height,
                        opacity,
                        transform: `scale(${scale})`,
                        transformOrigin: "0% 0% 0",
                        borderBottomLeftRadius: scaledMergedBorderRadius,
                    }}
                >
                    <div className={sprinkles({overflow: "hidden", pointerEvents: "none"})}>
                        <ContentView
                            isInert={true}
                            isTruncated={true}
                            content={truncatedContent}
                            onNavigate={navigate}
                            className={sprinkles({minWidth: messageViewBubbleMinWidth})}
                        />
                    </div>
                </div>
            </div>
        );
    }, [messageStartOfSentenceNoun, navigate, parentMessage]);

    return (
        <div className={sprinkles({position: "relative", zIndex: "0"})}>
            {useMemo(
                () =>
                    !shouldMergeWithPreviousMessage && (
                        <div
                            className={sprinkles({
                                fontSize: "50",
                                fontStyle: "truncate",
                                paddingY: "0.5",
                                paddingRight: "3",
                                color: "grey-50",
                                display: "flex",
                                alignItems: "center",
                                gap: "0.5",
                            })}
                            style={{
                                paddingLeft: addRemLengths(messageBubbleMarginLeft, spacing["1.5"]),
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
                    paddingX: "3",
                    paddingBottom: !shouldMergeWithNextMessage ? "3" : "0.5",
                })}
            >
                {useMemo(
                    () => (
                        <div className={sprinkles({flexShrink: "0", paddingRight: "2"})}>
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
                    <>
                        {!isEditing ? (
                            contentPayloadNode
                        ) : (
                            <MessageViewEditor
                                messageNoun={messageNoun}
                                messageStartOfSentenceNoun={messageStartOfSentenceNoun}
                                shouldMergeWithPreviousMessage={shouldMergeWithPreviousMessage}
                                shouldMergeWithNextMessage={shouldMergeWithNextMessage}
                                messageEditing={messageEditing}
                                shouldFocusMessageContentEditorRef={
                                    shouldFocusMessageContentEditorRef
                                }
                            />
                        )}
                        <div
                            className={sprinkles({
                                alignSelf: "center",
                                paddingLeft: "3",
                            })}
                        >
                            <div className={sprinkles({width: messageViewActionsWidth})}>
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
                                    !disableExpensiveFeaturesDuringScroll && (
                                        <MessageViewActions
                                            messageNoun={messageNoun}
                                            message={message}
                                            messagePayload={message.payload}
                                            messageEditing={messageEditing}
                                            isHovered={isHovered}
                                            onReplyToMessage={onReplyToMessage}
                                            onDeleteMessage={onDeleteMessage}
                                            isEditing={isEditing}
                                            shouldFocusMessageContentEditorRef={
                                                shouldFocusMessageContentEditorRef
                                            }
                                        />
                                    )
                                )}
                            </div>
                        </div>
                    </>
                ) : (
                    deletedPayloadNode
                )}
            </div>
        </div>
    );
}
