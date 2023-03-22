import createTree, {Tree} from "functional-red-black-tree";
import {InvalidArgumentError, OutOfRangeError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map";
import {Id} from "~/shared/id/id";
import {MessageChange, getMessageChangeTime} from "~/shared/messaging/message_change_schema";
import {
    MessageModel,
    OptimisticMessageModel,
    areMessagePayloadModelsEqual,
    getLastChangedMessage,
} from "~/shared/models/message_model";

export type MessageListItem<Message extends MessageModel> =
    | MessageListLoadedItem<Message>
    | MessageListUnloadedItem
    | MessageListOptimisticItem;

export type MessageListLoadedItem<Message extends MessageModel> = {
    readonly type: "Loaded";
    readonly message: Message;
};

export type MessageListUnloadedItem = {
    readonly type: "Unloaded";
    readonly message: null;
};

export type MessageListOptimisticItem = {
    readonly type: "Optimistic";
    readonly message: OptimisticMessageModel;
    /**
     * What is the index of this message relative to other optimistic messages? For
     * example, if this is the second optimistic message and we have 10 loaded
     * messages, this will be 1 because it is index 1 in the optimistic messages
     * array.
     */
    readonly optimisticMessageIndex: number;
};

/**
 * Immutable state for keeping track of a list of messages. The message list
 * may be partially loaded at any time with gaps between messages.
 */
export class MessageList<Message extends MessageModel> {
    private readonly _messageCountExcludingOptimisticMessages: number;
    private readonly _messages: Tree<number, Message>;
    private readonly _optimisticMessages: ReadonlyArray<OptimisticMessageModel>;
    private readonly _lastMessageChangeTime: Date | null;
    private readonly _unloadedMessageChangeByIndex: ImmutableMap<number, MessageChange>;

    private constructor({
        messageCountExcludingOptimisticMessages,
        messages,
        optimisticMessages,
        lastMessageChangeTime,
        unloadedMessageChangeByIndex,
    }: {
        messageCountExcludingOptimisticMessages: number;
        messages: Tree<number, Message>;
        optimisticMessages: ReadonlyArray<OptimisticMessageModel>;
        lastMessageChangeTime: Date | null;
        unloadedMessageChangeByIndex: ImmutableMap<number, MessageChange>;
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
        }

        this._messageCountExcludingOptimisticMessages = messageCountExcludingOptimisticMessages;
        this._messages = messages;
        this._optimisticMessages = optimisticMessages;
        this._lastMessageChangeTime = lastMessageChangeTime;
        this._unloadedMessageChangeByIndex = unloadedMessageChangeByIndex;
    }

    public static new<Message extends MessageModel>({
        messageCount,
        lastMessageChangeTime,
    }: {
        messageCount: number;
        lastMessageChangeTime: Date | null;
    }): MessageList<Message> {
        return new MessageList({
            messageCountExcludingOptimisticMessages: messageCount,
            messages: createTree(),
            optimisticMessages: [],
            lastMessageChangeTime,
            unloadedMessageChangeByIndex: ImmutableMap.empty(),
        });
    }

    /**
     * Get the number of messages in the list. There may be more messages then we
     * have loaded.
     */
    public getMessageCount(): number {
        return this._messageCountExcludingOptimisticMessages + this._optimisticMessages.length;
    }

    /**
     * Get the number of messages in the list excluding any optimistic messages.
     */
    public getMessageCountExcludingOptimisticMessages(): number {
        return this._messageCountExcludingOptimisticMessages;
    }

    /**
     * Get the last message change time our list knows about. We will use this to
     * backfill changes the list doesn't know about.
     */
    public getLastMessageChangeTime(): Date | null {
        return this._lastMessageChangeTime;
    }

    /**
     * Get the message at the provided index. If we haven't loaded the message
     * we'll return `type: "Unloaded"`. Throws if the index is out of bounds.
     */
    public getMessage(index: number): MessageListItem<Message> {
        if (!Number.isSafeInteger(index))
            throw new InvalidArgumentError("Message index is not an integer");
        if (index < 0 || index >= this.getMessageCount())
            throw new OutOfRangeError("Message index out of bounds");

        if (index >= this._messageCountExcludingOptimisticMessages) {
            const optimisticMessageIndex = index - this._messageCountExcludingOptimisticMessages;
            const message = this._optimisticMessages[optimisticMessageIndex]!;
            return {type: "Optimistic", message, optimisticMessageIndex};
        }

        const message = this._messages.get(index);
        return message ? {type: "Loaded", message} : {type: "Unloaded", message: null};
    }

    /**
     * Get the message at the provided index but only if it is loaded. Otherwise we
     * return null. Throws if the index is out of bounds.
     */
    public getLoadedMessageIfExists(index: number): Message | null {
        const message = this.getMessage(index);
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
    public getFirstLoadedMessageAfter(index: number): Message | null {
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
    public getLastLoadedMessageBefore(index: number): Message | null {
        const iterator = this._messages.lt(index);
        if (!iterator.value) return null;
        assert(iterator.value.index !== index);
        return iterator.value;
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
            yield {type: "Loaded", message: iterator.value!};
            iterator.next();
        }

        for (const [optimisticMessageIndex, message] of this._optimisticMessages
            .slice(Math.max(0, startIndex - this._messages.length))
            .entries()) {
            yield {type: "Optimistic", message, optimisticMessageIndex};
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
            optimisticMessages: this._optimisticMessages,
            lastMessageChangeTime: this._lastMessageChangeTime,
            unloadedMessageChangeByIndex: this._unloadedMessageChangeByIndex,
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
            optimisticMessages: this._optimisticMessages,
            lastMessageChangeTime,
            unloadedMessageChangeByIndex: this._unloadedMessageChangeByIndex,
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
        let optimisticMessages = this._optimisticMessages;
        let unloadedMessageChangeByIndex = this._unloadedMessageChangeByIndex;

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
        }

        return new MessageList({
            messageCountExcludingOptimisticMessages: messageCount,
            messages,
            optimisticMessages,
            lastMessageChangeTime: this._lastMessageChangeTime,
            unloadedMessageChangeByIndex,
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
    }: {
        messageCount: number;
        lastMessageChangeTime: Date | null;
        newMessages: ReadonlyArray<Message>;
        newOtherReferencedMessages: ReadonlyArray<Message>;
        messageChanges: ReadonlyArray<MessageChange>;
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
            messages: this._messages,
            optimisticMessages: [...this._optimisticMessages, message],
            lastMessageChangeTime: this._lastMessageChangeTime,
            unloadedMessageChangeByIndex: this._unloadedMessageChangeByIndex,
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
                    optimisticMessages: this._optimisticMessages,
                    lastMessageChangeTime:
                        !this._lastMessageChangeTime ||
                        change.contentUpdatedTime > this._lastMessageChangeTime
                            ? change.contentUpdatedTime
                            : this._lastMessageChangeTime,
                    unloadedMessageChangeByIndex: this._unloadedMessageChangeByIndex,
                });
            }
            case "Delete": {
                const newMessage = changeMessage(message, change);
                if (newMessage === message) return this;

                return new MessageList({
                    messageCountExcludingOptimisticMessages:
                        this._messageCountExcludingOptimisticMessages,
                    messages: iterator.update(newMessage),
                    optimisticMessages: this._optimisticMessages,
                    lastMessageChangeTime:
                        !this._lastMessageChangeTime ||
                        change.deletedTime > this._lastMessageChangeTime
                            ? change.deletedTime
                            : this._lastMessageChangeTime,
                    unloadedMessageChangeByIndex: this._unloadedMessageChangeByIndex,
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
            optimisticMessages: this._optimisticMessages.map(optimisticMessage =>
                optimisticMessage.optimisticId === optimisticId
                    ? update(optimisticMessage)
                    : optimisticMessage,
            ),
            lastMessageChangeTime: this._lastMessageChangeTime,
            unloadedMessageChangeByIndex: this._unloadedMessageChangeByIndex,
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
