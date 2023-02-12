import createTree, {Tree} from "functional-red-black-tree";
import {InvalidArgumentError, OutOfRangeError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {Id} from "~/shared/id/id";
import {
    MessageInterface,
    OptimisticMessageInterface,
    areMessagePayloadsEqual,
} from "~/shared/models/message_interface";

export type MessageListItem<Message extends MessageInterface> =
    | MessageListLoadedItem<Message>
    | MessageListUnloadedItem
    | MessageListOptimisticItem;

export type MessageListLoadedItem<Message extends MessageInterface> = {
    readonly type: "Loaded";
    readonly message: Message;
};

export type MessageListUnloadedItem = {
    readonly type: "Unloaded";
};

export type MessageListOptimisticItem = {
    readonly type: "Optimistic";
    readonly message: OptimisticMessageInterface;
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
export class MessageList<Message extends MessageInterface> {
    private readonly _messageCount: number;
    private readonly _messages: Tree<number, Message>;
    private readonly _optimisticMessages: ReadonlyArray<OptimisticMessageInterface>;

    private constructor({
        messageCount,
        messages,
        optimisticMessages,
    }: {
        messageCount: number;
        messages: Tree<number, Message>;
        optimisticMessages: ReadonlyArray<OptimisticMessageInterface>;
    }) {
        if (process.env.NODE_ENV !== "production") {
            assert(
                !messages.begin.node || messages.begin.node.key >= 0,
                "Out of bounds message in message list",
            );
            assert(
                !messages.end.node || messages.end.node.key < messageCount,
                "Out of bounds message in message list",
            );
        }

        this._messageCount = messageCount;
        this._messages = messages;
        this._optimisticMessages = optimisticMessages;
    }

    public static new<Message extends MessageInterface>(
        messageCount: number,
    ): MessageList<Message> {
        return new MessageList({
            messageCount,
            messages: createTree(),
            optimisticMessages: [],
        });
    }

    /**
     * Get the number of messages in the list. There may be more messages then we
     * have loaded.
     */
    public getMessageCount(): number {
        return this._messageCount + this._optimisticMessages.length;
    }

    /**
     * Get the message at the provided index. If we haven't loaded the message
     * we'll return `isLoaded: false`. Throws if the index is out of bounds.
     */
    public getMessage(index: number): MessageListItem<Message> {
        if (!Number.isSafeInteger(index))
            throw new InvalidArgumentError("Message index is not an integer");
        if (index < 0 || index >= this.getMessageCount())
            throw new OutOfRangeError("Message index out of bounds");

        if (index >= this._messageCount) {
            const optimisticMessageIndex = index - this._messageCount;
            const message = this._optimisticMessages[optimisticMessageIndex]!;
            return {type: "Optimistic", message, optimisticMessageIndex};
        }

        const message = this._messages.get(index);
        return message ? {type: "Loaded", message} : {type: "Unloaded"};
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
     *
     * Excludes optimistic messages.
     */
    public *iterateLoadedMessages(startIndex: number = 0): IterableIterator<Message> {
        const iterator = this._messages.ge(startIndex);

        while (iterator.valid) {
            yield iterator.value!;
            iterator.next();
        }
    }

    /**
     * Increase message count for this list. If the message count is less than the
     * current message count we won't change anything.
     *
     * Excludes message count from optimistic messages.
     */
    public setMessageCount(messageCount: number): MessageList<Message> {
        assert(Number.isSafeInteger(messageCount), "Message count is not an integer");
        assert(messageCount >= 0, "Message count should be positive");

        // If we have messages at a higher index then the message count won't change.
        messageCount = Math.max(messageCount, this._messageCount);

        if (messageCount === this._messageCount) return this;
        return new MessageList({
            messageCount,
            messages: this._messages,
            optimisticMessages: this._optimisticMessages,
        });
    }

    /**
     * Sets messages in the list at their index. If the message index is greater
     * than our message count then we will extend the message count. If the message
     * with the same index already exists then it will be replaced.
     */
    public setMessages(newMessages: ReadonlyArray<Message>): MessageList<Message> {
        let messageCount = this._messageCount;
        let messages = this._messages;
        let optimisticMessages = this._optimisticMessages;

        for (const message of newMessages) {
            const iterator = messages.find(message.index);
            messages = iterator.node
                ? iterator.update(message)
                : messages.insert(message.index, message);

            messageCount = Math.max(messageCount, message.index + 1);

            // If we have an equivalent optimistic message, remove it from the list now
            // that we have the real loaded message in the correct position.
            const optimisticMessage = optimisticMessages.find(
                optimisticMessage =>
                    optimisticMessage.author.id === message.author.id &&
                    areMessagePayloadsEqual(optimisticMessage.payload, message.payload),
            );
            if (optimisticMessage)
                optimisticMessages = optimisticMessages.filter(
                    otherOptimisticMessage => otherOptimisticMessage !== optimisticMessage,
                );
        }

        return new MessageList({
            messageCount,
            messages,
            optimisticMessages,
        });
    }

    /**
     * Sets a message in the list at its index. If the message index is greater
     * than our message count then we will extend the message count. If the message
     * with the same index already exists then it will be replaced.
     */
    public setMessage(message: Message): MessageList<Message> {
        return this.setMessages([message]);
    }

    /**
     * Adds an optimistic message to the message list.
     *
     * The optimistic message will be cleared when a new message is added
     * that's equal.
     */
    public addOptimisticMessage(message: OptimisticMessageInterface): MessageList<Message> {
        return new MessageList({
            messageCount: this._messageCount,
            messages: this._messages,
            optimisticMessages: [...this._optimisticMessages, message],
        });
    }

    /**
     * Updates a message at the specified index in the list. If the message at that
     * index is not loaded or out of bounds then this function does nothing.
     *
     * Excludes optimistic messages. If the index is an optimistic message we will
     * ignore and do nothing.
     */
    public updateLoadedMessage(
        messageIndex: number,
        update: (message: Message) => Message,
    ): MessageList<Message> {
        const iterator = this._messages.find(messageIndex);
        if (!iterator.value) return this;
        const newMessage = update(iterator.value);
        if (newMessage === iterator.value) return this;
        return new MessageList({
            messageCount: this._messageCount,
            messages: iterator.update(newMessage),
            optimisticMessages: this._optimisticMessages,
        });
    }

    /**
     * Updates the optimistic message with the specified id. If no optimistic
     * message with the provided id exists then this function does nothing.
     */
    public updateOptimisticMessage(
        optimisticId: Id,
        update: (message: OptimisticMessageInterface) => OptimisticMessageInterface,
    ) {
        return new MessageList({
            messageCount: this._messageCount,
            messages: this._messages,
            optimisticMessages: this._optimisticMessages.map(optimisticMessage =>
                optimisticMessage.optimisticId === optimisticId
                    ? update(optimisticMessage)
                    : optimisticMessage,
            ),
        });
    }
}
