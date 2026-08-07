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
import {MessageInputFile} from "~/client/web/content/messaging/add_message_input_files.js";
import {MessageInputRef} from "~/client/web/content/messaging/message_input_base.js";
import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {ScrollbarInsetDynamic} from "~/client/web/design/scrollbar.js";
import {useScrollToAvoidBottomBarsAndMobileKeyboard} from "~/client/web/design/use_scroll_to_avoid_bottom_bars_and_mobile_keyboard.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {useErrorState} from "~/client/web/helpers/use_error_state.js";
import {useStateWithOptimisticUpdates} from "~/client/web/helpers/use_state_with_optimistic_updates.js";
import {MessageStreamApprovalSessionNoun} from "~/client/web/messaging/internal/message_stream_view_approvals.js";
import {useMessageEditing} from "~/client/web/messaging/message_editing.js";
import {MessageInput} from "~/client/web/messaging/message_input.js";
import {MessageList, MessageListItem} from "~/client/web/messaging/message_list.js";
import {bufferedMessageViewHeight} from "~/client/web/messaging/message_view.js";
import {MessagingViewPointerToolbar} from "~/client/web/messaging/messaging_view_pointer_toolbar.js";
import {OnPutMessageApprovalDecisionsFunction} from "~/client/web/messaging/on_put_message_approval_decisions_function.js";
import {
    getMessageListItemKey,
    renderMessageListItem,
} from "~/client/web/messaging/render_message_list_item.js";
import {
    OnDeleteMessageReactionFunction,
    OnSetMessageReactionFunction,
    OnUpdateMessagesOptimisticallyFunction,
} from "~/client/web/messaging/set_or_delete_message_reaction_with_optimistic_update.js";
import {tryLoadingMessages} from "~/client/web/messaging/try_loading_messages.js";
import {
    JumpToMessageRangeOptions,
    useJumpToMessageRange,
} from "~/client/web/messaging/use_jump_to_message_range.js";
import {useMessagingRealtime} from "~/client/web/messaging/use_messaging_realtime.js";
import {useScrollToNewMessages} from "~/client/web/messaging/use_scroll_to_new_messages.js";
import {getClientInfo} from "~/client/web/remix/client_info_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewItem,
    VirtualizedScrollViewRef,
    VirtualizedScrollViewRenderItem,
} from "~/client/web/virtualized/virtualized_scroll_view.js";
import {
    ResolvedAccessPolicyWithGenerations,
    getAccountAccessLevelAssumingSpaceAccess,
    hasAccessLevel,
} from "~/shared/access/access_policy.js";
import {MessageContentWithReferences} from "~/shared/content/message_content_schema.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.open_source.js";
import {MessageDraftWithFiles} from "~/shared/messaging/message_draft_schema.js";
import {MessageDraftSurface} from "~/shared/messaging/message_draft_surface.js";
import {MessageModel} from "~/shared/messaging/message_model.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";
import {
    BackfillMessagesProcedure,
    CreateMessageProcedure,
    DeleteMessageProcedure,
    DeleteMessageReactionProcedure,
    MessagingRealtimeEvent,
    PutMessageApprovalDecisionsProcedure,
    SetMessageReactionProcedure,
    StartTypingInMessageInputProcedure,
    StopTypingInMessageInputProcedure,
    UpdateMessageContentProcedure,
} from "~/shared/messaging/messaging_realtime_protocol.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";
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
     * Transform the range for our state's virtualized list into a range of just
     * messages.
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
    focusInput(): void;
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
 * Post comments are the exception! Because we render post comments embedded in a
 * scroll view full of posts we have a separate `<PostListView>` implementation
 * that renders messages in a post.
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
        withAttachFileBeforeCreateMessage,
        accessPolicy,
        getMessagesFromStart,
        getMessagesFromEnd,
        backfillMessages,
        createMessage,
        updateMessageContent,
        deleteMessage,
        setMessageReaction,
        deleteMessageReaction,
        putMessageApprovalDecisions,
        approvalSessionNoun,
        startTypingInMessageInput,
        stopTypingInMessageInput,
        messageDraftSurface,
        messageDraft,
        isConnected,
        subscribeToEvents,
        subscribeToPongs,
        getMessageUrl,
        inputRestoreStateRef,
        roomDisplayedCreatedTime,
        elementRef,
        extraChildren,
        scrollbarInsetTop,
        dangerousCurrentlyViewingSearchEntityId,
    }: {
        /**
         * What we call messages in UI copy. Defaults to "message". For example
         * "Successfully deleted message". You may want that message to ready "Successfully
         * deleted comment" if you want to refer to your messages as comments.
         */
        // NOTE(calebmer): This technique where we interpolate strings likely won't work
        // when we internationalize the product. Then I imagine we'll pass in a
        // `messageCopy` object, or something, with every string rendered by this UI for
        // translating.
        messageNoun?: string;

        /**
         * The noun for the approval session. This is used to determine the language for
         * approval cards (e.g. "Allow all writes for this chat/post/task/thread").
         */
        approvalSessionNoun: MessageStreamApprovalSessionNoun;

        /**
         * What we call messages in UI copy at the start of sentences. By default this is
         * `messageNoun` but with the first letter upper cased.
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
         * You may render a header on top of the messaging view which as an arbitrary
         * virtualized scroll view item.
         */
        header?: Memo<DistributiveOmit<VirtualizedScrollViewItem, "key">>;

        /**
         * For unloaded messages we show a shimmer. Shimmers have a random shape based on
         * their index in the message list and a seed. Usually the seed is the room key for
         * this messaging view but for applications like chat we may allow sending messages
         * before we know the room key.
         */
        randomSeedForShimmer: string;

        /**
         * Should we disable the user's ability to create a message? The user will still be
         * able to type in the message input but won't be able to send their message. Once
         * this prop switches to true the user can send the message they typed.
         */
        isMessageCreationDisabled?: boolean;

        /**
         * Target which files in this messaging room are attached to.
         */
        fileAttachmentTarget: Memo<FileAttachmentTarget> | null;

        /**
         * By default, we attach files to `fileAttachmentTarget` when the user drops the
         * file onto the message input. However, for cases when `fileAttachmentTarget` may
         * change while editing a message we want to instead attach files before the
         * message is created on the server. To attach files when the message is created on
         * the server set `withAttachFileBeforeCreateMessage` to true. Otherwise files will
         * be attached when they're dropped on the message input.
         */
        withAttachFileBeforeCreateMessage?: boolean;

        /**
         * Renders as read-only if the user doesn't have `Comment` access in this
         * `EffectiveAccessPolicyWithGenerations`.
         */
        accessPolicy?: ResolvedAccessPolicyWithGenerations;

        /**
         * Load messages from the start of the list. We expect the implementation of this
         * function passes the `testMessagingImplementation()` test suite.
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
         * Load messages from the end of the list. We expect the implementation of this
         * function passes the `testMessagingImplementation()` test suite.
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
         * Record the current account's decisions on a message stream's approval requests.
         * Optional since not every messaging room supports agent approvals. When omitted,
         * approval cards render in a read-only "waiting" state.
         */
        putMessageApprovalDecisions?: Memo<PutMessageApprovalDecisionsProcedure>;

        /**
         * Show a typing indicator to other connected clients for this user.
         */
        startTypingInMessageInput: Memo<StartTypingInMessageInputProcedure>;

        /**
         * Stop showing a typing indicator to other connected clients for this user.
         */
        stopTypingInMessageInput: Memo<StopTypingInMessageInputProcedure>;

        /**
         * The private draft surface for this message input
         */
        messageDraftSurface?: MessageDraftSurface;

        /**
         * A previously persisted message draft for this input
         */
        messageDraft?: MessageDraftWithFiles;

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
         * Copies a link to a message. Opening this link should scroll the messaging view
         * to this message and highlight it.
         */
        getMessageUrl: Memo<(messageIndex: number) => URL>;

        /**
         * A ref that we will use to initialize the content in `<MessageInput>`. We will
         * also write any state updates back into this ref. This was intended for
         * preserving message input contents across remounts e.g. remounting from a React
         * `key` change.
         */
        inputRestoreStateRef?: MutableRefObject<{
            state: ContentEditorState<MessageContentWithReferences>;
            files: ReadonlyArray<MessageInputFile>;
            isFocused: boolean;
        } | null>;

        /**
         * If we display the time at which the messaging room was created, pass it in here
         * and we will not add a timestamp divider to the messaging view if the first
         * message was sent shortly after room creation. If not provided we always render a
         * time divider.
         */
        roomDisplayedCreatedTime?: Date;

        /**
         * If you want to attach a ref to the scroll view DOM element instead of
         * `VirtualizedScrollViewRef` then you may use this prop.
         */
        elementRef?: Ref<HTMLDivElement>;

        /**
         * Extra children to always render in our virtualized scroll view. Useful if you
         * want to render extra sticky content.
         *
         * The children are rendered in a container with no pointer events. So you need to
         * add `pointerEvents: "auto"` on elements you want to be interactive with a
         * pointer.
         */
        extraChildren?: ReactNode;

        /**
         * Inset the scrollbar by this many pixels. If both `scrollbarInsetTopItemIndex`
         * and `scrollbarInsetTop` are set then `scrollbarInsetTop` wins.
         */
        scrollbarInsetTop?: ScrollbarInsetDynamic;

        /**
         * Optional entity that the user is currently viewing. This is passed to bots when
         * sending messages to provide context about what the user is looking at. Only used
         * in 1:1 chats with bots.
         */
        dangerousCurrentlyViewingSearchEntityId?: SearchMentionEntityId | null;
    },
    ref: Ref<MessagingViewRef<RoomKey>>,
) {
    const spacingScale = useSpacingScale();
    const reporter = useReporter();
    const {currentAccount} = useSpaceContext();

    const viewRef = useRef<VirtualizedScrollViewRef>(null);
    const inputRef = useRef<MessageInputRef>(null);

    const isReadOnly = useMemo(
        () =>
            accessPolicy !== undefined &&
            !hasAccessLevel(
                getAccountAccessLevelAssumingSpaceAccess(accessPolicy, currentAccount?.id),
                "Comment",
            ),
        [accessPolicy, currentAccount?.id],
    );

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

    // Whenever our list data changes, try loading more comments. In case our rendered
    // range stayed the same but we see some some unloaded comments.
    //
    // This effect should also fire when `tryLoadingMoreData()` completes in case it
    // didn't fully load the list.
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
            focusInput: () => {
                if (isReadOnly) return;
                assertExists(inputRef.current).focus();
            },
        }),
        [jumpToMessageRange, isReadOnly],
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
    // This is at the post list level because we want only one message to be editable
    // at a time.
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
        inputRef: !isReadOnly ? inputRef : null,
        isInputStickyPositioned: true,
        messages: state.messages,
        getItemKey: useCallback(
            (item: MessageListItem<Message>) => getMessageListItemKey(item, null),
            [],
        ),
    });

    // Make sure the bottom of the scroll view stays visible when the keyboard opens
    // and closes.
    useScrollToAvoidBottomBarsAndMobileKeyboard(viewRef, {
        getAnchorPosition: useEvent(oldVisibleRect => ({
            top: oldVisibleRect.bottom,
            height: 0,
            isPinned: true,
        })),
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

    const handlePutMessageApprovalDecisions: Memo<OnPutMessageApprovalDecisionsFunction<RoomKey>> =
        useCallback(
            async (roomKey, input) => {
                await assertExists(putMessageApprovalDecisions)(input);
            },
            [putMessageApprovalDecisions],
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
                        // `fileAttachmentTarget` will only be null if we're in the new chat screen and
                        // accounts haven't been selected yet. In this case no messages should be rendered.
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
                        onPutMessageApprovalDecisions: putMessageApprovalDecisions
                            ? handlePutMessageApprovalDecisions
                            : undefined,
                        approvalSessionNoun,
                        roomDisplayedCreatedTime,
                        shouldAddMarginTop: index === 0,
                        shouldAddMarginBottom: index === state.getItemCount() - 1,
                        isReadOnly,
                    });
                }
            }
        },
        [
            approvalSessionNoun,
            deleteMessage,
            fileAttachmentTarget,
            getMessageUrl,
            handleDeleteMessageReaction,
            handlePutMessageApprovalDecisions,
            handleSetMessageReaction,
            handleUpdateMessagesOptimistically,
            isReadOnly,
            jumpState,
            jumpToMessageRange,
            messageEditing,
            messageNoun,
            messageStartOfSentenceNoun,
            putMessageApprovalDecisions,
            randomSeedForShimmer,
            roomDisplayedCreatedTime,
            spacingScale,
            state,
        ],
    );

    return (
        <>
            {modals}
            <div
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
                <VirtualizedScrollView
                    ref={viewRef}
                    elementRef={elementRef}
                    data-testid="MessagingScrollView"
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
                {!isReadOnly && (
                    <MessageInput
                        ref={inputRef}
                        data-testid="MessageInput"
                        messageNoun={messageNoun}
                        messages={state.messages}
                        isMessageCreationDisabled={isMessageCreationDisabled}
                        onUpdateMessages={setMessages}
                        createMessage={async input => {
                            await createMessage({
                                ...input,
                                createdTimeZone: getClientInfo().timeZone,
                                dangerousCurrentlyViewingSearchEntityId:
                                    dangerousCurrentlyViewingSearchEntityId ?? undefined,
                            });
                        }}
                        fileAttachmentTarget={fileAttachmentTarget}
                        withAttachFileBeforeCreateMessage={withAttachFileBeforeCreateMessage}
                        messageEditing={messageEditing}
                        parent={inputParent}
                        onParentClear={() => setInputParent(null)}
                        onParentChange={setInputParent}
                        onJumpToMessageRange={jumpToMessageRange}
                        onDeleteMessage={async messageIndex => {
                            await deleteMessage({messageIndex});
                        }}
                        onShowTypingIndicator={() => {
                            startTypingInMessageInput({})
                                // Don't show an error updating typing indicators to the user. We will see an error
                                // in our logs but the user won't see any weird behavior if the request fails.
                                .catch(error =>
                                    reporter.logErrorWithoutDisplaying(
                                        "Couldn\u2019t update typing indicator",
                                        error,
                                    ),
                                );
                        }}
                        onHideTypingIndicator={() => {
                            stopTypingInMessageInput({})
                                // Don't show an error updating typing indicators to the user. We will see an error
                                // in our logs but the user won't see any weird behavior if the request fails.
                                .catch(error =>
                                    reporter.logErrorWithoutDisplaying(
                                        "Couldn\u2019t update typing indicator",
                                        error,
                                    ),
                                );
                        }}
                        restoreStateRef={inputRestoreStateRef}
                        messageDraftSurface={messageDraftSurface}
                        messageDraft={messageDraft}
                    />
                )}
            </div>
        </>
    );
}
