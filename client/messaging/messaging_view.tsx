import {
    Memo,
    MutableRefObject,
    ReactNode,
    Ref,
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {MessageInputFile} from "~/client/content/messaging/add_message_input_files.js";
import {MessageInputRef} from "~/client/content/messaging/message_input_base.js";
import {useMessagingViewDropTarget} from "~/client/content/messaging/use_messaging_view_drop_target.js";
import {ContentEditorState} from "~/client/content/state/content_editor_state.js";
import {useReporter} from "~/client/design/reporter.js";
import {ScrollbarInsetDynamic} from "~/client/design/scrollbar.js";
import {useScrollToAvoidBottomBarsAndMobileKeyboard} from "~/client/design/use_scroll_to_avoid_bottom_bars_and_mobile_keyboard.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useErrorState} from "~/client/helpers/use_error_state.js";
import {useStateWithOptimisticUpdates} from "~/client/helpers/use_state_with_optimistic_updates.js";
import {useMessageEditing} from "~/client/messaging/message_editing.js";
import {MessageInput} from "~/client/messaging/message_input.js";
import {MessageList, MessageListItem} from "~/client/messaging/message_list.js";
import {bufferedMessageViewHeight} from "~/client/messaging/message_view.js";
import {MessagingViewPointerToolbar} from "~/client/messaging/messaging_view_pointer_toolbar.js";
import {
    getMessageListItemKey,
    renderMessageListItem,
} from "~/client/messaging/render_message_list_item.js";
import {
    OnDeleteMessageReactionFunction,
    OnSetMessageReactionFunction,
    OnUpdateMessagesOptimisticallyFunction,
} from "~/client/messaging/set_or_delete_message_reaction_with_optimistic_update.js";
import {tryLoadingMessages} from "~/client/messaging/try_loading_messages.js";
import {
    JumpToMessageRangeOptions,
    useJumpToMessageRange,
} from "~/client/messaging/use_jump_to_message_range.js";
import {useMessagingRealtime} from "~/client/messaging/use_messaging_realtime.js";
import {useScrollToNewMessages} from "~/client/messaging/use_scroll_to_new_messages.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {sprinkles} from "~/client/styles/styles.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewItem,
    VirtualizedScrollViewRef,
    VirtualizedScrollViewRenderItem,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.js";
import {MessageContentWithReferences} from "~/shared/messaging/message_content_schema.js";
import {MessageModel} from "~/shared/messaging/message_model.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";
import {
    BackfillMessagesProcedure,
    CreateMessageProcedure,
    DeleteMessageProcedure,
    DeleteMessageReactionProcedure,
    MessagingRealtimeEvent,
    SetMessageReactionProcedure,
    StartTypingInMessageInputProcedure,
    StopTypingInMessageInputProcedure,
    UpdateMessageContentProcedure,
} from "~/shared/messaging/messaging_realtime_protocol.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";
import {WebSocketPongMessage} from "~/shared/web_socket/web_socket_schema.js";

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

export type MessagingViewRef<RoomKey extends string> = {
    jumpToMessageRange(options: JumpToMessageRangeOptions<RoomKey>): void;
    getScrollOffset(): number;
    setScrollOffset(scrollOffset: number): void;
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
        fileAttachmentTarget,
        withAttachFileBeforeCreateMessage = false,
        getMessagesFromStart,
        getMessagesFromEnd,
        backfillMessages,
        createMessage,
        updateMessageContent,
        deleteMessage,
        setMessageReaction,
        deleteMessageReaction,
        startTypingInMessageInput,
        stopTypingInMessageInput,
        isConnected,
        subscribeToEvents,
        subscribeToPongs,
        getMessageUrl,
        inputRestoreStateRef,
        roomDisplayedCreatedTime,
        elementRef,
        extraChildren,
        scrollbarInsetTop,
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
            readonly checkpoint: ServerSynchronizationCheckpoint;
            readonly messageCount: number;
            readonly messages: ReadonlyArray<Message>;
            readonly otherReferencedMessages: ReadonlyArray<Message>;
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
         * Target which files in this messaging room are attached to.
         */
        fileAttachmentTarget: Memo<FileAttachmentTarget> | null;

        /**
         * By default, we attach files to `fileAttachmentTarget` when the user drops
         * the file onto the message input. However, for cases when
         * `fileAttachmentTarget` may change while editing a message we want to instead
         * attach files before the message is created on the server. To attach files
         * when the message is created on the server set
         * `withAttachFileBeforeCreateMessage` to true. Otherwise files will be
         * attached when they're dropped on the message input.
         */
        withAttachFileBeforeCreateMessage?: boolean;

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
         * Set a reaction on a message.
         */
        setMessageReaction: Memo<SetMessageReactionProcedure>;

        /**
         * Delete a reaction on a message.
         */
        deleteMessageReaction: Memo<DeleteMessageReactionProcedure>;

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
         * Subscribe to any pong messages from our realtime WebSocket connection.
         */
        subscribeToPongs: Memo<(subscriber: (message: WebSocketPongMessage) => void) => () => void>;

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
            files: ReadonlyArray<MessageInputFile>;
            isFocused: boolean;
        } | null>;

        /**
         * If we display the time at which the messaging room was created, pass it in
         * here and we will not add a timestamp divider to the messaging view if the
         * first message was sent shortly after room creation. If not provided we
         * always render a time divider.
         */
        roomDisplayedCreatedTime?: Date;

        /**
         * If you want to attach a ref to the scroll view DOM element instead of
         * `VirtualizedScrollViewRef` then you may use this prop.
         */
        elementRef?: Ref<HTMLDivElement>;

        /**
         * Extra children to always render in our virtualized scroll view. Useful if
         * you want to render extra sticky content.
         *
         * The children are rendered in a container with no pointer events. So you need
         * to add `pointerEvents: "auto"` on elements you want to be interactive with
         * a pointer.
         */
        extraChildren?: ReactNode;

        /**
         * Inset the scrollbar by this many pixels. If both
         * `scrollbarInsetTopItemIndex` and `scrollbarInsetTop` are set then
         * `scrollbarInsetTop` wins.
         */
        scrollbarInsetTop?: ScrollbarInsetDynamic;
    },
    ref: Ref<MessagingViewRef<RoomKey>>,
) {
    const spacingScale = useSpacingScale();
    const reporter = useReporter();

    const viewRef = useRef<VirtualizedScrollViewRef>(null);
    const inputRef = useRef<MessageInputRef>(null);

    const [messagesWithoutHeader, setMessages, setMessagesOptimistically] =
        useStateWithOptimisticUpdates(() => {
            const messages = MessageList.new<Message>({
                checkpoint: initialMessagesResult.checkpoint,
                messageCount: initialMessagesResult.messageCount,
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
    const setErrorState = useErrorState();

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
                    setErrorState(error);
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
    const [inputParent, setInputParent] = useState<MessageContentPayloadParent | null>(null);

    const {jumpState, jumpToMessageRange} = useJumpToMessageRange({
        viewRef,
        tryLoadingMoreData,
        scrollToIndexForMessageIndex: (roomKey, index) => state.getItemIndexForMessageIndex(index),
    });

    useImperativeHandle(
        ref,
        () => ({
            jumpToMessageRange,
            getScrollOffset: () => assertExists(viewRef.current).getScrollOffset(),
            setScrollOffset: scrollOffset =>
                assertExists(viewRef.current).setScrollOffset(scrollOffset),
        }),
        [jumpToMessageRange],
    );

    useMessagingRealtime({
        isConnected,
        messages: state.messages,
        onUpdateMessages: setMessages,
        backfillMessages,
        subscribeToEvents,
        subscribeToPongs,
    });

    // Manages the editable message.
    //
    // This is at the post list level because we want only one message to be
    // editable at a time.
    const {messageEditing, modals} = useMessageEditing<RoomKey>({
        messageNoun,
        onUpdateMessageContent: async input => {
            await updateMessageContent(input);
        },
        onDeleteMessage: async input => {
            await deleteMessage(input);
        },
    });

    useScrollToNewMessages({
        viewRef,
        inputRef,
        isInputStickyPositioned: true,
        messages: state.messages,
        getItemKey: useCallback(
            (item: MessageListItem<Message>) => getMessageListItemKey(item, null),
            [],
        ),
    });

    // Make sure the bottom of the scroll view stays visible when the keyboard
    // opens and closes.
    //
    // Unless we are replying to a message or editing a message. Then we should
    // anchor to the message in question. Similar code also exists in
    // `post_list_view.tsx` and `document_comment_thread_list_view.tsx`. If we
    // update the code here we also probably need to update there.
    useScrollToAvoidBottomBarsAndMobileKeyboard(viewRef, {
        isPinned: true,
        getAnchorPosition: useEvent(oldVisibleRect => {
            // NOTE(calebmer, 2024-07-16): We used to anchor chat view scroll to the
            // message the user was replying to or editing. However, in practice this felt
            // janky to me. Scrolling wasn't predictable when swiping to reply to a
            // message! I think consistency is likely the better user experience here.
            //
            // To look at the old message anchoring code, git blame this comment to see the
            // commit where I remove it.

            return {top: oldVisibleRect.bottom, height: 0};
        }),
    });

    const handleSetMessageReaction: Memo<OnSetMessageReactionFunction<RoomKey>> = useCallback(
        async (roomKey, input) => {
            await setMessageReaction(input);
        },
        [setMessageReaction],
    );

    const handleDeleteMessageReaction: Memo<OnDeleteMessageReactionFunction<RoomKey>> = useCallback(
        async (roomKey, input) => {
            await deleteMessageReaction(input);
        },
        [deleteMessageReaction],
    );

    const handleUpdateMessagesOptimistically: Memo<
        OnUpdateMessagesOptimisticallyFunction<RoomKey, Message>
    > = useCallback(
        (roomKey, promise, update) => {
            setMessagesOptimistically(promise, update);
        },
        [setMessagesOptimistically],
    );

    const renderItem: VirtualizedScrollViewRenderItem = useCallback(
        (index: number) => {
            const item = state.getItem(index);

            switch (item.type) {
                case "Header": {
                    return {
                        ...item.item,
                        key: "Header",
                    };
                }
                default: {
                    return renderMessageListItem<RoomKey, Message>({
                        spacingScale,
                        messageNoun,
                        messageStartOfSentenceNoun,
                        messages: state.messages,
                        // `fileAttachmentTarget` must be non-null if we render a message.
                        // `fileAttachmentTarget` will only be null if we're in the new chat screen
                        // and accounts haven't been selected yet. In this case no messages should be
                        // rendered.
                        fileAttachmentTarget: assertExists(fileAttachmentTarget),
                        groupKey: null,
                        index: state.hasHeader() ? index - 1 : index,
                        item,
                        randomSeedForShimmer,
                        messageEditing,
                        jumpState:
                            item.message &&
                            !item.message.isOptimistic &&
                            jumpState &&
                            jumpState.options.startIndex <= item.message.index &&
                            item.message.index <= jumpState.options.endIndex
                                ? jumpState.messages[
                                      item.message.index - jumpState.options.startIndex
                                  ]!
                                : null,
                        onJumpToMessageRange: jumpToMessageRange,
                        onReplyToMessage: message =>
                            setInputParent({type: "Message", index: message.index}),
                        onDeleteMessage: async message => {
                            await deleteMessage({
                                messageIndex: message.index,
                            });
                        },
                        getMessageUrl,
                        onSetMessageReaction: handleSetMessageReaction,
                        onDeleteMessageReaction: handleDeleteMessageReaction,
                        onUpdateMessagesOptimistically: handleUpdateMessagesOptimistically,
                        roomDisplayedCreatedTime,
                        shouldAddMarginTop: index === 0,
                        shouldAddMarginBottom: index === state.getItemCount() - 1,
                    });
                }
            }
        },
        [
            deleteMessage,
            fileAttachmentTarget,
            getMessageUrl,
            handleDeleteMessageReaction,
            handleSetMessageReaction,
            handleUpdateMessagesOptimistically,
            jumpState,
            jumpToMessageRange,
            messageEditing,
            messageNoun,
            messageStartOfSentenceNoun,
            randomSeedForShimmer,
            roomDisplayedCreatedTime,
            spacingScale,
            state,
        ],
    );

    const {dragOverlay, dropTargetProps} = useMessagingViewDropTarget({
        isDisabled: messageEditing.state.isEditing,
        onDrop: event => assertExists(inputRef.current).drop(event.dataTransfer),
    });

    return (
        <>
            {modals}
            <div
                {...dropTargetProps}
                data-testid="MessagingView"
                className={sprinkles({
                    position: "relative",
                    flexGrow: "1",
                    height: "full",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                })}
            >
                {dragOverlay}
                <VirtualizedScrollView
                    ref={viewRef}
                    elementRef={elementRef}
                    renderItem={renderItem}
                    extraChildren={
                        <>
                            {extraChildren}
                            <MessagingViewPointerToolbar<RoomKey, Message>
                                viewRef={viewRef}
                                messageNoun={messageNoun}
                                getMessagesByRoomKey={useCallback(
                                    () => state.messages,
                                    [state.messages],
                                )}
                                onReplyToMessagesRange={(roomKey, parent) => setInputParent(parent)}
                                onSetMessageReaction={handleSetMessageReaction}
                                onDeleteMessageReaction={handleDeleteMessageReaction}
                                onUpdateMessagesOptimistically={handleUpdateMessagesOptimistically}
                            />
                        </>
                    }
                    initialScrollOffset={initialScrollOffset}
                    bufferedItemHeight={bufferedMessageViewHeight}
                    itemCount={state.getItemCount()}
                    onRenderedRangeChange={tryLoadingMoreData}
                    scrollbarInsetTop={scrollbarInsetTop}
                />
                <MessageInput
                    ref={inputRef}
                    data-testid="MessageInput"
                    messageNoun={messageNoun}
                    messages={state.messages}
                    isMessageCreationDisabled={isMessageCreationDisabled}
                    onUpdateMessages={setMessages}
                    createMessage={async input => {
                        await createMessage(input);
                    }}
                    fileAttachmentTarget={fileAttachmentTarget}
                    withAttachFileBeforeCreateMessage={withAttachFileBeforeCreateMessage}
                    messageEditing={messageEditing}
                    parent={inputParent}
                    onParentClear={() => setInputParent(null)}
                    onJumpToMessageRange={jumpToMessageRange}
                    onDeleteMessage={async messageIndex => {
                        await deleteMessage({messageIndex});
                    }}
                    onShowTypingIndicator={() => {
                        startTypingInMessageInput({})
                            // Don't show an error updating typing indicators to the user. We will see an
                            // error in our logs but the user won't see any weird behavior if the
                            // request fails.
                            .catch(error =>
                                reporter.logErrorWithoutDisplaying(
                                    "Couldn’t update typing indicator",
                                    error,
                                ),
                            );
                    }}
                    onHideTypingIndicator={() => {
                        stopTypingInMessageInput({})
                            // Don't show an error updating typing indicators to the user. We will see an
                            // error in our logs but the user won't see any weird behavior if the
                            // request fails.
                            .catch(error =>
                                reporter.logErrorWithoutDisplaying(
                                    "Couldn’t update typing indicator",
                                    error,
                                ),
                            );
                    }}
                    restoreStateRef={inputRestoreStateRef}
                />
            </div>
        </>
    );
}
