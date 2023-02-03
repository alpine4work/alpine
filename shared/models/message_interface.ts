import {MessageContent} from "~/shared/content/message_content_schema";
import {AccountModel} from "~/shared/models/account_model";

/**
 * The interface for a message to be rendered by our messaging UI.
 */
export interface MessageInterface {
    /**
     * Message IDs are positive integers that are unique within a room and are
     * incremented sequentially.
     *
     * Because message IDs are mostly dense (deleted messages may leave gaps) you
     * can do arithmetic on IDs to load different slices of messages. For example
     * if you wanted 20 messages with some `messageId` in the middle you could
     * query `afterMessageId: messageId - 10, limit: 20` and most of the time get
     * the messages you want.
     */
    readonly id: number;
    /**
     * The account who created this message.
     */
    readonly author: AccountModel;
    /**
     * The time at which the message was created.
     */
    readonly createdTime: Date;
    /**
     * If this message is a reply to another message then this will be set to the
     * ID of the message we're replying to.
     */
    readonly parentMessageId: number | null;
    /**
     * The contents of the message.
     */
    readonly content: MessageContent;
    /**
     * If this message was ever updated then this is the time at which the update
     * occurred. Will be null if the message was never updated.
     */
    readonly contentUpdatedTime: Date | null;
    /**
     * Get a key for the room the message is in.
     */
    getRoomKey(): string;
}
