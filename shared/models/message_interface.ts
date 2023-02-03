import {MessageContentSchema} from "~/shared/content/message_content_schema";
import {AccountModel} from "~/shared/models/account_model";
import {Schema, SchemaType} from "~/shared/schema/schema";

/**
 * The interface for a message to be rendered by our messaging UI.
 */
export interface MessageInterface {
    /**
     * Message indexes are positive integers that are unique within a room and are
     * incremented sequentially.
     *
     * Once a message is created, it is never deleted. Message indexes form a dense
     * array. If you have a message with index 10 you are guaranteed that messages
     * between index 0 and 10 exist.
     *
     * When an author deletes their message it leaves a "Message deleted by X"
     * statement with the same index. This is a compromise to let users control
     * their data (messages can be edited + deleted) while maintaining the shape of
     * the conversation to combat gaslighting. Users won't be confused if they get
     * a notification and a message is no longer there.
     */
    readonly index: number;
    /**
     * The account who created this message.
     */
    readonly author: AccountModel;
    /**
     * The time at which the message was created.
     */
    readonly createdTime: Date;
    /**
     * The message payload. Determines the contents of the message and how it
     * will be rendered.
     */
    readonly payload: MessagePayload;
    /**
     * Get a key for the room the message is in.
     */
    getRoomKey(): string;
}

export interface MessageWithContentPayloadInterface extends MessageInterface {
    readonly payload: MessageContentPayload;
}

export interface MessageWithDeletedPayloadInterface extends MessageInterface {
    readonly payload: MessageDeletedPayload;
}

export type MessagePayload = SchemaType<typeof MessagePayloadSchema>;
export type MessageContentPayload = SchemaType<typeof MessageContentPayloadSchema>;
export type MessageDeletedPayload = SchemaType<typeof MessageDeletedPayloadSchema>;

const MessageContentPayloadSchema = Schema.object({
    type: Schema.value("Content"),
    /**
     * If this message is a reply to another message then this will be set to the
     * index of the message we're replying to. The parent message index should
     * always be less than our message index.
     */
    parentMessageIndex: Schema.integer.nullable(),
    /**
     * The contents of the message.
     */
    content: MessageContentSchema,
    /**
     * If this message was ever updated then this is the time at which the update
     * occurred. Will be null if the message was never updated.
     */
    contentUpdatedTime: Schema.date.nullable(),
});

const MessageDeletedPayloadSchema = Schema.object({
    type: Schema.value("Deleted"),
    /**
     * The time at which this message was deleted.
     */
    deletedTime: Schema.date,
});

export const MessagePayloadSchema = Schema.union({
    Content: MessageContentPayloadSchema,
    Deleted: MessageDeletedPayloadSchema,
});
