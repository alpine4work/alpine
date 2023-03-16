import {
    Memo,
    MutableRefObject,
    ReactElement,
    ReactNode,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {useMessageEditing} from "~/client/messaging/message_editing";
import {MessageInput} from "~/client/messaging/message_input";
import {MessageList, MessageListItem} from "~/client/messaging/message_list";
import {MessageShimmer} from "~/client/messaging/message_shimmer";
import {
    MessageView,
    bufferedMessageViewHeight,
    messageViewMinHeight,
} from "~/client/messaging/message_view";
import {tryLoadingMessages} from "~/client/messaging/try_loading_messages";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
    VirtualizedScrollViewRenderItem,
    getInitialVirtualizedScrollViewRenderedItemCount,
} from "~/client/virtualized/virtualized_scroll_view";
import {MessageContent} from "~/shared/content/message_content_schema";
import {RemLength} from "~/shared/design/spacing";
import {wait} from "~/shared/helpers/async/wait";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {MessageModel} from "~/shared/models/message_model";
import {ClientInfo} from "~/shared/remix/client_info";
import {sprinkles} from "~/shared/styles/styles";

/**
 * Get the initial number of messages to load.
 */
export function getInitialLoadMessageCount(clientInfo: ClientInfo) {
    return getInitialVirtualizedScrollViewRenderedItemCount(clientInfo, messageViewMinHeight);
}

type MessagingViewStateItem<Message extends MessageModel> =
    | {
          readonly type: "Header";
          readonly minHeight: number | RemLength;
          readonly node: ReactNode;
      }
    | (MessageListItem<Message> & {readonly messageIndex: number});

class MessagingViewState<Message extends MessageModel> {
    private readonly _header:
        | {
              readonly isEnabled: true;
              readonly minHeight: number | RemLength;
              readonly node: ReactNode;
          }
        | {
              readonly isEnabled: false;
          };

    public readonly messages: MessageList<Message>;

    constructor(messages: MessageList<Message>) {
        this.messages = messages;
        this._header = {isEnabled: false};
    }

    public getItemCount() {
        return this.messages.getMessageCount() + (this._header.isEnabled ? 1 : 0);
    }

    public getItem(index: number): MessagingViewStateItem<Message> {
        if (this._header.isEnabled) {
            if (index === 0) {
                return {
                    type: "Header",
                    minHeight: this._header.minHeight,
                    node: this._header.node,
                };
            }
            index -= 1;
        }

        return {
            ...this.messages.getMessage(index),
            messageIndex: index,
        };
    }

    /**
     * Transform the range for our state's virtualized list into a range of
     * just messages.
     */
    public getMessagesRange(
        range: {
            startIndex: number;
            endIndex: number;
        } | null,
    ): {startIndex: number; endIndex: number} | null {
        if (!range) return null;

        assert(0 <= range.startIndex && range.startIndex < this.getItemCount());
        assert(0 <= range.endIndex && range.endIndex < this.getItemCount());
        assert(range.startIndex <= range.endIndex);

        if (!this._header.isEnabled) return range;

        const startIndex = range.startIndex - 1;
        const endIndex = range.endIndex - 1;
        if (startIndex < 0 || endIndex < 0) return null;
        return {startIndex, endIndex};
    }

    /**
     * Get the index of a message in our view.
     */
    public getItemIndexForMessageIndex(messageIndex: number): number {
        if (!this._header.isEnabled) return messageIndex;
        return messageIndex + 1;
    }
}

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

export function MessagingView<RoomKey extends string, Message extends MessageModel<RoomKey>>({
    messageNoun = "message",
    messageStartOfSentenceNoun = messageNoun.slice(0, 1).toUpperCase() + messageNoun.slice(1),
    initialScrollOffset,
    initialMessagesResult,
    randomSeedForShimmer,
    isMessageCreationDisabled,
    getMessagesFromStart,
    getMessagesFromEnd,
    createMessage,
    updateMessageContent,
    deleteMessage,
    getCopyLinkUrl,
}: {
    messageNoun?: string;
    messageStartOfSentenceNoun?: string;
    initialScrollOffset: "top" | "bottom";
    initialMessagesResult: {
        readonly messageCount: number;
        readonly messages: ReadonlyArray<Message>;
        readonly otherReferencedMessages: ReadonlyArray<Message>;
        readonly lastMessageChangeTime: Date | null;
    };
    randomSeedForShimmer: string;
    isMessageCreationDisabled?: boolean;
    getMessagesFromStart: (input: {
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
    }) => Promise<{
        messageCount: number;
        messages: ReadonlyArray<Message>;
        otherReferencedMessages: ReadonlyArray<Message>;
    }>;
    getMessagesFromEnd: (input: {
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
    }) => Promise<{
        messageCount: number;
        messages: ReadonlyArray<Message>;
        otherReferencedMessages: ReadonlyArray<Message>;
    }>;
    createMessage: Memo<
        (input: {parentMessageIndex: number | null; content: MessageContent}) => Promise<void>
    >;
    updateMessageContent: Memo<
        (input: {messageIndex: number; content: MessageContent}) => Promise<void>
    >;
    deleteMessage: Memo<(input: {messageIndex: number}) => Promise<void>>;
    getCopyLinkUrl: Memo<(messageIndex: number) => URL>;
}) {
    const viewRef = useRef<VirtualizedScrollViewRef>(null);

    const [messagesWithoutHeader, setMessages] = useState(() => {
        const messages = MessageList.new<Message>({
            messageCount: initialMessagesResult.messageCount,
            lastMessageChangeTime: initialMessagesResult.lastMessageChangeTime,
        });
        return messages.loadMessages({
            messageCount: initialMessagesResult.messageCount,
            messages: initialMessagesResult.messages,
            otherReferencedMessages: initialMessagesResult.otherReferencedMessages,
        });
    });

    const state = useMemo(
        () => new MessagingViewState(messagesWithoutHeader),
        [messagesWithoutHeader],
    );

    const isLoadingRef = useRef(false);
    const [errorState, setErrorState] = useState<
        {hasError: false} | {hasError: true; error: unknown}
    >({hasError: false});

    if (errorState.hasError) throw errorState.error;

    const tryLoadingMoreData = useEvent(
        (
            renderedRange: {startIndex: number; endIndex: number} | null,
        ): {isLoading: false} | {isLoading: true; promise: Promise<void>} => {
            // If we're already loading, don't try to load more comments.
            if (isLoadingRef.current) return {isLoading: false};

            const result = actuallyTryLoadingMoreData(renderedRange);
            if (!result.isLoading) return result;

            isLoadingRef.current = true;
            result.promise.then(
                () => {
                    isLoadingRef.current = false;
                },
                error => {
                    isLoadingRef.current = false;
                    setErrorState({hasError: true, error});
                },
            );
            return result;

            // Try to load more data without worrying about managing coordination with
            // `isLoadingRef` or error handling.
            function actuallyTryLoadingMoreData(
                renderedRange: {startIndex: number; endIndex: number} | null,
            ): {isLoading: false} | {isLoading: true; promise: Promise<void>} {
                renderedRange = state.getMessagesRange(renderedRange);
                if (!renderedRange) return {isLoading: false};

                const view = assertExists(viewRef.current);

                const result = tryLoadingMessages({
                    viewHeight: view.getHeight(),
                    messages: state.messages,
                    range: {
                        startIndex: renderedRange.startIndex,
                        endIndex: renderedRange.endIndex,
                    },
                    loadFromStart: getMessagesFromStart,
                    loadFromEnd: getMessagesFromEnd,
                });

                if (!result.isLoading) return {isLoading: false};

                return {
                    isLoading: true,
                    promise: result.promise.then(result => {
                        setMessages(messages => messages.loadMessages(result));
                    }),
                };
            }
        },
    );

    // Whenever our list data changes, try loading more comments. In case our
    // rendered range stayed the same but we see some some unloaded comments.
    //
    // This effect should also fire when `tryLoadingMoreData()` completes
    // in case it didn't fully load the list.
    useEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        state;

        const view = assertExists(viewRef.current);
        tryLoadingMoreData(view.getRenderedRange());
    }, [state, tryLoadingMoreData]);

    // Manages the editable message.
    //
    // This is at the post list level because we want only one message to be
    // editable at a time.
    const messageEditing = useMessageEditing<RoomKey>({
        onUpdateMessageContent: updateMessageContent,
    });

    // Manages which comment `<MessageInput>` is currently replying to.
    const [replyingToMessage, setReplyingToMessage] = useState<Message | null>(null);

    // A message to highlight for the user. We currently highlight messages with a
    // little wiggle animation (see `wiggle_animation.css.ts` for more information).
    // We highlight messages when initially loading a page with a message index in
    // the URL and when the user clicks on a reply preview to jump to it.
    const [highlightMessage, setHighlightMessage] = useState<{
        messageIndex: number;
        shouldHighlightRef: MutableRefObject<boolean>;
    } | null>(null);

    const isJumpingToMessageRef = useRef(false);

    // Jumping to a message entails:
    //
    // 1. We scroll to the message
    // 2. We highlight the message to the user
    const handleJumpToMessage = useEvent((message: Message) => {
        // If we are in the process of jumping, don't start another jump
        if (isJumpingToMessageRef.current) return;

        const view = assertExists(viewRef.current);

        const scrollToIndex = state.getItemIndexForMessageIndex(message.index);

        const peekRenderedRange = view.peekRenderedRangeAfterScrollToIndex(scrollToIndex);
        const result = tryLoadingMoreData(peekRenderedRange);

        if (!result.isLoading) {
            view.scrollToIndex(scrollToIndex);

            setHighlightMessage({
                messageIndex: message.index,
                shouldHighlightRef: {current: true},
            });
        } else {
            isJumpingToMessageRef.current = true;

            Promise.race([result.promise, wait(delayLoadingIndicatorLimitMs)]).finally(() => {
                isJumpingToMessageRef.current = false;

                view.scrollToIndex(scrollToIndex);

                setHighlightMessage({
                    messageIndex: message.index,
                    shouldHighlightRef: {current: true},
                });
            });
        }
    });

    const renderItem: VirtualizedScrollViewRenderItem = useCallback(
        index => {
            const item = state.getItem(index);

            switch (item.type) {
                case "Header": {
                    return {
                        key: "Header",
                        minHeight: item.minHeight,
                        node: item.node,
                    };
                }
                case "Loaded":
                case "Unloaded":
                case "Optimistic": {
                    const previousItem = index > 0 ? state.getItem(index - 1) : null;
                    const nextItem =
                        index < state.getItemCount() - 1 ? state.getItem(index + 1) : null;

                    const previousMessage =
                        previousItem?.type === "Loaded" || previousItem?.type === "Optimistic"
                            ? previousItem.message
                            : null;
                    const nextMessage =
                        nextItem?.type === "Loaded" || nextItem?.type === "Optimistic"
                            ? nextItem.message
                            : null;

                    const actuallyRender = (
                        disableExpensiveFeaturesDuringScroll: boolean,
                    ): ReactElement => {
                        return item.type === "Loaded" || item.type === "Optimistic" ? (
                            <MessageView
                                messageNoun={messageNoun}
                                messageStartOfSentenceNoun={messageStartOfSentenceNoun}
                                message={item.message}
                                previousMessage={previousMessage}
                                nextMessage={nextMessage}
                                messages={state.messages}
                                messageEditing={messageEditing}
                                shouldHighlightRef={
                                    !item.message.isOptimistic &&
                                    highlightMessage?.messageIndex === item.message.index
                                        ? highlightMessage.shouldHighlightRef
                                        : null
                                }
                                onJumpToMessage={handleJumpToMessage}
                                onReplyToMessage={() => {
                                    if (item.message.isOptimistic) return;
                                    setReplyingToMessage(item.message);
                                }}
                                onDeleteMessage={async () => {
                                    if (item.message.isOptimistic) return;
                                    await deleteMessage({
                                        messageIndex: item.message.index,
                                    });
                                }}
                                disableExpensiveFeaturesDuringScroll={
                                    disableExpensiveFeaturesDuringScroll
                                }
                                getCopyLinkUrl={getCopyLinkUrl}
                            />
                        ) : (
                            <MessageShimmer
                                randomSeed={randomSeedForShimmer}
                                index={item.messageIndex}
                                previousMessage={previousMessage}
                                nextMessage={nextMessage}
                                messages={state.messages}
                            />
                        );
                    };

                    // It's important to reuse nodes across renders because then React won't try to
                    // re-render the component.
                    let nodeWithExpensiveFeaturesDisabled: ReactElement | null = null;
                    let nodeWithoutExpensiveFeaturesDisabled: ReactElement | null = null;

                    const render = (isScrolling: boolean) => {
                        // If we already rendered the node without expensive features disabled, don't
                        // render a new version since that will cause a frame drop right at the start
                        // of the scroll as React re-renders every message.
                        if (nodeWithoutExpensiveFeaturesDisabled !== null)
                            return nodeWithoutExpensiveFeaturesDisabled;

                        if (isScrolling) {
                            nodeWithExpensiveFeaturesDisabled ??= actuallyRender(true);
                            return nodeWithExpensiveFeaturesDisabled;
                        } else {
                            nodeWithoutExpensiveFeaturesDisabled ??= actuallyRender(false);
                            return nodeWithoutExpensiveFeaturesDisabled;
                        }
                    };

                    return {
                        key:
                            item.type === "Loaded" || item.type === "Optimistic"
                                ? `Message:${item.messageIndex}`
                                : `UnloadedMessage:${item.messageIndex}`,
                        minHeight: messageViewMinHeight,
                        withManualLayout: true,
                        render: ({
                            ref,
                            shouldRenderWithRelativePositioning,
                            offset,
                            isScrolling,
                        }) => (
                            <div
                                ref={ref}
                                style={{
                                    minHeight: messageViewMinHeight,
                                    ...(shouldRenderWithRelativePositioning
                                        ? {position: "relative"}
                                        : {
                                              position: "absolute",
                                              top: offset,
                                              left: 0,
                                              right: 0,
                                          }),
                                }}
                            >
                                {render(isScrolling)}
                            </div>
                        ),
                    };
                }
                default:
                    throw exhaustive(item);
            }
        },
        [
            deleteMessage,
            getCopyLinkUrl,
            handleJumpToMessage,
            highlightMessage,
            messageEditing,
            messageNoun,
            messageStartOfSentenceNoun,
            randomSeedForShimmer,
            state,
        ],
    );

    return (
        <div
            className={sprinkles({
                flexGrow: "1",
                height: "full",
                overflowX: "hidden",
                overflowY: "scroll",
                display: "flex",
                flexDirection: "column",
            })}
        >
            <VirtualizedScrollView
                ref={viewRef}
                initialScrollOffset={initialScrollOffset}
                bufferedItemHeight={bufferedMessageViewHeight}
                itemCount={state.getItemCount()}
                renderItem={renderItem}
                onRenderedRangeChange={tryLoadingMoreData}
            />
            <MessageInput
                messages={state.messages}
                isMessageCreationDisabled={isMessageCreationDisabled}
                onUpdateMessages={update => setMessages(update)}
                createMessage={createMessage}
                replyingToMessage={replyingToMessage}
                onClearReplyingToMessage={() => setReplyingToMessage(null)}
                onJumpToMessage={handleJumpToMessage}
            />
        </div>
    );
}
