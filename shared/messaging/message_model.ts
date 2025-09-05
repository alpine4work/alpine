import {
    FileEntityIdSchema,
    FileIdOrFileEntityIdSchema,
    getFileEntityTypes,
} from "~/shared/files/file_entity_id.js";
import {FileEntityModelResultSchema} from "~/shared/files/file_entity_model.js";
import {FileModel} from "~/shared/files/file_model.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Id} from "~/shared/id/id.js";
import {
    MessageContentSchema,
    MessageContentWithReferencesSchema,
} from "~/shared/messaging/message_content_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export type MessageRoomKeyType<Message extends MessageModelBase> = Message extends MessageModel<
    infer RoomKey
>
    ? RoomKey
    : never;

export interface MessageModelBase {
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
    readonly payload: MessagePayloadModel;
}

/**
 * The interface for a message to be rendered by our messaging UI.
 */
export interface MessageModel<RoomKey extends string = string> extends MessageModelBase {
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
     * Get a key for the room the message is in.
     *
     * Room keys are not available in optimistic messages since we may be
     * optimistically creating a room and not have a room yet.
     */
    getRoomKey(): RoomKey;

    /**
     * Clone the model object, replacing any values with those provided in the
     * partial value.
     */
    clone(partialValue: {payload?: MessagePayloadModel}): this;

    // Available for TypeScript to access this property on a union.
    readonly isOptimistic?: undefined;
}

/**
 * An optimistic message is one which has been created on the client but has
 * not yet been confirmed on the server. Which means the server has not yet
 * assigned it an index.
 */
export interface OptimisticMessageModel extends MessageModelBase {
    readonly isOptimistic: true;

    /**
     * An identifier for an optimistic message on the client.
     */
    readonly optimisticId: Id;

    /**
     * Was there an error when trying to send this optimistic message to the
     * server? If true we tell the user and let them retry.
     */
    readonly optimisticRequestErrorState:
        | {readonly hasError: false}
        | {readonly hasError: true; readonly retry: () => void};

    // Available for TypeScript to access this property on a union.
    readonly index?: undefined;
}

export type MessagePayload = SchemaType<typeof MessagePayloadSchema>;

export type MessageContentPayload = SchemaType<typeof MessageContentPayloadSchema>;

export type MessageContentPayloadClerical = SchemaType<typeof MessageContentPayloadClericalSchema>;

export type MessageDeletedPayload = SchemaType<typeof MessageDeletedPayloadSchema>;

export const MessageContentPayloadClericalSchema = Schema.union({
    /**
     * Clerical message left when someone shares an entity with you and chooses
     * to notify you.
     */
    ShareNotification: Schema.object({
        type: Schema.value("ShareNotification"),
        entityType: Schema.enum(getFileEntityTypes()),
    }),
});

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

    /**
     * Files attached to the message to be rendered below the message content.
     */
    fileIds: Schema.array(FileIdOrFileEntityIdSchema).default([]),

    /**
     * Clerical messages are generated automatically by some part of our system.
     * For example, when a user shares an entity with you the notification you're
     * sent is a clerical chat message.
     *
     * Clerical messages have a couple properties:
     *
     * - They can't be updated or deleted
     * - In the case of chat, you won't get a loud notification
     * - Instead of a notification like "so and so sent you a message" the
     *   notification text will be based on the clerical message type
     *
     * As of 2025-05-01, the only clerical message we send is the notification
     * after sharing some entity type over chat. Other messaging surfaces (e.g.
     * post comments and document comments) don't currently have clerical messages.
     * Adding this as a general purpose property to the message payload might be
     * premature. But I can already imagine at least two other use cases for
     * clerical messages: 1) If you resolve a document comment thread we leave a
     * clerical comment that says "so and so resolved this comment thread". 2) If
     * you move a post from one channel to another we leave a clerical comment that
     * says "so and so moved this post from channel A to channel B". Since I can
     * think of three use cases for this abstraction, I'm happy introducing it.
     */
    // TODO(calebmer): It would be nice to have a test in
    // `testMessagingImplementation()` that makes sure you can't update or delete
    // clerical messages. But right now there's no generic API for creating
    // clerical messages.
    clerical: MessageContentPayloadClericalSchema.optional(),
});

const MessageDeletedPayloadSchema: Schema<{
    readonly type: "Deleted";
    readonly deletedTime: Date;

    // Allow accessing these properties on a `MessagePayload` union with TypeScript
    // as a convenience.
    readonly parentMessageIndex?: undefined;
    readonly content?: undefined;
    readonly contentUpdatedTime?: undefined;
    readonly fileIds?: undefined;
    readonly clerical?: undefined;
}> = Schema.object({
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

export type MessagePayloadModel = SchemaType<typeof MessagePayloadModelSchema>;

export type MessageContentPayloadModel = SchemaType<typeof MessageContentPayloadModelSchema>;

export type MessageContentPayloadModelFile = SchemaType<
    typeof MessageContentPayloadModelFileSchema
>;

export type MessageDeletedPayloadModel = SchemaType<typeof MessageDeletedPayloadModelSchema>;

export const MessageContentPayloadModelFileSchema = Schema.union({
    File: Schema.object({
        type: Schema.value("File"),
        signedUrlSearch: Schema.string,
        file: FileModel.schema,
    }),
    FileEntity: Schema.object({
        type: Schema.value("FileEntity"),
        fileEntityId: FileEntityIdSchema,
        fileEntityResult: FileEntityModelResultSchema,
    }),
});

const MessageContentPayloadModelSchema = Schema.object({
    type: Schema.value("Content"),
    parentMessageIndex: Schema.integer.nullable(),
    content: MessageContentWithReferencesSchema,
    contentUpdatedTime: Schema.date.nullable(),
    files: Schema.array(MessageContentPayloadModelFileSchema).default([]),
    clerical: MessageContentPayloadClericalSchema.optional(),
});

const MessageDeletedPayloadModelSchema = Schema.object({
    type: Schema.value("Deleted"),
    deletedTime: Schema.date,
});

/**
 * `MessagePayloadModel` is different from `MessagePayload` in that
 * `MessagePayloadModel` is what we send to the client whereas `MessagePayload`
 * is what we store in the database. So `MessagePayloadModel` typically has
 * extra data for the client we don't need in the database.
 *
 * We expect that `MessagePayloadModel` is a supertype of `MessagePayload`. So
 * anywhere that expects a `MessagePayload` could also get
 * a `MessagePayloadModel`.
 */
export const MessagePayloadModelSchema = Schema.union({
    Content: MessageContentPayloadModelSchema,
    Deleted: MessageDeletedPayloadModelSchema,
});

/**
 * Determines if the two message payloads are deeply equal to each other. For
 * ProseMirror content we need to use the `eq()` method.
 */
export function areMessagePayloadModelsEqual(
    payload1: MessagePayloadModel,
    payload2: MessagePayloadModel,
): boolean {
    switch (payload1.type) {
        case "Content": {
            if (payload2.type !== "Content") return false;
            return (
                payload1.parentMessageIndex === payload2.parentMessageIndex &&
                payload1.content.doc.eq(payload2.content.doc) &&
                payload1.contentUpdatedTime?.getTime() === payload2.contentUpdatedTime?.getTime()
            );
        }
        case "Deleted": {
            if (payload2.type !== "Deleted") return false;
            return payload1.deletedTime.getTime() === payload2.deletedTime.getTime();
        }
        default:
            throw exhaustive(payload1);
    }
}

function getMessagePayloadChangeTime(payload: MessagePayloadModel): Date | null {
    switch (payload.type) {
        case "Content":
            return payload.contentUpdatedTime;
        case "Deleted":
            return payload.deletedTime;
        default:
            throw exhaustive(payload);
    }
}

/**
 * Get the last message to be changed between the two messages. The last message to
 * be changed is the most up-to-date.
 */
export function getLastChangedMessage<Message extends MessageModel>(
    message1: Message,
    message2: Message,
): Message {
    const changeTime1 = getMessagePayloadChangeTime(message1.payload);
    const changeTime2 = getMessagePayloadChangeTime(message2.payload);

    if (changeTime1 === null && changeTime2 === null) return message1;
    if (changeTime1 === null) return message2;
    if (changeTime2 === null) return message1;

    if (changeTime2 > changeTime1) return message2;
    return message1;
}
