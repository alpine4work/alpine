import createTree, {Tree} from "functional-red-black-tree";
import {ContentReferences, mergeContentReferences} from "~/shared/content/content_references.js";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {InvalidArgumentError, OutOfRangeError} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {Id} from "~/shared/id/id.open_source.js";
import {WebSocketConnectionId} from "~/shared/id/types/id_types.open_source.js";
import {
    MessageModel,
    OptimisticMessageModel,
    areMessagePayloadModelsEqual,
} from "~/shared/messaging/message_model.js";
import {MessageStream, MessageStreamPartPayload} from "~/shared/messaging/message_schema.js";
import {MessagingTypingState} from "~/shared/messaging/messaging_realtime_protocol.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";

export type MessageListItem<Message extends MessageModel> =
    | MessageListLoadedItem<Message>
    | MessageListUnloadedItem
    | MessageListOptimisticItem
    | MessageListTypingIndicatorsItem;

export type MessageListLoadedItem<Message extends MessageModel> = {
    readonly type: "Loaded";
    readonly message: Message;
    readonly messageIndex: number;
};

export type MessageListUnloadedItem = {
    readonly type: "Unloaded";
    readonly messageIndex: number;
    readonly message?: undefined;
};

export type MessageListOptimisticItem = {
    readonly type: "Optimistic";
    readonly message: OptimisticMessageModel;
    readonly messageIndex: number;
    /**
     * What is the index of this message relative to other optimistic messages? For
     * example, if this is the second optimistic message and we have 10 loaded
     * messages, this will be 1 because it is index 1 in the optimistic messages array.
     */
    readonly optimisticMessageIndex: number;
};

export type MessageListTypingIndicatorsItem = {
    readonly type: "TypingIndicators";
    readonly typingStateByConnectionId: ImmutableMap<WebSocketConnectionId, MessagingTypingState>;
    readonly message?: undefined;
};

/**
 * Immutable state for keeping track of a list of messages. The message list may be
 * partially loaded at any time with gaps between messages.
 */
export class MessageList<Message extends MessageModel> {
    /**
     * The number of messages in the list excluding optimistic messages.
     *
     * This corresponds to the `messageCount` property we receive when loading a
     * message list. Or that's on the messaging room model (e.g. `PostModel`'s
     * `commentCount` property).
     *
     * When getting the message count from `MessageList` we required you to make an
     * explicit choice between "including optimistic messages" or "excluding optimistic
     * messages" to avoid bugs. For example, in the UI when rendering a message count
     * you may want to include optimistic messages but when running a realtime event
     * backfill you may want to exclude optimistic messages since the server might not
     * know about optimistic messages yet.
     */
    private readonly _messageCountExcludingOptimisticMessages: number;

    /**
     * The loaded messages in our list.
     *
     * Messages are a dense list with no gaps. If you have a message at index 8 then
     * you know there's a message at index 7, 6, 5, etc. If you have a `messageCount`
     * of 100 then you know the first message's index is 0 and the last message's index
     * is 99. This allows you to paginate to arbitrary points within the message list
     * with ease.
     *
     * However, the _loaded_ messages on the client are sparse! We don't always have
     * the full message list loaded in memory. In a chat with 1000 messages we may only
     * have the last 20 messages loaded. If one of those 20 messages is a reply to
     * message with index 532 then this property will have the last 20 messages
     * (indexes 979-999) and index 532 loaded (so we can render the content of message
     * 532).
     *
     * If the user clicks on that reply then we'll load the messages around index 532
     * and jump the user to that position. At that point this property may have the
     * original messages (indexes 979-999) in addition to 20 new messages around index
     * 532 (indexes 522-542).
     *
     * This is a binary tree so we have O(log(n)) time complexity for immutable
     * insertion/updates.
     */
    private readonly _messages: Tree<number, Message>;

    /**
     * Tracks ranges of unloaded messages in the list.
     *
     * Allows us to efficiently ask "what's the first unloaded message after index N"
     * without doing an O(n) scan through the loaded messages data.
     */
    // TODO: Document this format. I'll be honest, it's been a while since I wrote this
    // code and I forget the exact format. This file could also use tests too. It's
    // something like a range of loaded (or unloaded) messages is represented by a pair
    // of `Lower`/`Upper` values. One at the start of the loaded (or unloaded) message
    // range and one at the end.
    private readonly _unloadedMessages: Tree<number, "Upper" | "Lower">;

    /**
     * Optimistic messages are messages that haven't been created on the server yet but
     * we're rendering as a part of the message list on the client so the UI for
     * sending messages feels instant.
     *
     * These messages are rendered at the end of the message list and haven't been
     * given `index`s yet. Since only the server can decide the final `index` for a new
     * message.
     *
     * If the user sends a message and before it's been saved on the server, the client
     * receives a `NewMessage` event from another user then that message will be
     * rendered _above_ our optimistic message since once the server finishes saving
     * our new message it'll end up with a later `index` anyway.
     */
    private readonly _optimisticMessages: ReadonlyArray<OptimisticMessageModel>;

    /**
     * Tracks state for typing indicators. When a user starts typing an entry is added
     * to this map. When they stop typing the same entry is removed from this map.
     */
    private readonly _typingStateByConnectionId: ImmutableMap<
        WebSocketConnectionId,
        MessagingTypingState
    >;

    /**
     * This is a mutable piece of state inside our otherwise immutable data type. A
     * functional programming sin! However, we do it since it's practical.
     *
     * The `ServerSynchronizationCheckpoint` tells us how up-to-date our client's
     * realtime data is based on what's on the server. When we backfill realtime events
     * we send our checkpoint to the server and the server will return all realtime
     * events that happened between the checkpoint and now. So for example if our
     * WebSocket disconnects for two minutes because the user lost internet, when the
     * WebSocket reconnects we'll send the last checkpoint we had from the server
     * (which is the time two minutes ago) and receive all realtime events we missed
     * while we were disconnected.
     *
     * The `ServerSynchronizationCheckpoint` is set:
     *
     * 1. When we initially load data.
     *
     * 2. Every `Ping`/`Pong` message from our WebSocket server. Since while we're
     *    connected to the WebSocket server we know we're seeing all realtime events.
     *    As soon as the WebSocket disconnects (and we stop receiving `Pong` messages)
     *    our client data may be falling out-of-date with the server since there's
     *    realtime events we're not seeing.
     *
     * We ping the WebSocket server every minute. If this were an immutable property on
     * the list we'd end up re-rendering the entire view depending on this list once
     * per minute. Which feels inefficient. Especially if the user is actively
     * interacting with the view and we block some other update.
     *
     * Instead, we update a mutable property on the data type. This makes the data type
     * "impure" in a functional programming sense but it's fine, we're not caching and
     * reusing these objects. Making this a mutable property may be a premature
     * optimization but mutability just doesn't seem like a big deal here.
     */
    private _mutableCheckpoint: ServerSynchronizationCheckpoint | null;

    private constructor({
        messageCountExcludingOptimisticMessages,
        messages,
        unloadedMessages,
        optimisticMessages,
        typingStateByConnectionId,
        mutableCheckpoint,
    }: {
        messageCountExcludingOptimisticMessages: number;
        messages: Tree<number, Message>;
        unloadedMessages: Tree<number, "Upper" | "Lower">;
        optimisticMessages: ReadonlyArray<OptimisticMessageModel>;
        typingStateByConnectionId: ImmutableMap<WebSocketConnectionId, MessagingTypingState>;
        mutableCheckpoint: ServerSynchronizationCheckpoint | null;
    }) {
        // Make sure the checkpoint is set before we start loading messages into our
        // `MessageList`. If we don't have a checkpoint then we can't backfill realtime
        // events! If we can't backfill realtime events then we don't have a successful
        // realtime connection.
        //
        // We allow the `MessageList` to have a null checkpoint to support specifically
        // `<PostListView>` with collapsed post comments. When a post's comments are opened
        // we start loading the initial comments, if the initial comments don't return
        // after ~100ms then we open the post's comments anyway to show loading shimmers.
        // So we need a `MessageList` in this case for when we haven't finished loading
        // post comments yet.
        if (mutableCheckpoint === null) {
            assert(
                messages.length === 0,
                "If `checkpoint` is null then there should be no loaded messages in the `MessageList`",
            );
        }

        if (process.env.NODE_ENV !== "production") {
            assert(
                !messages.begin.node || messages.begin.node.key >= 0,
                "Out of bounds message in message list",
            );
            assert(
                !messages.end.node ||
                    messages.end.node.key < messageCountExcludingOptimisticMessages,
                "Out of bounds message in message list",
            );

            const iterator = unloadedMessages.begin;
            while (iterator.valid) {
                const lowerIteratorKey = iterator.key!;
                const lowerIteratorValue = iterator.value!;

                iterator.next();

                assert(
                    iterator.valid,
                    "Expected an even number of entries in `unloadedMessages` tree",
                );

                const upperIteratorKey = iterator.key!;
                const upperIteratorValue = iterator.value!;

                assert(
                    lowerIteratorValue === "Lower",
                    "First entry of a pair in `unloadedMessages` tree must have the value `Lower`",
                );

                assert(
                    upperIteratorValue === "Upper",
                    "Second entry of a pair in `unloadedMessages` tree must have the value `Upper`",
                );

                assert(
                    messages.get(lowerIteratorKey) !== undefined,
                    "First entry of a pair in `unloadedMessages` must point to a loaded message",
                );
                assert(
                    (upperIteratorKey - 1 === lowerIteratorKey ||
                        messages.get(upperIteratorKey - 1) !== undefined) &&
                        messages.get(upperIteratorKey) === undefined,
                    "Second entry of a pair in `unloadedMessages` must point to a loaded message followed by an unloaded message",
                );

                iterator.next();
            }
        }

        this._messageCountExcludingOptimisticMessages = messageCountExcludingOptimisticMessages;
        this._messages = messages;
        this._unloadedMessages = unloadedMessages;
        this._optimisticMessages = optimisticMessages;
        this._typingStateByConnectionId = typingStateByConnectionId;
        this._mutableCheckpoint = mutableCheckpoint;
    }

    public static new<Message extends MessageModel>({
        checkpoint,
        messageCount,
        typingStateByConnectionId,
    }: {
        // Will throw if this is null and you try to call `loadMessages()`! `checkpoint`
        // can only be null while all messages are unloaded.
        checkpoint: ServerSynchronizationCheckpoint | null;
        messageCount: number;
        typingStateByConnectionId?: ReadonlyMap<WebSocketConnectionId, MessagingTypingState>;
    }): MessageList<Message> {
        return new MessageList({
            messageCountExcludingOptimisticMessages: messageCount,
            messages: createTree(),
            unloadedMessages: createTree(),
            optimisticMessages: [],
            typingStateByConnectionId: typingStateByConnectionId
                ? ImmutableMap.from(typingStateByConnectionId)
                : ImmutableMap.empty(),
            mutableCheckpoint: checkpoint,
        });
    }

    /**
     * Get the number of items in the list. Will mostly be messages but there may be
     * some visual only items.
     */
    public getItemCount(): number {
        return (
            this._messageCountExcludingOptimisticMessages +
            this._optimisticMessages.length +
            (this._typingStateByConnectionId.size > 0 ? 1 : 0)
        );
    }

    /**
     * Get the number of loaded messages in this list. This excludes optimistic
     * messages and any unloaded messages.
     */
    public getLoadedMessageCount(): number {
        return this._messages.length;
    }

    /**
     * Get the number of messages in this list including optimistic messages.
     */
    public getMessageCountIncludingOptimisticMessages(): number {
        return this._messageCountExcludingOptimisticMessages + this._optimisticMessages.length;
    }

    /**
     * Get the number of messages in the list excluding any optimistic messages.
     */
    public getMessageCountExcludingOptimisticMessages(): number {
        return this._messageCountExcludingOptimisticMessages;
    }

    /**
     * If this message list will return a typing indicators item then this returns
     * true.
     */
    public hasTypingIndicatorsItem() {
        return this._typingStateByConnectionId.size > 0;
    }

    /**
     * Transform a range against our list's items to a range just against the list's
     * messages. Excludes any UI only items.
     */
    public getMessagesRange(range: {startIndex: number; endIndex: number} | null): {
        startIndex: number;
        endIndex: number;
    } | null {
        if (!range) return null;

        assert(0 <= range.startIndex && range.startIndex < this.getItemCount());
        assert(0 <= range.endIndex && range.endIndex < this.getItemCount());
        assert(range.startIndex <= range.endIndex);

        if (this._typingStateByConnectionId.size === 0) return range;

        // If our rendered range starts at the typing indicators item then there are no
        // messages in this range.
        if (range.startIndex >= this.getItemCount() - 1) return null;

        const startIndex = Math.min(range.startIndex, this.getItemCount() - 2);
        const endIndex = Math.min(range.endIndex, this.getItemCount() - 2);

        return {startIndex, endIndex};
    }

    /**
     * Get the message at the provided index. If we haven't loaded the message we'll
     * return `type: "Unloaded"`. Throws if the index is out of bounds.
     */
    public getItem(index: number): MessageListItem<Message> {
        if (!Number.isSafeInteger(index))
            throw new InvalidArgumentError("Message index is not an integer");
        if (index < 0 || index >= this.getItemCount())
            throw new OutOfRangeError("Message index out of bounds");

        if (
            this._typingStateByConnectionId.size > 0 &&
            index ===
                this._messageCountExcludingOptimisticMessages + this._optimisticMessages.length
        ) {
            return {
                type: "TypingIndicators",
                typingStateByConnectionId: this._typingStateByConnectionId,
            };
        }

        if (index >= this._messageCountExcludingOptimisticMessages) {
            const optimisticMessageIndex = index - this._messageCountExcludingOptimisticMessages;
            const message = this._optimisticMessages[optimisticMessageIndex]!;
            return {type: "Optimistic", message, messageIndex: index, optimisticMessageIndex};
        }

        const message = this._messages.get(index);
        return message
            ? {type: "Loaded", message, messageIndex: index}
            : {type: "Unloaded", messageIndex: index};
    }

    /**
     * Get the message at the provided index but only if it is loaded. Otherwise we
     * return null. Throws if the index is out of bounds.
     */
    public getLoadedMessageIfExists(index: number): Message | null {
        const message = this.getItem(index);
        if (message.type !== "Loaded") return null;
        return message.message;
    }

    /**
     * Get the last loaded message in our message list.
     */
    public getLastLoadedMessageIfExists(): Message | null {
        const iterator = this._messages.end;
        if (!iterator.value) return null;
        return iterator.value;
    }

    /**
     * Get the first loaded message after the provided index. If there is no loaded
     * message after the provided index we return null. Throws an error if the index is
     * out of bounds.
     *
     * - If the index is loaded and the next index is loaded then return the next
     *   message.
     * - If the index is loaded and the next index is unloaded then return the first
     *   loaded message after the unloaded segment (or null if there is none).
     * - If the index is unloaded then return the first loaded message after the
     *   unloaded segment (or null if there is none).
     *
     * Excludes optimistic messages. If `index` is for an optimistic message you will
     * get `null` since there are no loaded messages after an optimistic message.
     */
    public getFirstLoadedMessageAfterIfExists(index: number): Message | null {
        const iterator = this._messages.gt(index);
        if (!iterator.value) return null;
        assert(iterator.value.index !== index);
        return iterator.value;
    }

    /**
     * Get the last loaded message before the provided index. If there is no loaded
     * message before the provided index we return null. Throws an error if the index
     * is out of bounds.
     *
     * - If the index is loaded and the previous index is loaded then return the
     *   previous message.
     * - If the index is loaded and the previous index is unloaded then return the last
     *   loaded message before the unloaded segment (or null if there is none).
     * - If the index is unloaded then return the last loaded message before the
     *   unloaded segment (or null if there is none).
     *
     * Excludes optimistic messages.
     */
    public getLastLoadedMessageBeforeIfExists(index: number): Message | null {
        const iterator = this._messages.lt(index);
        if (!iterator.value) return null;
        assert(iterator.value.index !== index);
        return iterator.value;
    }

    /**
     * Get the first unloaded index after the provided index. If there is no unloaded
     * message after the provided index we return null.
     *
     * - If the index is unloaded and the next index is unloaded then return the next
     *   index.
     * - If the index is unloaded and the next index is loaded then return the first
     *   unloaded message after the loaded segment (or null if we have loaded messages
     *   until the end of the list).
     * - If the index is loaded then return the first unloaded index after the loaded
     *   segment (or null if we have loaded messages until the end of the list).
     */
    public getFirstUnloadedMessageIndexAfterIfExists(index: number): number | null {
        const iterator = this._unloadedMessages.ge(index);
        if (!iterator.valid) {
            const nextIndex = index + 1;
            return nextIndex < this._messageCountExcludingOptimisticMessages ? nextIndex : null;
        }

        const iteratorKey = iterator.key!;
        const iteratorValue = iterator.value!;

        switch (iteratorValue) {
            case "Upper": {
                return iteratorKey < this._messageCountExcludingOptimisticMessages
                    ? iteratorKey
                    : null;
            }
            case "Lower": {
                iterator.next();
                assert(iterator.valid);
                const nextIteratorKey = iterator.key!;

                return nextIteratorKey < this._messageCountExcludingOptimisticMessages
                    ? nextIteratorKey
                    : null;
            }
            default:
                throw exhaustive(iteratorValue);
        }
    }

    /**
     * Get the last unloaded index before the provided index. If there is no unloaded
     * index before the provided index we return null.
     *
     * - If the index is unloaded and the previous index is unloaded then return the
     *   previous index.
     * - If the index is unloaded and the previous index is loaded then return the last
     *   unloaded index before the loaded segment (or null if all messages to the
     *   beginning of the list are loaded).
     * - If the index is loaded then return the last unloaded index before the loaded
     *   segment (or null if all messages to the beginning of the list are loaded).
     */
    public getLastUnloadedMessageIndexBeforeIfExists(index: number): number | null {
        const iterator = this._unloadedMessages.lt(index);
        if (!iterator.valid) {
            const previousIndex = index - 1;
            return previousIndex >= 0 ? previousIndex : null;
        }

        const iteratorKey = iterator.key!;
        const iteratorValue = iterator.value!;

        switch (iteratorValue) {
            case "Lower": {
                return iteratorKey - 1 >= 0 ? iteratorKey - 1 : null;
            }
            case "Upper": {
                const previousIndex = index - 1;
                return previousIndex >= 0 ? previousIndex : null;
            }
            default:
                throw exhaustive(iteratorValue);
        }
    }

    /**
     * Iterate loaded messages in the list. Optionally starting with the provided
     * index.
     */
    public *iterateMessages(
        startIndex: number = 0,
    ): IterableIterator<MessageListLoadedItem<Message> | MessageListOptimisticItem> {
        const iterator = this._messages.ge(startIndex);

        while (iterator.valid) {
            yield {type: "Loaded", message: iterator.value!, messageIndex: iterator.key!};
            iterator.next();
        }

        for (const [optimisticMessageIndex, message] of this._optimisticMessages
            .slice(Math.max(0, startIndex - this._messages.length))
            .entries()) {
            yield {
                type: "Optimistic",
                message,
                messageIndex:
                    this._messageCountExcludingOptimisticMessages + optimisticMessageIndex,
                optimisticMessageIndex,
            };
        }
    }

    /**
     * Iterate loaded messages in the list starting from the last loaded message.
     */
    public *iterateLoadedMessagesFromEnd(): IterableIterator<Message> {
        const iterator = this._messages.end;

        while (iterator.valid) {
            yield iterator.value!;
            iterator.prev();
        }
    }

    /**
     * Increase message count for this list. If the message count is less than the
     * current message count we won't change anything.
     *
     * Excludes message count from optimistic messages.
     */
    private _setMessageCountExcludingOptimisticMessages(
        messageCount: number,
    ): MessageList<Message> {
        assert(Number.isSafeInteger(messageCount), "Message count is not an integer");
        assert(messageCount >= 0, "Message count should be positive");

        // If we have messages at a higher index then the message count won't change.
        messageCount = Math.max(messageCount, this._messageCountExcludingOptimisticMessages);

        if (messageCount === this._messageCountExcludingOptimisticMessages) return this;

        return new MessageList({
            messageCountExcludingOptimisticMessages: messageCount,
            messages: this._messages,
            unloadedMessages: this._unloadedMessages,
            optimisticMessages: this._optimisticMessages,
            typingStateByConnectionId: this._typingStateByConnectionId,
            mutableCheckpoint: this._mutableCheckpoint,
        });
    }

    /**
     * Sets messages in the list at their index. If the message index is greater than
     * our message count then we will extend the message count. If the message with the
     * same index already exists then it will be replaced.
     */
    private _setMessages(newMessages: ReadonlyArray<Message>): MessageList<Message> {
        if (newMessages.length === 0) return this;

        let messageCount = this._messageCountExcludingOptimisticMessages;
        let messages = this._messages;
        let unloadedMessages = this._unloadedMessages;
        let optimisticMessages = this._optimisticMessages;

        const loadedMessageRanges: Array<{startIndex: number; endIndex: number}> = [];

        for (const message of newMessages) {
            const iterator = messages.find(message.index);

            if (iterator.value && iterator.value.version >= message.version) {
                // Only override the existing message if it has a later version. Otherwise keep the
                // current message in the map.
                continue;
            } else {
                messages = iterator.node
                    ? iterator.update(message)
                    : messages.insert(message.index, message);
            }

            messageCount = Math.max(messageCount, message.index + 1);

            // If we have an equivalent optimistic message, remove it from the list now that we
            // have the real loaded message in the correct position.
            const optimisticMessage = optimisticMessages.find(
                optimisticMessage =>
                    optimisticMessage.author.id === message.author.id &&
                    areMessagePayloadModelsEqual(optimisticMessage.payload, message.payload),
            );
            if (optimisticMessage)
                optimisticMessages = optimisticMessages.filter(
                    otherOptimisticMessage => otherOptimisticMessage !== optimisticMessage,
                );

            // Keep track of newly loaded message ranges.
            let hasAddedLoadedMessageRange = false;
            for (const loadedMessageRange of loadedMessageRanges) {
                if (
                    loadedMessageRange.startIndex <= message.index &&
                    message.index <= loadedMessageRange.endIndex
                ) {
                    hasAddedLoadedMessageRange = true;
                    break;
                }

                if (
                    loadedMessageRange.startIndex - 1 <= message.index &&
                    message.index <= loadedMessageRange.endIndex
                ) {
                    loadedMessageRange.startIndex = Math.min(
                        message.index,
                        loadedMessageRange.startIndex,
                    );
                    hasAddedLoadedMessageRange = true;
                    break;
                }

                if (
                    loadedMessageRange.startIndex <= message.index &&
                    message.index <= loadedMessageRange.endIndex + 1
                ) {
                    loadedMessageRange.endIndex = Math.max(
                        message.index,
                        loadedMessageRange.endIndex,
                    );
                    hasAddedLoadedMessageRange = true;
                    break;
                }
            }
            if (!hasAddedLoadedMessageRange) {
                loadedMessageRanges.push({
                    startIndex: message.index,
                    endIndex: message.index,
                });
            }
        }

        // Update `unloadedMessages` based on our newly loaded message ranges. We want a
        // `Lower` entry before each loaded message segment and an `Upper` entry after each
        // loaded message segment. The tree must have alternating `Lower`/`Upper` entries
        // to be considered well formed.
        for (const loadedMessageRange of loadedMessageRanges) {
            // Clear out any boundaries within the range. Any unloaded messages within this
            // range are now loaded!
            while (true) {
                const iterator = unloadedMessages.gt(loadedMessageRange.startIndex);
                if (iterator.valid && iterator.key! < loadedMessageRange.endIndex + 1) {
                    unloadedMessages = iterator.remove();
                } else {
                    break;
                }
            }

            // Update the lower bound of the unloaded range. The lower bound is inclusive.
            {
                const iterator = unloadedMessages.le(loadedMessageRange.startIndex);
                if (!iterator.valid) {
                    unloadedMessages = unloadedMessages.insert(
                        loadedMessageRange.startIndex,
                        "Lower",
                    );
                } else {
                    const iteratorValue = iterator.value!;

                    switch (iteratorValue) {
                        case "Upper": {
                            if (iterator.key === loadedMessageRange.startIndex) {
                                unloadedMessages = iterator.remove();
                            } else {
                                unloadedMessages = unloadedMessages.insert(
                                    loadedMessageRange.startIndex,
                                    "Lower",
                                );
                            }
                            break;
                        }
                        case "Lower": {
                            // All good.
                            break;
                        }
                        default:
                            throw exhaustive(iteratorValue);
                    }
                }
            }

            // Update the upper bound of the unloaded range. The upper bound is exclusive.
            {
                const iterator = unloadedMessages.ge(loadedMessageRange.endIndex + 1);
                if (!iterator.valid) {
                    unloadedMessages = unloadedMessages.insert(
                        loadedMessageRange.endIndex + 1,
                        "Upper",
                    );
                } else {
                    const iteratorValue = iterator.value!;

                    switch (iteratorValue) {
                        case "Lower": {
                            if (iterator.key === loadedMessageRange.endIndex + 1) {
                                unloadedMessages = iterator.remove();
                            } else {
                                unloadedMessages = unloadedMessages.insert(
                                    loadedMessageRange.endIndex + 1,
                                    "Upper",
                                );
                            }
                            break;
                        }
                        case "Upper": {
                            // All good.
                            break;
                        }
                        default:
                            throw exhaustive(iteratorValue);
                    }
                }
            }
        }

        return new MessageList({
            messageCountExcludingOptimisticMessages: messageCount,
            messages,
            unloadedMessages,
            optimisticMessages,
            typingStateByConnectionId: this._typingStateByConnectionId,
            mutableCheckpoint: this._mutableCheckpoint,
        });
    }

    /**
     * Load messages from a server message query endpoint into our message list.
     * Message query endpoints are expected to:
     *
     * - Return the count of all messages in the list
     * - Return a list of consecutive loaded messages
     * - Return a list of messages referenced by the main `messages` list
     */
    public loadMessages({
        messageCount,
        messages,
        otherReferencedMessages,
        updatedMessages,
    }: {
        messageCount: number;
        messages: ReadonlyArray<Message>;
        otherReferencedMessages: ReadonlyArray<Message>;
        updatedMessages?: ReadonlyArray<Message>;
    }): MessageList<Message> {
        let self = this._setMessageCountExcludingOptimisticMessages(messageCount);

        self = self._setMessages(messages);
        self = self._setMessages(otherReferencedMessages);

        if (updatedMessages) {
            self = self._setMessages(updatedMessages);
        }

        return self;
    }

    /**
     * Backfills missing messages and message changes into the list. We call this after
     * a `BackfillMessagesResponse` realtime event. The `BackfillMessagesRequest`
     * realtime event should use `getMessageCountExcludingOptimisticMessages()` and
     * `getLastMessageChangeTime()` from this list.
     */
    public backfillMessages({
        messageCount,
        newMessages,
        newOtherReferencedMessages,
        updatedMessages,
        typingStateByConnectionId,
    }: {
        messageCount: number;
        newMessages: ReadonlyArray<Message>;
        newOtherReferencedMessages: ReadonlyArray<Message>;
        updatedMessages: ReadonlyArray<Message>;
        typingStateByConnectionId: ReadonlyMap<WebSocketConnectionId, MessagingTypingState>;
    }) {
        let self = this.loadMessages({
            messageCount,
            messages: newMessages,
            otherReferencedMessages: newOtherReferencedMessages,
            updatedMessages,
        });

        self = self._setTypingStateByConnectionId(typingStateByConnectionId);

        return self;
    }

    /**
     * Adds a message in the list at its index. If the message index is greater than
     * our message count then we will extend the message count. If the message with the
     * same index already exists then it will be replaced.
     */
    public setMessage(message: Message): MessageList<Message> {
        return this._setMessages([message]);
    }

    /**
     * Updates a message with the provided index if the message exists and is loaded.
     * Does nothing if the message doesn't exist or isn't loaded.
     *
     * Won't actually update the message unless the new message's version is greater
     * than the old message's version.
     */
    public updateMessage(
        messageIndex: number,
        update: (message: Message) => Message,
    ): MessageList<Message> {
        const oldMessage = this.getLoadedMessageIfExists(messageIndex);
        if (!oldMessage) return this;

        const newMessage = update(oldMessage);
        if (oldMessage === newMessage) return this;

        return this.setMessage(newMessage);
    }

    /**
     * Adds an optimistic message to the message list.
     *
     * The optimistic message will be cleared when a new message is added that's equal.
     */
    public addOptimisticMessage(message: OptimisticMessageModel): MessageList<Message> {
        return new MessageList({
            messageCountExcludingOptimisticMessages: this._messageCountExcludingOptimisticMessages,
            unloadedMessages: this._unloadedMessages,
            messages: this._messages,
            optimisticMessages: [...this._optimisticMessages, message],
            typingStateByConnectionId: this._typingStateByConnectionId,
            mutableCheckpoint: this._mutableCheckpoint,
        });
    }

    /**
     * Updates the optimistic message with the specified id. If no optimistic message
     * with the provided id exists then this function does nothing.
     */
    public updateOptimisticMessage(
        optimisticId: Id,
        update: (message: OptimisticMessageModel) => OptimisticMessageModel,
    ) {
        return new MessageList({
            messageCountExcludingOptimisticMessages: this._messageCountExcludingOptimisticMessages,
            messages: this._messages,
            unloadedMessages: this._unloadedMessages,
            optimisticMessages: this._optimisticMessages.map(optimisticMessage =>
                optimisticMessage.optimisticId === optimisticId
                    ? update(optimisticMessage)
                    : optimisticMessage,
            ),
            typingStateByConnectionId: this._typingStateByConnectionId,
            mutableCheckpoint: this._mutableCheckpoint,
        });
    }

    /**
     * Has the checkpoint been initialized?
     *
     * Whether or not the checkpoint has been initialized is an immutable fact. So if
     * you depend on this your effect/component will re-run when the checkpoint is
     * initialized.
     */
    public isCheckpointInitialized(): boolean {
        return this._mutableCheckpoint !== null;
    }

    /**
     * Initialize the `MessageList`'s checkpoint if it hasn't already been initialized.
     *
     * This is an immutable update to trigger a re-render. So any effects that were
     * waiting on the checkpoint can now run.
     */
    public initializeCheckpointIfNeeded(
        checkpoint: ServerSynchronizationCheckpoint,
    ): MessageList<Message> {
        // Checkpoint is already initialized.
        if (this._mutableCheckpoint !== null) return this;

        return new MessageList({
            messageCountExcludingOptimisticMessages: this._messageCountExcludingOptimisticMessages,
            messages: this._messages,
            unloadedMessages: this._unloadedMessages,
            optimisticMessages: this._optimisticMessages,
            typingStateByConnectionId: this._typingStateByConnectionId,
            mutableCheckpoint: checkpoint,
        });
    }

    /**
     * Get the current mutable checkpoint property.
     *
     * Throws if `isCheckpointInitialized()` is false.
     */
    public getMutableCheckpoint(): ServerSynchronizationCheckpoint {
        assert(
            this._mutableCheckpoint !== null,
            "`checkpoint` hasn\u2019t been initialized in `MessageList`",
        );

        return this._mutableCheckpoint;
    }

    /**
     * Set the mutable checkpoint property on this query object. Noops if the provided
     * `checkpoint` is older than the current checkpoint.
     *
     * Throws if `isCheckpointInitialized()` is false.
     */
    public setMutableCheckpoint(checkpoint: ServerSynchronizationCheckpoint): void {
        assert(
            this._mutableCheckpoint !== null,
            "`checkpoint` hasn\u2019t been initialized in `MessageList`",
        );

        this._mutableCheckpoint =
            this._mutableCheckpoint.getTime() < checkpoint.getTime()
                ? checkpoint
                : this._mutableCheckpoint;
    }

    /**
     * Set the entire typing state by connection map to the provided value. Used when
     * backfilling when we get new states.
     */
    private _setTypingStateByConnectionId(
        typingStateByConnectionId: Iterable<[WebSocketConnectionId, MessagingTypingState]>,
    ) {
        const newTypingStateByConnectionId = ImmutableMap.from(typingStateByConnectionId);

        // If there are no typing states before and after this update we don't need a new
        // message list.
        if (this._typingStateByConnectionId.size === 0 && newTypingStateByConnectionId.size === 0)
            return this;

        return new MessageList({
            messageCountExcludingOptimisticMessages: this._messageCountExcludingOptimisticMessages,
            messages: this._messages,
            unloadedMessages: this._unloadedMessages,
            optimisticMessages: this._optimisticMessages,
            typingStateByConnectionId: newTypingStateByConnectionId,
            mutableCheckpoint: this._mutableCheckpoint,
        });
    }

    /**
     * Update the typing state of an individual connection.
     */
    public updateTypingState(
        connectionId: WebSocketConnectionId,
        typingState: MessagingTypingState | null,
    ) {
        return new MessageList({
            messageCountExcludingOptimisticMessages: this._messageCountExcludingOptimisticMessages,
            messages: this._messages,
            unloadedMessages: this._unloadedMessages,
            optimisticMessages: this._optimisticMessages,
            typingStateByConnectionId: typingState
                ? this._typingStateByConnectionId.set(connectionId, typingState)
                : this._typingStateByConnectionId.delete(connectionId),
            mutableCheckpoint: this._mutableCheckpoint,
        });
    }

    public putMessageStreamPart(event: {
        index: number;
        partIndex: number;
        part: {
            version: number;
            payload: MessageStreamPartPayload;
            createdTime: Date;
        };
        completedTime: Date | null;
        references: ContentReferences;
    }) {
        const iterator = this._messages.find(event.index);
        if (!iterator.value) return this;

        // TODO(calebmer, #ai-realtime-hacks): What if we receive a `PutMessageStreamPart`
        // event before a `NewMessage` event? I don't think there's anything in
        // `MessagingRealtimeConnection` that stops this from happening right now.
        const message = iterator.value;
        if (message.payload.type !== "Content") return this;
        if (!message.stream) return this;

        // We already have a part at this index greater than the part we're receiving.
        if (
            event.partIndex < message.stream.parts.length &&
            event.part.version <= message.stream.parts[event.partIndex]!.version
        ) {
            return this;
        }

        const newParts = [...message.stream.parts];

        if (event.partIndex < newParts.length) {
            newParts[event.partIndex] = event.part;
        } else {
            // For when we receive parts out of order. Put a placeholder part to make sure
            // we're inserting the new part at the correct index.
            //
            // TODO(calebmer, #ai-realtime-hacks): This is a bad UX. A better UX would be to
            // have a list of "pending parts" and wait to add those parts until we receive all
            // preceding parts. But I'm moving fast today so not implementing this.
            //
            // TODO(calebmer, #ai-realtime-hacks): Relatedly, we continue applying part updates
            // even after the stream is completed. That's also not a great UX if we're showing
            // a loading spinner while the stream hasn't completed. Ideally the completion
            // event would go into a "pending" list as well if we're waiting on a part update.
            for (let i = newParts.length; i < event.partIndex; i++) {
                newParts.push({
                    version: -1,
                    payload: {type: "Content", content: createSimpleMessageContent()},
                    createdTime: event.part.createdTime,
                });
            }

            assert(newParts.length === event.partIndex);
            newParts.push(event.part);
        }

        const newStream: MessageStream = {
            ...message.stream,
            parts: newParts,
            completedTime: message.stream.completedTime ?? event.completedTime,
        };

        // Merge in the new references for the stream part. All stream parts in a single
        // message share the same references object.
        const newReferences = mergeContentReferences(
            message.payload.content.references,
            event.references,
        );

        const messages =
            // Optimization: Don't update the `payload` object if references didn't change.
            newReferences === message.payload.content.references
                ? iterator.update(message.clone({stream: newStream}))
                : iterator.update(
                      message.clone({
                          payload: {
                              ...message.payload,
                              content: {...message.payload.content, references: newReferences},
                          },
                          stream: newStream,
                      }),
                  );

        return new MessageList({
            messageCountExcludingOptimisticMessages: this._messageCountExcludingOptimisticMessages,
            messages,
            unloadedMessages: this._unloadedMessages,
            optimisticMessages: this._optimisticMessages,
            typingStateByConnectionId: this._typingStateByConnectionId,
            mutableCheckpoint: this._mutableCheckpoint,
        });
    }

    public completeMessageStream(event: {index: number; completedTime: Date}) {
        const iterator = this._messages.find(event.index);
        if (!iterator.value) return this;

        const message = iterator.value;
        if (!message.stream) return this;

        // Already completed! Don't complete again.
        if (message.stream.completedTime) return this;

        const newStream: MessageStream = {
            ...message.stream,
            completedTime: event.completedTime,
        };

        const messages = iterator.update(message.clone({stream: newStream}));

        return new MessageList({
            messageCountExcludingOptimisticMessages: this._messageCountExcludingOptimisticMessages,
            messages,
            unloadedMessages: this._unloadedMessages,
            optimisticMessages: this._optimisticMessages,
            typingStateByConnectionId: this._typingStateByConnectionId,
            mutableCheckpoint: this._mutableCheckpoint,
        });
    }
}
