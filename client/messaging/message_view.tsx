import {differenceInMinutes} from "date-fns";
import {useEffect, useMemo, useRef, useState} from "react";
import {useNavigate} from "react-router-dom";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {ContentView} from "~/client/content/content_view";
import {MessageEditing} from "~/client/messaging/message_editing";
import {MessageViewActions} from "~/client/messaging/message_view_actions";
import {MessageViewEditor} from "~/client/messaging/message_view_editor";
import {RemLength, Spacing, addRemLengths, spacing} from "~/shared/design/spacing";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {
    MessageInterface,
    MessageRoomKeyType,
    MessageWithContentPayloadInterface,
} from "~/shared/models/message_interface";
import {colorSchemeVars, contentSchemaStyles, sprinkles} from "~/shared/styles/styles";

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
export const messageBubbleMinWidth: Spacing = "6";

const mergeMessageMinuteLimit = 5;

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

export function MessageView<Message extends MessageInterface>({
    messageNoun = "message",
    messageStartOfSentenceNoun = messageNoun.slice(0).toUpperCase() + messageNoun.slice(1),
    message,
    previousMessage,
    nextMessage,
    messageEditing,
    disableExpensiveFeaturesDuringScroll,
    onDeleteMessage,
}: {
    messageNoun?: string;
    messageStartOfSentenceNoun?: string;
    message: Message;
    previousMessage: Message | null;
    nextMessage: Message | null;
    messageEditing: MessageEditing<MessageRoomKeyType<Message>>;
    disableExpensiveFeaturesDuringScroll: boolean;
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

    const navigate = useNavigate();

    const isEditing =
        messageEditing.state.isEditing &&
        messageEditing.state.messageRoomKey === message.getRoomKey() &&
        messageEditing.state.messageIndex === message.index;

    const shouldFocusMessageContentEditorRef = useRef(false);

    // We try to memoize any UI in this component that changes infrequently to
    // speed up React rendering. Because `<MessageView>` renders during scroll
    // animations it's important to keep it fast.
    const contentPayloadNode = useMemo(() => {
        if (message.payload.type !== "Content") return null;

        return (
            <div
                className={sprinkles({
                    backgroundColor: "grey-bubble",
                    maxWidth: "160",
                    overflow: "hidden",
                    display: "inline-block",
                    paddingX: "0.5",
                    paddingY: "1.5",
                    borderTopLeftRadius: !shouldMergeWithPreviousMessage ? "xl" : "base",
                    borderTopRightRadius: "xl",
                    borderBottomLeftRadius: !shouldMergeWithNextMessage ? "xl" : "base",
                    borderBottomRightRadius: "xl",
                })}
            >
                <ContentView
                    content={message.payload.content}
                    onNavigate={navigate}
                    className={sprinkles({minWidth: messageBubbleMinWidth})}
                />
            </div>
        );
    }, [message.payload, navigate, shouldMergeWithNextMessage, shouldMergeWithPreviousMessage]);

    const deletedPayloadNode = useMemo(() => {
        if (message.payload.type !== "Deleted") return null;

        return (
            <div
                className={sprinkles({
                    paddingX: "0.5",
                    paddingY: "1.5",
                    display: "flex",
                    alignItems: "center",
                    borderTopLeftRadius: !shouldMergeWithPreviousMessage ? "xl" : "base",
                    borderTopRightRadius: "xl",
                    borderBottomLeftRadius: !shouldMergeWithNextMessage ? "xl" : "base",
                    borderBottomRightRadius: "xl",
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
                    {`Deleted ${messageNoun}`}
                </div>
            </div>
        );
    }, [
        message.payload.type,
        messageNoun,
        shouldMergeWithNextMessage,
        shouldMergeWithPreviousMessage,
    ]);

    return (
        <div>
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
                            })}
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
                        </div>
                    ),
                [message.author.name, shouldMergeWithPreviousMessage],
            )}
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
                                    <AccountAvatar account={message.author} size="7" />
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
                            <div className={sprinkles({width: "10"})}>
                                {!disableExpensiveFeaturesDuringScroll && (
                                    <MessageViewActions
                                        messageNoun={messageNoun}
                                        message={
                                            message as any as MessageWithContentPayloadInterface<
                                                MessageRoomKeyType<Message>
                                            >
                                        }
                                        messageEditing={messageEditing}
                                        isHovered={isHovered}
                                        onDeleteMessage={onDeleteMessage}
                                        isEditing={isEditing}
                                        shouldFocusMessageContentEditorRef={
                                            shouldFocusMessageContentEditorRef
                                        }
                                    />
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
