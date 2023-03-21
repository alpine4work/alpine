import {
    Memo,
    MutableRefObject,
    ReactElement,
    Ref,
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {Spacer} from "~/client/design/spacer";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {useMessageEditing} from "~/client/messaging/message_editing";
import {MessageInput} from "~/client/messaging/message_input";
import {MessageList, MessageListItem} from "~/client/messaging/message_list";
import {MessageShimmer} from "~/client/messaging/message_shimmer";
import {
    MessageView,
    bufferedMessageViewHeight,
    messageViewMarginY,
    messageViewMinHeight,
} from "~/client/messaging/message_view";
import {tryLoadingMessages} from "~/client/messaging/try_loading_messages";
import {useMessagingRealtime} from "~/client/messaging/use_messaging_realtime";
import {useScrollToNewMessages} from "~/client/messaging/use_scroll_to_new_messages";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewItem,
    VirtualizedScrollViewRef,
    VirtualizedScrollViewRenderItem,
    getInitialVirtualizedScrollViewRenderedItemCount,
} from "~/client/virtualized/virtualized_scroll_view";
import {MessageContent} from "~/shared/content/message_content_schema";
import {wait} from "~/shared/helpers/async/wait";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit";
import {
    MessagingRealtimeMessageFromClient,
    MessagingRealtimeMessageFromServer,
} from "~/shared/messaging/messaging_realtime_schema";
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
          readonly item: DistributiveOmit<VirtualizedScrollViewItem, "key">;
      }
    | (MessageListItem<Message> & {readonly messageIndex: number});

class MessagingViewState<Message extends MessageModel> {
    private readonly _header: DistributiveOmit<VirtualizedScrollViewItem, "key"> | null;

    public readonly messages: MessageList<Message>;

    constructor(
        messages: MessageList<Message>,
        header: DistributiveOmit<VirtualizedScrollViewItem, "key"> | null,
    ) {
        this.messages = messages;
        this._header = header;
    }

    public getItemCount() {
        return this.messages.getMessageCount() + (this._header ? 1 : 0);
    }

    public getItem(index: number): MessagingViewStateItem<Message> {
        if (this._header) {
            if (index === 0) {
                return {
                    type: "Header",
                    item: this._header,
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

        if (!this._header) return range;

        const startIndex = Math.max(range.startIndex - 1, 0);
        const endIndex = Math.max(range.endIndex - 1, 0);

        // Make sure we didn't adjust the range to an out of bounds range.
        if (
            range.startIndex >= this.messages.getMessageCount() ||
            range.endIndex >= this.messages.getMessageCount()
        ) {
            return null;
        }

        return {startIndex, endIndex};
    }

    /**
     * Get the index of a message in our view.
     */
    public getItemIndexForMessageIndex(messageIndex: number): number {
        if (!this._header) return messageIndex;
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

export type MessagingViewRef = {
    jumpToMessageIndex(messageIndex: number): void;
};

const MessagingViewForwardRef = forwardRef(MessagingView);
export {MessagingViewForwardRef as MessagingView};

/**
 * Shared UI component for our messaging system. Wherever we have a list of
 * messaging in the product this component is how it's (usually) rendered.
 *
 * Implements all sorts of standard messaging functionality like virtualized
 * rendering of messages, lazy loading message, jumping to arbitrary messages,
 * sending messages, editing messages, and deleting messages.
 *
 * Post comments are the exception! Because we render post comments embedded in
 * a scroll view full of posts we have a separate `<PostListView>`
 * implementation that renders messages in a post.
 */
function MessagingView<RoomKey extends string, Message extends MessageModel<RoomKey>>(
    {
        messageNoun = "message",
        messageStartOfSentenceNoun = messageNoun.slice(0, 1).toUpperCase() + messageNoun.slice(1),
        initialScrollOffset,
        initialMessagesResult,
        header,
        randomSeedForShimmer,
        isMessageCreationDisabled,
        getMessagesFromStart,
        getMessagesFromEnd,
        isRealtimeConnected,
        sendRealtimeMessage,
        subscribeToRealtimeMessages,
        getCopyLinkUrl,
        inputStateRef,
    }: {
        /**
         * What we call messages in UI copy. Defaults to "message". For example
         * "Successfully deleted message". You may want that message to ready
         * "Successfully deleted comment" if you want to refer to your messages
         * as comments.
         */
        // NOTE(calebmer): This technique where we interpolate strings likely won't
        // work when we internationalize the product. Then I imagine we'll pass in a
        // `messageCopy` object, or something, with every string rendered by this UI
        // for translating.
        messageNoun?: string;

        /**
         * What we call messages in UI copy at the start of sentences. By default this
         * is `messageNoun` but with the first letter upper cased.
         */
        messageStartOfSentenceNoun?: string;

        /**
         * Do we start by showing messages at the top or bottom of the view?
         */
        initialScrollOffset: "top" | "bottom";

        /**
         * The initial messages we load into this view. The view knows to load more
         * messages with the `getMessagesFromStart` and `getMessagesFromEnd` function.
         */
        initialMessagesResult: {
            readonly messageCount: number;
            readonly messages: ReadonlyArray<Message>;
            readonly otherReferencedMessages: ReadonlyArray<Message>;
            readonly lastMessageChangeTime: Date | null;
        };

        /**
         * You may render a header on top of the messaging view which as an
         * arbitrary virtualized scroll view item.
         */
        header?: Memo<DistributiveOmit<VirtualizedScrollViewItem, "key">>;

        /**
         * For unloaded messages we show a shimmer. Shimmers have a random shape based
         * on their index in the message list and a seed. Usually the seed is the room
         * key for this messaging view but for applications like chat we may allow
         * sending messages before we know the room key.
         */
        randomSeedForShimmer: string;

        /**
         * Should we disable the user's ability to create a message? The user will
         * still be able to type in the message input but won't be able to send their
         * message. Once this prop switches to true the user can send the message
         * they typed.
         */
        isMessageCreationDisabled?: boolean;

        /**
         * Load messages from the start of the list. We expect the implementation of
         * this function passes the `testMessagingImplementation()` test suite.
         */
        getMessagesFromStart: (input: {
            limit: number;
            afterMessageIndex: number | null;
            beforeMessageIndex: number | null;
        }) => Promise<{
            messageCount: number;
            messages: ReadonlyArray<Message>;
            otherReferencedMessages: ReadonlyArray<Message>;
        }>;

        /**
         * Load messages from the end of the list. We expect the implementation of
         * this function passes the `testMessagingImplementation()` test suite.
         */
        getMessagesFromEnd: (input: {
            limit: number;
            afterMessageIndex: number | null;
            beforeMessageIndex: number | null;
        }) => Promise<{
            messageCount: number;
            messages: ReadonlyArray<Message>;
            otherReferencedMessages: ReadonlyArray<Message>;
        }>;

        /**
         * Do we have a realtime connection to a service implementing our realtime
         * messaging protocol?
         */
        isRealtimeConnected: boolean;

        /**
         * Send a realtime message to a service implementing our realtime messaging
         * protocol.
         */
        sendRealtimeMessage: Memo<(message: MessagingRealtimeMessageFromClient) => Promise<void>>;

        /**
         * Subscribe to realtime messages from a service implementing our realtime
         * messaging protocol.
         */
        subscribeToRealtimeMessages: Memo<
            (
                subscriber: (message: MessagingRealtimeMessageFromServer<Message>) => void,
            ) => () => void
        >;

        /**
         * Copies a link to a message. Opening this link should scroll the messaging
         * view to this message and highlight it.
         */
        getCopyLinkUrl: Memo<(messageIndex: number) => URL>;

        /**
         * A ref that we will use to initialize the content in `<MessageInput>`. We
         * will also write any state updates back into this ref. This was intended for
         * preserving message input contents across remounts e.g. remounting from a
         * React `key` change.
         */
        inputStateRef?: MutableRefObject<ContentEditorState<MessageContent> | null>;
    },
    ref: Ref<MessagingViewRef>,
) {
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
        () => new MessagingViewState(messagesWithoutHeader, header ?? null),
        [header, messagesWithoutHeader],
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
    const jumpToMessageIndex = useEvent((messageIndex: number) => {
        // If we are in the process of jumping, don't start another jump
        if (isJumpingToMessageRef.current) return;

        const view = assertExists(viewRef.current);

        const scrollToIndex = state.getItemIndexForMessageIndex(messageIndex);

        const peekRenderedRange = view.peekRenderedRangeAfterScrollToIndex(scrollToIndex);
        const result = tryLoadingMoreData(peekRenderedRange);

        if (!result.isLoading) {
            view.scrollToIndex(scrollToIndex);

            setHighlightMessage({
                messageIndex,
                shouldHighlightRef: {current: true},
            });
        } else {
            isJumpingToMessageRef.current = true;

            Promise.race([result.promise, wait(delayLoadingIndicatorLimitMs)]).finally(() => {
                isJumpingToMessageRef.current = false;

                view.scrollToIndex(scrollToIndex);

                setHighlightMessage({
                    messageIndex,
                    shouldHighlightRef: {current: true},
                });
            });
        }
    });

    const handleJumpToMessage = useCallback(
        (message: Message) => jumpToMessageIndex(message.index),
        [jumpToMessageIndex],
    );

    useImperativeHandle(ref, () => ({jumpToMessageIndex}), [jumpToMessageIndex]);

    const {actions} = useMessagingRealtime({
        messages: state.messages,
        onUpdateMessages: setMessages,
        isRealtimeConnected,
        sendRealtimeMessage,
        subscribeToRealtimeMessages,
    });

    // Manages the editable message.
    //
    // This is at the post list level because we want only one message to be
    // editable at a time.
    const messageEditing = useMessageEditing<RoomKey>({
        onUpdateMessageContent: input => actions.updateMessageContent(input),
    });

    useScrollToNewMessages({
        viewRef,
        messages: state.messages,
        getMessageViewKey: useCallback(postCommentIndex => `Message:${postCommentIndex}`, []),
    });

    const renderItem: VirtualizedScrollViewRenderItem = useCallback(
        index => {
            const item = state.getItem(index);

            switch (item.type) {
                case "Header": {
                    return {
                        ...item.item,
                        key: "Header",
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
                                    await actions.deleteMessage({
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
                                {index === 0 && <Spacer space={messageViewMarginY} />}
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
            actions,
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
                createMessage={input => actions.createMessage(input)}
                replyingToMessage={replyingToMessage}
                onClearReplyingToMessage={() => setReplyingToMessage(null)}
                onJumpToMessage={handleJumpToMessage}
                stateRef={inputStateRef}
            />
        </div>
    );
}
