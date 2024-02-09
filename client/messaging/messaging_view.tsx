import {
    Memo,
    MutableRefObject,
    ReactElement,
    ReactNode,
    Ref,
    cloneElement,
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Spacer} from "~/client/design/spacer.js";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {MessageEditing, useMessageEditing} from "~/client/messaging/message_editing.js";
import {MessageInput} from "~/client/messaging/message_input.js";
import {MessageList, MessageListItem} from "~/client/messaging/message_list.js";
import {MessageShimmer} from "~/client/messaging/message_shimmer.js";
import {
    MessageView,
    bufferedMessageViewHeight,
    messageViewMarginY,
} from "~/client/messaging/message_view.js";
import {
    MessagingTypingIndicators,
    messagingTypingIndicatorsMinHeight,
} from "~/client/messaging/messaging_typing_indicators.js";
import {tryLoadingMessages} from "~/client/messaging/try_loading_messages.js";
import {useMessagingRealtime} from "~/client/messaging/use_messaging_realtime.js";
import {useScrollToNewMessages} from "~/client/messaging/use_scroll_to_new_messages.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewItem,
    VirtualizedScrollViewRef,
    VirtualizedScrollViewRenderItem,
    getInitialVirtualizedScrollViewRenderedItemCount,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {Spacing} from "~/shared/design/spacing.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.js";
import {MessageContentWithReferences} from "~/shared/messaging/message_content_schema.js";
import {MessageModel} from "~/shared/messaging/message_model.js";
import {
    BackfillMessagesProcedure,
    CreateMessageProcedure,
    DeleteMessageProcedure,
    MessagingRealtimeEvent,
    StartTypingInMessageInputProcedure,
    StopTypingInMessageInputProcedure,
    UpdateMessageContentProcedure,
} from "~/shared/messaging/messaging_realtime_protocol.js";
import {messageViewMinHeight} from "~/shared/messaging/messaging_shared_styles.js";
import {ClientInfo} from "~/shared/remix/client_info.js";
import {sprinkles} from "~/shared/styles/styles.js";

export const messagingViewMarginBottom =
    "calc(var(--safe-area-inset-bottom, 0px) - var(--window-safe-area-inset-bottom, 0px))";

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
        return this.messages.getItemCount() + (this._header ? 1 : 0);
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
            ...this.messages.getItem(index),
            messageIndex: index,
        };
    }

    public hasHeader() {
        return !!this._header;
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
            range.startIndex >= this.messages.getItemCount() ||
            range.endIndex >= this.messages.getItemCount()
        ) {
            return null;
        }

        return this.messages.getMessagesRange({startIndex, endIndex});
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
        backfillMessages,
        createMessage,
        updateMessageContent,
        deleteMessage,
        startTypingInMessageInput,
        stopTypingInMessageInput,
        isConnected,
        subscribeToEvents,
        getMessageUrl,
        inputRestoreStateRef,
        roomDisplayedCreatedTime,
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
         * Backfill messages and updates we may be missing when connecting to realtime.
         */
        backfillMessages: Memo<BackfillMessagesProcedure<Message>>;

        /**
         * Create a new message in this room.
         */
        createMessage: Memo<CreateMessageProcedure>;

        /**
         * Update the contents of a message.
         */
        updateMessageContent: Memo<UpdateMessageContentProcedure>;

        /**
         * Delete a message.
         */
        deleteMessage: Memo<DeleteMessageProcedure>;

        /**
         * Show a typing indicator to other connected clients for this user.
         */
        startTypingInMessageInput: Memo<StartTypingInMessageInputProcedure>;

        /**
         * Stop showing a typing indicator to other connected clients for this user.
         */
        stopTypingInMessageInput: Memo<StopTypingInMessageInputProcedure>;

        /**
         * Do we have a realtime connection to a service implementing our realtime
         * messaging protocol?
         */
        isConnected: boolean;

        /**
         * Subscribe to any realtime chat events.
         */
        subscribeToEvents: Memo<
            (subscriber: (event: MessagingRealtimeEvent<Message>) => void) => () => void
        >;

        /**
         * Copies a link to a message. Opening this link should scroll the messaging
         * view to this message and highlight it.
         */
        getMessageUrl: Memo<(messageIndex: number) => URL>;

        /**
         * A ref that we will use to initialize the content in `<MessageInput>`. We
         * will also write any state updates back into this ref. This was intended for
         * preserving message input contents across remounts e.g. remounting from a
         * React `key` change.
         */
        inputRestoreStateRef?: MutableRefObject<{
            state: ContentEditorState<MessageContentWithReferences>;
            isFocused: boolean;
        } | null>;

        /**
         * If we display the time at which the messaging room was created, pass it in
         * here and we will not add a timestamp divider to the messaging view if the
         * first message was sent shortly after room creation. If not provided we
         * always render a time divider.
         */
        roomDisplayedCreatedTime?: Date;
    },
    ref: Ref<MessagingViewRef>,
) {
    const isMobile = useIsMobile();
    const context = useAppContext();
    const viewRef = useRef<VirtualizedScrollViewRef>(null);

    const paddingX: Spacing = isMobile ? "4" : "5";

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
    const [replyingToMessageIndex, setReplyingToMessageIndex] = useState<number | null>(null);

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
            view.scrollToIndex(scrollToIndex, {withAnchor: true});

            setHighlightMessage({
                messageIndex,
                shouldHighlightRef: {current: true},
            });
        } else {
            isJumpingToMessageRef.current = true;

            Promise.race([result.promise, wait(delayLoadingIndicatorLimitMs)]).finally(() => {
                isJumpingToMessageRef.current = false;

                view.scrollToIndex(scrollToIndex, {withAnchor: true});

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

    useMessagingRealtime({
        messages: state.messages,
        onUpdateMessages: setMessages,
        isConnected,
        backfillMessages,
        subscribeToEvents,
    });

    // Manages the editable message.
    //
    // This is at the post list level because we want only one message to be
    // editable at a time.
    const messageEditing = useMessageEditing<RoomKey>({
        onUpdateMessageContent: async input => {
            await updateMessageContent(input);
        },
    });

    useScrollToNewMessages({
        viewRef,
        messages: state.messages,
        getItemKey: useCallback(
            (item: MessageListItem<Message>) => getMessageListItemKey(item, null),
            [],
        ),
    });

    useEffect(() => {
        if (!NativeMobileBridge) return;

        return NativeMobileBridge.keyboard.subscribeToScrollMainContent(scrollOffsetDelta => {
            const view = assertExists(viewRef.current);

            view.setScrollOffset(view.getScrollOffset() + scrollOffsetDelta, {
                behavior: "smooth",
            });
        });
    }, []);

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
                default: {
                    return renderMessageListItem({
                        messageNoun,
                        messageStartOfSentenceNoun,
                        messages: state.messages,
                        groupKey: null,
                        index: state.hasHeader() ? index - 1 : index,
                        item,
                        randomSeedForShimmer,
                        messageEditing,
                        shouldHighlightRef:
                            item.message &&
                            !item.message.isOptimistic &&
                            highlightMessage?.messageIndex === item.message.index
                                ? highlightMessage.shouldHighlightRef
                                : null,
                        onJumpToMessage: handleJumpToMessage,
                        onReplyToMessage: message => setReplyingToMessageIndex(message.index),
                        onDeleteMessage: async message => {
                            await deleteMessage({
                                messageIndex: message.index,
                            });
                        },
                        getMessageUrl,
                        roomDisplayedCreatedTime,
                        shouldAddMarginTop: index === 0,
                        shouldAddMarginBottom: index === state.getItemCount() - 1,
                        marginX: paddingX,
                    });
                }
            }
        },
        [
            deleteMessage,
            getMessageUrl,
            handleJumpToMessage,
            highlightMessage,
            messageEditing,
            messageNoun,
            messageStartOfSentenceNoun,
            paddingX,
            randomSeedForShimmer,
            roomDisplayedCreatedTime,
            state,
        ],
    );

    return (
        <div
            className={sprinkles({
                flexGrow: "1",
                height: "full",
                overflow: "hidden",
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
                createMessage={async input => {
                    await createMessage(input);
                }}
                messageEditing={messageEditing}
                replyingToMessage={
                    replyingToMessageIndex !== null
                        ? state.messages.getLoadedMessageIfExists(replyingToMessageIndex)
                        : null
                }
                onClearReplyingToMessage={() => setReplyingToMessageIndex(null)}
                onJumpToMessage={handleJumpToMessage}
                onShowTypingIndicator={() => {
                    startTypingInMessageInput({})
                        // Don't show an error updating typing indicators to the user. We will see an
                        // error in our logs but the user won't see any weird behavior if the
                        // request fails.
                        .catch(error =>
                            context.tracer
                                .getRoot()
                                .logUncaughtException("Couldn't update typing indicator", error),
                        );
                }}
                onHideTypingIndicator={() => {
                    stopTypingInMessageInput({})
                        // Don't show an error updating typing indicators to the user. We will see an
                        // error in our logs but the user won't see any weird behavior if the
                        // request fails.
                        .catch(error =>
                            context.tracer
                                .getRoot()
                                .logUncaughtException("Couldn't update typing indicator", error),
                        );
                }}
                restoreStateRef={inputRestoreStateRef}
                marginX={paddingX}
            />
        </div>
    );
}

/**
 * If you are manually implementing a `<VirtualizedScrollView>` for your
 * `MessageList` (not recommended) then you may call this function to render
 * a `MessageListItem`.
 */
// NOTE(calebmer): Ideally `<PostListView>` would reuse some code with this
// function but `<PostListView>` was written before `<MessagingView>` so it'll
// take some work to migrate.
export function renderMessageListItem<
    RoomKey extends string,
    Message extends MessageModel<RoomKey>,
>({
    messageNoun,
    messageStartOfSentenceNoun,
    messages,
    groupKey,
    index,
    item,
    randomSeedForShimmer,
    messageEditing,
    shouldHighlightRef,
    onJumpToMessage,
    onReplyToMessage,
    onDeleteMessage,
    getMessageUrl,
    roomDisplayedCreatedTime,
    shouldAddMarginTop = index === 0,
    shouldAddMarginBottom = false,
    marginX,
    render: customRender,
}: {
    messageNoun?: string;
    messageStartOfSentenceNoun?: string;
    messages: MessageList<Message>;
    groupKey: string | null;
    index: number;
    item: MessageListItem<Message>;
    randomSeedForShimmer: string;
    messageEditing: MessageEditing<RoomKey>;
    shouldHighlightRef: MutableRefObject<boolean> | null;
    onJumpToMessage: Memo<(message: Message) => void>;
    onReplyToMessage: (message: Message) => void;
    onDeleteMessage: (message: Message) => Promise<void>;
    getMessageUrl: (messageIndex: number) => URL;
    roomDisplayedCreatedTime?: Date | undefined;
    shouldAddMarginTop?: boolean;
    shouldAddMarginBottom?: boolean;
    marginX?: Spacing;
    render?: (node: ReactNode) => ReactElement;
}): VirtualizedScrollViewItem {
    switch (item.type) {
        case "Loaded":
        case "Unloaded":
        case "Optimistic": {
            const previousItem = index > 0 ? messages.getItem(index - 1) : null;
            const nextItem =
                index < messages.getItemCount() - 1 ? messages.getItem(index + 1) : null;

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
                        isFirstMessage={item.messageIndex === 0}
                        previousMessage={previousMessage}
                        nextMessage={nextMessage}
                        messages={messages}
                        messageEditing={messageEditing}
                        shouldHighlightRef={shouldHighlightRef}
                        onJumpToMessage={onJumpToMessage}
                        onReplyToMessage={() => {
                            if (item.message.isOptimistic) return;
                            onReplyToMessage(item.message);
                        }}
                        onDeleteMessage={async () => {
                            if (item.message.isOptimistic) return;
                            await onDeleteMessage(item.message);
                        }}
                        disableExpensiveFeaturesDuringScroll={disableExpensiveFeaturesDuringScroll}
                        getMessageUrl={getMessageUrl}
                        roomDisplayedCreatedTime={roomDisplayedCreatedTime}
                        marginX={marginX}
                    />
                ) : (
                    <MessageShimmer
                        randomSeed={randomSeedForShimmer}
                        index={item.messageIndex}
                        previousMessage={previousMessage}
                        nextMessage={nextMessage}
                        messages={messages}
                        marginX={marginX}
                    />
                );
            };

            // It's important to reuse nodes across renders because then React won't try to
            // re-render the component.
            let elementWithExpensiveFeaturesDisabled: ReactElement | null = null;
            let elementWithoutExpensiveFeaturesDisabled: ReactElement | null = null;

            // NOTE(calebmer): This is an inline implementation of
            // `renderVirtualizedScrollViewItemWithExpensiveFeaturesDisabledDuringScroll()`.
            // That helper was added after this code and this code has some `customRender`
            // stuff I'm going to leave alone. Ideally this code would use the helper.
            const render = (isScrolling: boolean) => {
                // If we already rendered the node without expensive features disabled, don't
                // render a new version since that will cause a frame drop right at the start
                // of the scroll as React re-renders every message.
                if (elementWithoutExpensiveFeaturesDisabled !== null)
                    return elementWithoutExpensiveFeaturesDisabled;

                if (isScrolling) {
                    elementWithExpensiveFeaturesDisabled ??= actuallyRender(true);
                    return elementWithExpensiveFeaturesDisabled;
                } else {
                    elementWithoutExpensiveFeaturesDisabled ??= actuallyRender(false);
                    return elementWithoutExpensiveFeaturesDisabled;
                }
            };

            return {
                key:
                    typeof groupKey === "string"
                        ? item.type === "Loaded" || item.type === "Optimistic"
                            ? `Message:${groupKey}:${item.messageIndex}`
                            : `UnloadedMessage:${groupKey}:${item.messageIndex}`
                        : item.type === "Loaded" || item.type === "Optimistic"
                        ? `Message:${item.messageIndex}`
                        : `UnloadedMessage:${item.messageIndex}`,
                minHeight: messageViewMinHeight,
                withManualLayout: true,
                render: ({ref, shouldRenderWithRelativePositioning, offset, isScrolling}) => {
                    if (!customRender) {
                        return (
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
                                {shouldAddMarginTop && <Spacer space={messageViewMarginY} />}
                                {render(isScrolling)}
                                {shouldAddMarginBottom && (
                                    <div style={{height: messagingViewMarginBottom}} />
                                )}
                            </div>
                        );
                    } else {
                        const node = customRender(
                            <>
                                {shouldAddMarginTop && <Spacer space={messageViewMarginY} />}
                                {render(isScrolling)}
                                {shouldAddMarginBottom && (
                                    <div style={{height: messagingViewMarginBottom}} />
                                )}
                            </>,
                        );

                        return cloneElement(node, {
                            ref,
                            style: {
                                ...node.props.style,
                                minHeight: messageViewMinHeight,
                                ...(shouldRenderWithRelativePositioning
                                    ? {position: "relative"}
                                    : {
                                          position: "absolute",
                                          top: offset,
                                          left: 0,
                                          right: 0,
                                      }),
                            },
                        });
                    }
                },
            };
        }
        case "TypingIndicators": {
            const node = (
                <MessagingTypingIndicators
                    typingStateByConnectionId={item.typingStateByConnectionId}
                    marginX={marginX}
                    shouldAddMarginTop={shouldAddMarginTop}
                    shouldAddMarginBottom={shouldAddMarginBottom}
                />
            );

            return {
                key:
                    typeof groupKey === "string"
                        ? `TypingIndicators:${groupKey}`
                        : "TypingIndicators",
                minHeight: messagingTypingIndicatorsMinHeight,
                node: customRender ? customRender(node) : node,
            };
        }
        default:
            throw exhaustive(item);
    }
}

export function getMessageListItemKey<Message extends MessageModel>(
    item: MessageListItem<Message>,
    groupKey: string | null,
) {
    switch (item.type) {
        case "Loaded":
        case "Optimistic":
            return typeof groupKey === "string"
                ? `Message:${groupKey}:${item.messageIndex}`
                : `Message:${item.messageIndex}`;
        case "Unloaded":
            return typeof groupKey === "string"
                ? `UnloadedMessage:${groupKey}:${item.messageIndex}`
                : `UnloadedMessage:${item.messageIndex}`;
        case "TypingIndicators":
            return typeof groupKey === "string"
                ? `TypingIndicators:${groupKey}`
                : "TypingIndicators";

        default:
            throw exhaustive(item);
    }
}
