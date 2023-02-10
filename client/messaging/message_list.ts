import createTree, {Tree} from "functional-red-black-tree";
import {InvalidArgumentError, OutOfRangeError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {MessageInterface} from "~/shared/models/message_interface";

/**
 * Immutable state for keeping track of a list of messages. The message list
 * may be partially loaded at any time with gaps between messages.
 */
export class MessageList<Message extends MessageInterface> {
    private readonly _messageCount: number;
    private readonly _messages: Tree<number, Message>;

    private constructor(messageCount: number, messages: Tree<number, Message>) {
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
    }

    public static new<Message extends MessageInterface>(
        messageCount: number,
    ): MessageList<Message> {
        return new MessageList(messageCount, createTree());
    }

    /**
     * Get the number of messages in the list. There may be more messages then we
     * have loaded.
     */
    public getMessageCount(): number {
        return this._messageCount;
    }

    /**
     * Get the message at the provided index. If we haven't loaded the message
     * we'll return `isLoaded: false`. Throws if the index is out of bounds.
     */
    public getMessage(index: number): {isLoaded: true; message: Message} | {isLoaded: false} {
        if (!Number.isSafeInteger(index))
            throw new InvalidArgumentError("Message index is not an integer");
        if (index < 0 || index >= this._messageCount)
            throw new OutOfRangeError("Message index out of bounds");

        const message = this._messages.get(index);
        return message ? {isLoaded: true, message} : {isLoaded: false};
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
     */
    public setMessageCount(messageCount: number): MessageList<Message> {
        assert(Number.isSafeInteger(messageCount), "Message count is not an integer");
        assert(messageCount >= 0, "Message count should be positive");

        // If we have messages at a higher index then the message count won't change.
        messageCount = Math.max(messageCount, this._messageCount);

        if (messageCount === this._messageCount) return this;
        return new MessageList(messageCount, this._messages);
    }

    /**
     * Sets messages in the list at their index. If the message index is greater
     * than our message count then we will extend the message count. If the message
     * with the same index already exists then it will be replaced.
     */
    public setMessages(newMessages: ReadonlyArray<Message>): MessageList<Message> {
        let messageCount = this._messageCount;
        let messages = this._messages;

        for (const message of newMessages) {
            const iterator = messages.find(message.index);
            messages = iterator.node
                ? iterator.update(message)
                : messages.insert(message.index, message);

            messageCount = Math.max(messageCount, message.index + 1);
        }

        return new MessageList(messageCount, messages);
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
     * Updates a message at the specified index in the list. If the message at that
     * index is not loaded or out of bounds then this function does nothing.
     */
    public updateMessage(
        messageIndex: number,
        update: (message: Message) => Message,
    ): MessageList<Message> {
        const iterator = this._messages.find(messageIndex);
        if (!iterator.value) return this;
        const newMessage = update(iterator.value);
        if (newMessage === iterator.value) return this;
        return new MessageList(this._messageCount, iterator.update(newMessage));
    }
}
