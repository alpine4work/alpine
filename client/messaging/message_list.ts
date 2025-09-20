import createTree, {Tree} from "functional-red-black-tree";
import {ContentReferences, mergeContentReferences} from "~/shared/content/content_references.js";
import {InvalidArgumentError, OutOfRangeError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {Id} from "~/shared/id/id.js";
import {WebSocketConnectionId} from "~/shared/id/types/id_types.js";
import {MessageChange, getMessageChangeTime} from "~/shared/messaging/message_change_schema.js";
import {createSimpleMessageContent} from "~/shared/messaging/message_content_schema.js";
import {
    MessageModel,
    OptimisticMessageModel,
    areMessagePayloadModelsEqual,
    getLastChangedMessage,
} from "~/shared/messaging/message_model.js";
import {MessageStream, MessageStreamPartPayload} from "~/shared/messaging/message_schema.js";
import {MessagingTypingState} from "~/shared/messaging/messaging_realtime_protocol.js";

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
     * messages, this will be 1 because it is index 1 in the optimistic messages
     * array.
     */
    readonly optimisticMessageIndex: number;
};

export type MessageListTypingIndicatorsItem = {
    readonly type: "TypingIndicators";
    readonly typingStateByConnectionId: ImmutableMap<WebSocketConnectionId, MessagingTypingState>;
    readonly message?: undefined;
};

/**
 * Immutable state for keeping track of a list of messages. The message list
 * may be partially loaded at any time with gaps between messages.
 */
export class MessageList<Message extends MessageModel> {
    private readonly _messageCountExcludingOptimisticMessages: number;
    private readonly _messages: Tree<number, Message>;
    private readonly _unloadedMessages: Tree<number, "Upper" | "Lower">;
    private readonly _optimisticMessages: ReadonlyArray<OptimisticMessageModel>;
    private readonly _lastMessageChangeTime: Date | null;
    private readonly _unloadedMessageChangeByIndex: ImmutableMap<number, MessageChange>;
    private readonly _typingStateByConnectionId: ImmutableMap<
        WebSocketConnectionId,
        MessagingTypingState
    >;

    private constructor({
        messageCountExcludingOptimisticMessages,
        messages,
        unloadedMessages,
        optimisticMessages,
        lastMessageChangeTime,
        unloadedMessageChangeByIndex,
        typingStateByConnectionId,
    }: {
        messageCountExcludingOptimisticMessages: number;
        messages: Tree<number, Message>;
        unloadedMessages: Tree<number, "Upper" | "Lower">;
        optimisticMessages: ReadonlyArray<OptimisticMessageModel>;
        lastMessageChangeTime: Date | null;
        unloadedMessageChangeByIndex: ImmutableMap<number, MessageChange>;
        typingStateByConnectionId: ImmutableMap<WebSocketConnectionId, MessagingTypingState>;
    }) {
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
        this._lastMessageChangeTime = lastMessageChangeTime;
        this._unloadedMessageChangeByIndex = unloadedMessageChangeByIndex;
        this._typingStateByConnectionId = typingStateByConnectionId;
    }

    public static new<Message extends MessageModel>({
        messageCount,
        lastMessageChangeTime,
        typingStateByConnectionId,
    }: {
        messageCount: number;
        lastMessageChangeTime: Date | null;
        typingStateByConnectionId?: ReadonlyMap<WebSocketConnectionId, MessagingTypingState>;
    }): MessageList<Message> {
        return new MessageList({
            messageCountExcludingOptimisticMessages: messageCount,
            messages: createTree(),
            unloadedMessages: createTree(),
            optimisticMessages: [],
            lastMessageChangeTime,
            unloadedMessageChangeByIndex: ImmutableMap.empty(),
            typingStateByConnectionId: typingStateByConnectionId
                ? ImmutableMap.from(typingStateByConnectionId)
                : ImmutableMap.empty(),
        });
    }

    /**
     * Get the number of items in the list. Will mostly be messages but there may
     * be some visual only items.
     */
    public getItemCount(): number {
        return (
            this._messageCountExcludingOptimisticMessages +
            this._optimisticMessages.length +
            (this._typingStateByConnectionId.size > 0 ? 1 : 0)
        );
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
     * Get the last message change time our list knows about. We will use this to
     * backfill changes the list doesn't know about.
     */
    public getLastMessageChangeTime(): Date | null {
        return this._lastMessageChangeTime;
    }

    /**
     * Transform a range against our list's items to a range just against the
     * list's messages. Excludes any UI only items.
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
     * Get the message at the provided index. If we haven't loaded the message
     * we'll return `type: "Unloaded"`. Throws if the index is out of bounds.
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
     * Get the first loaded message after the provided index. If there is no loaded
     * message after the provided index we return null. Throws an error if the
     * index is out of bounds.
     *
     * - If the index is loaded and the next index is loaded then return the next
     *   message.
     * - If the index is loaded and the next index is unloaded then return the
     *   first loaded message after the unloaded segment (or null if there is none).
     * - If the index is unloaded then return the first loaded message after the
     *   unloaded segment (or null if there is none).
     *
     * Excludes optimistic messages. If `index` is for an optimistic message you
     * will get `null` since there are no loaded messages after an optimistic
     * message.
     */
    public getFirstLoadedMessageAfterIfExists(index: number): Message | null {
        const iterator = this._messages.gt(index);
        if (!iterator.value) return null;
        assert(iterator.value.index !== index);
        return iterator.value;
    }

    /**
     * Get the last loaded message before the provided index. If there is no loaded
     * message before the provided index we return null. Throws an error if the
     * index is out of bounds.
     *
     * - If the index is loaded and the previous index is loaded then return the
     *   previous message.
     * - If the index is loaded and the previous index is unloaded then return the
     *   last loaded message before the unloaded segment (or null if there is none).
     * - If the index is unloaded then return the last loaded message before
     *   the unloaded segment (or null if there is none).
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
     * Get the first unloaded index after the provided index. If there is no
     * unloaded message after the provided index we return null.
     *
     * - If the index is unloaded and the next index is unloaded then return the
     *   next index.
     * - If the index is unloaded and the next index is loaded then return the
     *   first unloaded message after the loaded segment (or null if we have loaded
     *   messages until the end of the list).
     * - If the index is loaded then return the first unloaded index after the
     *   loaded segment (or null if we have loaded messages until the end of the
     *   list).
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
     * Get the last unloaded index before the provided index. If there is no
     * unloaded index before the provided index we return null.
     *
     * - If the index is unloaded and the previous index is unloaded then return
     *   the previous index.
     * - If the index is unloaded and the previous index is loaded then return the
     *   last unloaded index before the loaded segment (or null if all messages to
     *   the beginning of the list are loaded).
     * - If the index is loaded then return the last unloaded index before
     *   the loaded segment (or null if all messages to the beginning of the list
     *   are loaded).
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
     * Iterate loaded messages in the list. Optionally starting with the
     * provided index.
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
            lastMessageChangeTime: this._lastMessageChangeTime,
            unloadedMessageChangeByIndex: this._unloadedMessageChangeByIndex,
            typingStateByConnectionId: this._typingStateByConnectionId,
        });
    }

    /**
     * Increase last message change time for this list. If the last change time is
     * less than the current last change time we won't change anything.
     */
    private _setLastMessageChangeTime(lastMessageChangeTime: Date | null): MessageList<Message> {
        if (
            !(
                (!lastMessageChangeTime && this._lastMessageChangeTime) ||
                !this._lastMessageChangeTime ||
                (lastMessageChangeTime && this._lastMessageChangeTime < lastMessageChangeTime)
            )
        ) {
            return this;
        }

        return new MessageList({
            messageCountExcludingOptimisticMessages: this._messageCountExcludingOptimisticMessages,
            messages: this._messages,
            unloadedMessages: this._unloadedMessages,
            optimisticMessages: this._optimisticMessages,
            lastMessageChangeTime,
            unloadedMessageChangeByIndex: this._unloadedMessageChangeByIndex,
            typingStateByConnectionId: this._typingStateByConnectionId,
        });
    }

    /**
     * Sets messages in the list at their index. If the message index is greater
     * than our message count then we will extend the message count. If the message
     * with the same index already exists then it will be replaced.
     */
    private _setMessages(newMessages: ReadonlyArray<Message>): MessageList<Message> {
        if (newMessages.length === 0) return this;

        let messageCount = this._messageCountExcludingOptimisticMessages;
        let messages = this._messages;
        let unloadedMessages = this._unloadedMessages;
        let optimisticMessages = this._optimisticMessages;
        let unloadedMessageChangeByIndex = this._unloadedMessageChangeByIndex;

        const loadedMessageRanges: Array<{startIndex: number; endIndex: number}> = [];

        for (let message of newMessages) {
            let change: MessageChange | undefined;
            [change, unloadedMessageChangeByIndex] = unloadedMessageChangeByIndex.getAndDelete(
                message.index,
            );

            // If we are loading a message that was changed by realtime, apply the change
            // now before inserting it.
            if (change) message = changeMessage(message, change);

            const iterator = messages.find(message.index);

            // Only override the existing message if it has a later change time. Otherwise
            // keep the current message in the map.
            if (iterator.value) message = getLastChangedMessage(iterator.value, message);

            messages = iterator.node
                ? iterator.update(message)
                : messages.insert(message.index, message);

            messageCount = Math.max(messageCount, message.index + 1);

            // If we have an equivalent optimistic message, remove it from the list now
            // that we have the real loaded message in the correct position.
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

        // Update `unloadedMessages` based on our newly loaded message ranges. We want
        // a `Lower` entry before each loaded message segment and an `Upper` entry
        // after each loaded message segment. The tree must have alternating
        // `Lower`/`Upper` entries to be considered well formed.
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
            lastMessageChangeTime: this._lastMessageChangeTime,
            unloadedMessageChangeByIndex,
            typingStateByConnectionId: this._typingStateByConnectionId,
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
    }: {
        messageCount: number;
        messages: ReadonlyArray<Message>;
        otherReferencedMessages: ReadonlyArray<Message>;
    }): MessageList<Message> {
        return this._setMessageCountExcludingOptimisticMessages(messageCount)
            ._setMessages(messages)
            ._setMessages(otherReferencedMessages);
    }

    /**
     * Backfills missing messages and message changes into the list. We call this
     * after a `BackfillMessagesResponse` realtime event. The
     * `BackfillMessagesRequest` realtime event should use
     * `getMessageCountExcludingOptimisticMessages()` and
     * `getLastMessageChangeTime()` from this list.
     */
    public backfillMessages({
        messageCount,
        lastMessageChangeTime,
        newMessages,
        newOtherReferencedMessages,
        messageChanges,
        typingStateByConnectionId,
    }: {
        messageCount: number;
        lastMessageChangeTime: Date | null;
        newMessages: ReadonlyArray<Message>;
        newOtherReferencedMessages: ReadonlyArray<Message>;
        messageChanges: ReadonlyArray<MessageChange>;
        typingStateByConnectionId: ReadonlyMap<WebSocketConnectionId, MessagingTypingState>;
    }) {
        let self = this.loadMessages({
            messageCount,
            messages: newMessages,
            otherReferencedMessages: newOtherReferencedMessages,
        });

        self = self._setLastMessageChangeTime(lastMessageChangeTime);

        self = messageChanges.reduce(
            (messages, change) => messages.changeLoadedMessage(change),
            self,
        );

        self = self._setTypingStateByConnectionId(typingStateByConnectionId);

        return self;
    }

    /**
     * Adds a message in the list at its index. If the message index is greater
     * than our message count then we will extend the message count. If the message
     * with the same index already exists then it will be replaced.
     */
    public addMessage(message: Message): MessageList<Message> {
        return this._setMessages([message]);
    }

    /**
     * Adds an optimistic message to the message list.
     *
     * The optimistic message will be cleared when a new message is added
     * that's equal.
     */
    public addOptimisticMessage(message: OptimisticMessageModel): MessageList<Message> {
        return new MessageList({
            messageCountExcludingOptimisticMessages: this._messageCountExcludingOptimisticMessages,
            unloadedMessages: this._unloadedMessages,
            messages: this._messages,
            optimisticMessages: [...this._optimisticMessages, message],
            lastMessageChangeTime: this._lastMessageChangeTime,
            unloadedMessageChangeByIndex: this._unloadedMessageChangeByIndex,
            typingStateByConnectionId: this._typingStateByConnectionId,
        });
    }

    /**
     * Updates a message at the specified index in the list. If the message at that
     * index is not loaded or out of bounds then this function does nothing.
     *
     * Excludes optimistic messages. If the index is an optimistic message we will
     * ignore and do nothing.
     */
    public changeLoadedMessage(change: MessageChange): MessageList<Message> {
        const iterator = this._messages.find(change.index);

        // If we have not loaded the message at the changed index, then stash the
        // change in a map so that if we load the message in the future the change
        // can be applied.
        //
        // This supports the (rare) race condition where we get a change from realtime
        // that is not reflected in a `getMessagesFromEnd()` call soon to resolve after
        // because `getMessagesFromEnd()` is using eventual consistency.
        if (!iterator.value) {
            return new MessageList({
                messageCountExcludingOptimisticMessages:
                    this._messageCountExcludingOptimisticMessages,
                messages: this._messages,
                unloadedMessages: this._unloadedMessages,
                optimisticMessages: this._optimisticMessages,
                lastMessageChangeTime: this._lastMessageChangeTime,
                unloadedMessageChangeByIndex: this._unloadedMessageChangeByIndex.update(
                    change.index,
                    lastChange => {
                        if (!lastChange) return change;
                        return getMessageChangeTime(change) < getMessageChangeTime(lastChange)
                            ? lastChange
                            : change;
                    },
                ),
                typingStateByConnectionId: this._typingStateByConnectionId,
            });
        }

        const message = iterator.value;

        switch (change.type) {
            case "UpdateContent": {
                const newMessage = changeMessage(message, change);
                if (newMessage === message) return this;

                return new MessageList({
                    messageCountExcludingOptimisticMessages:
                        this._messageCountExcludingOptimisticMessages,
                    messages: iterator.update(newMessage),
                    unloadedMessages: this._unloadedMessages,
                    optimisticMessages: this._optimisticMessages,
                    lastMessageChangeTime:
                        !this._lastMessageChangeTime ||
                        change.contentUpdatedTime > this._lastMessageChangeTime
                            ? change.contentUpdatedTime
                            : this._lastMessageChangeTime,
                    unloadedMessageChangeByIndex: this._unloadedMessageChangeByIndex,
                    typingStateByConnectionId: this._typingStateByConnectionId,
                });
            }
            case "Delete": {
                const newMessage = changeMessage(message, change);
                if (newMessage === message) return this;

                return new MessageList({
                    messageCountExcludingOptimisticMessages:
                        this._messageCountExcludingOptimisticMessages,
                    messages: iterator.update(newMessage),
                    unloadedMessages: this._unloadedMessages,
                    optimisticMessages: this._optimisticMessages,
                    lastMessageChangeTime:
                        !this._lastMessageChangeTime ||
                        change.deletedTime > this._lastMessageChangeTime
                            ? change.deletedTime
                            : this._lastMessageChangeTime,
                    unloadedMessageChangeByIndex: this._unloadedMessageChangeByIndex,
                    typingStateByConnectionId: this._typingStateByConnectionId,
                });
            }
            default:
                throw exhaustive(change);
        }
    }

    /**
     * Updates the optimistic message with the specified id. If no optimistic
     * message with the provided id exists then this function does nothing.
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
            lastMessageChangeTime: this._lastMessageChangeTime,
            unloadedMessageChangeByIndex: this._unloadedMessageChangeByIndex,
            typingStateByConnectionId: this._typingStateByConnectionId,
        });
    }

    /**
     * Set the entire typing state by connection map to the provided value.
     * Used when backfilling when we get new states.
     */
    private _setTypingStateByConnectionId(
        typingStateByConnectionId: Iterable<[WebSocketConnectionId, MessagingTypingState]>,
    ) {
        const newTypingStateByConnectionId = ImmutableMap.from(typingStateByConnectionId);

        // If there are no typing states before and after this update we don't need a
        // new message list.
        if (this._typingStateByConnectionId.size === 0 && newTypingStateByConnectionId.size === 0)
            return this;

        return new MessageList({
            messageCountExcludingOptimisticMessages: this._messageCountExcludingOptimisticMessages,
            messages: this._messages,
            unloadedMessages: this._unloadedMessages,
            optimisticMessages: this._optimisticMessages,
            lastMessageChangeTime: this._lastMessageChangeTime,
            unloadedMessageChangeByIndex: this._unloadedMessageChangeByIndex,
            typingStateByConnectionId: newTypingStateByConnectionId,
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
            lastMessageChangeTime: this._lastMessageChangeTime,
            unloadedMessageChangeByIndex: this._unloadedMessageChangeByIndex,
            typingStateByConnectionId: typingState
                ? this._typingStateByConnectionId.set(connectionId, typingState)
                : this._typingStateByConnectionId.delete(connectionId),
        });
    }

    public putMessageStreamPart(event: {
        index: number;
        partIndex: number;
        part: {
            version: number;
            payload: MessageStreamPartPayload;
        };
        references: ContentReferences;
    }) {
        const iterator = this._messages.find(event.index);
        if (!iterator.value) return this;

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
            // TODO(calebmer, #ai-realtime-hacks): This is a bad UX. A better UX would be
            // to have a list of "pending parts" and wait to add those parts until we
            // receive all preceding parts. But I'm moving fast today so not
            // implementing this.
            //
            // TODO(calebmer, #ai-realtime-hacks): Relatedly, we continue applying part
            // updates even after the stream is completed. That's also not a great UX if
            // we're showing a loading spinner while the stream hasn't completed. Ideally
            // the completion event would go into a "pending" list as well if we're waiting
            // on a part update.
            for (let i = newParts.length; i < event.partIndex; i++) {
                newParts.push({
                    version: -1,
                    payload: {type: "Content", content: createSimpleMessageContent()},
                });
            }

            assert(newParts.length === event.partIndex);
            newParts.push(event.part);
        }

        const newStream: MessageStream = {
            ...message.stream,
            parts: newParts,
        };

        // Merge in the new references for the stream part. All stream parts in a
        // single message share the same references object.
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
            lastMessageChangeTime: this._lastMessageChangeTime,
            unloadedMessageChangeByIndex: this._unloadedMessageChangeByIndex,
            typingStateByConnectionId: this._typingStateByConnectionId,
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
            lastMessageChangeTime: this._lastMessageChangeTime,
            unloadedMessageChangeByIndex: this._unloadedMessageChangeByIndex,
            typingStateByConnectionId: this._typingStateByConnectionId,
        });
    }
}

function changeMessage<Message extends MessageModel>(
    message: Message,
    change: MessageChange,
): Message {
    switch (change.type) {
        case "UpdateContent": {
            // Do nothing if the message is deleted or the comment was updated at a later
            // time then our message. There are no ordering guarantees for
            // `changeLoadedMessage()`! So we have to enforce ordering with
            // `contentUpdatedTime`.
            if (
                message.payload.type !== "Content" ||
                (message.payload.contentUpdatedTime !== null &&
                    change.contentUpdatedTime.getTime() <
                        message.payload.contentUpdatedTime.getTime())
            ) {
                return message;
            }

            return message.clone({
                payload: {
                    ...message.payload,
                    content: change.content,
                    contentUpdatedTime: change.contentUpdatedTime,
                },
            });
        }
        case "Delete": {
            // Delete messages should only happen once and should only happen to
            // content messages.
            if (message.payload.type !== "Content") return message;

            return message.clone({
                payload: {
                    type: "Deleted",
                    deletedTime: change.deletedTime,
                },
            });
        }
        default:
            throw exhaustive(change);
    }
}
