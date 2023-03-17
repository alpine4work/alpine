import {RequestContext} from "~/server/dynamo/context/request_context";
import {MessageContent} from "~/shared/content/message_content_schema";
import {MessageChange} from "~/shared/messaging/message_change_schema";
import {AccountModel} from "~/shared/models/account_model";
import {MessageModel, MessagePayloadModel} from "~/shared/models/message_model";

/**
 * Creates the model class for a message based on known data. Does not actually
 * create the message in the database!
 */
export type CreateMessageModelFunction<
    RoomKey extends string,
    Message extends MessageModel,
> = (options: {
    roomKey: RoomKey;
    index: number;
    createdTime: Date;
    author: AccountModel;
    payload: MessagePayloadModel;
}) => Message;

/**
 * Create a new message in a room.
 */
export type CreateMessageFunction<RoomKey extends string> = (
    context: RequestContext,
    options: {
        roomKey: RoomKey;
        parentMessageIndex: number | null;
        content: MessageContent;
    },
) => Promise<{
    index: number;
    createdTime: Date;
}>;

/**
 * Get a message.
 */
export type GetMessageFunction<RoomKey extends string, Message extends MessageModel<RoomKey>> = (
    context: RequestContext,
    options: {
        roomKey: RoomKey;
        messageIndex: number;
    },
) => Promise<Message | null>;

/**
 * Update the content of a message.
 *
 * We will record the time at which the content was updated and show that the
 * message was edited.
 */
export type UpdateMessageContentFunction<RoomKey extends string> = (
    context: RequestContext,
    options: {
        roomKey: RoomKey;
        messageIndex: number;
        content: MessageContent;
    },
) => Promise<{
    contentUpdatedTime: Date;
}>;

/**
 * Delete a message.
 */
export type DeleteMessageFunction<RoomKey extends string> = (
    context: RequestContext,
    options: {
        roomKey: RoomKey;
        messageIndex: number;
    },
) => Promise<{
    deletedTime: Date;
}>;

/**
 * Load a range of messages starting from the beginning of the room (or
 * starting after a message ID) and loading forwards in time.
 */
export type GetMessagesFromStart<RoomKey extends string, Message extends MessageModel<RoomKey>> = (
    context: RequestContext,
    options: {
        roomKey: RoomKey;
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
    },
) => Promise<{
    messageCount: number;
    messages: Array<Message>;
    otherReferencedMessages: Array<Message>;
    lastMessageChangeTime: Date | null;
}>;

/**
 * Load a range of messages starting from the end of the room (or
 * starting before a message ID) and loading backwards in time.
 */
export type GetMessagesFromEnd<RoomKey extends string, Message extends MessageModel<RoomKey>> = (
    context: RequestContext,
    options: {
        roomKey: RoomKey;
        limit: number;
        afterMessageIndex: number | null;
        beforeMessageIndex: number | null;
    },
) => Promise<{
    messageCount: number;
    messages: Array<Message>;
    otherReferencedMessages: Array<Message>;
    lastMessageChangeTime: Date | null;
}>;

/**
 * Backfill messages and message changes the client is missing. Realtime could
 * be implemented by polling this method. However, this method is also
 * important for implementing push-based realtime as it fills the gap between
 * when data was loaded and when we connected to our realtime WebSocket.
 */
export type BackfillMessagesFunction<
    RoomKey extends string,
    Message extends MessageModel<RoomKey>,
> = (
    context: RequestContext,
    options: {
        roomKey: RoomKey;
        clientMessageCount: number;
        clientLastMessageChangeTime: Date | null;
        newMessageLimit: number;
    },
) => Promise<{
    messageCount: number;
    lastMessageChangeTime: Date | null;
    newMessages: Array<Message>;
    newOtherReferencedMessages: Array<Message>;
    messageChangesResult:
        | {
              type: "Available";
              changes: Array<MessageChange>;
          }
        | {
              type: "Unavailable";
          };
}>;
