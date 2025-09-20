import {ApiContentMentionInlineElementTargetPath} from "~/shared/api/types/api_specification_convenience_types.js";
import {FileIdOrFileEntityIdSchema, getFileEntityTypes} from "~/shared/files/file_entity_id.js";
import {MessageContentSchema} from "~/shared/messaging/message_content_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export type MessagePayload = SchemaType<typeof MessagePayloadSchema>;

export type MessageContentPayload = SchemaType<typeof MessageContentPayloadSchema>;

export type MessageContentPayloadClerical = SchemaType<typeof MessageContentPayloadClericalSchema>;

export type MessageDeletedPayload = SchemaType<typeof MessageDeletedPayloadSchema>;

/**
 * Clerical message left when someone shares an entity with you and chooses
 * to notify you.
 */
const MessageContentPayloadShareNotificationClericalSchema = Schema.object({
    type: Schema.value("ShareNotification"),
    entityType: Schema.enum(getFileEntityTypes()),
});

/**
 * If this a streaming message? Only bots can send streaming messages.
 */
const MessageContentPayloadStreamClericalSchema = Schema.object({
    type: Schema.value("Stream"),
});

export const MessageContentPayloadClericalSchema = Schema.union({
    ShareNotification: MessageContentPayloadShareNotificationClericalSchema,
    Stream: MessageContentPayloadStreamClericalSchema,
});

export const MessageContentPayloadSchema = Schema.object({
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

export type MessageStreamContentPartPayload = SchemaType<
    typeof MessageStreamContentPartPayloadSchema
>;

export const MessageStreamContentPartPayloadSchema = Schema.object({
    type: Schema.value("Content"),
    content: MessageContentSchema,
});

export type MessageStreamToolCallPartPayloadCall = SchemaType<
    typeof MessageStreamToolCallPartPayloadCallSchema
>;

const MessageStreamToolCallPartPayloadCallSchema = Schema.union({
    Read: Schema.object({
        type: Schema.value("Read"),
        targetPath: Schema.string as Schema<ApiContentMentionInlineElementTargetPath>,
        title: Schema.string,
    }),
});

export type MessageStreamToolCallPartPayload = SchemaType<
    typeof MessageStreamToolCallPartPayloadSchema
>;

export const MessageStreamToolCallPartPayloadSchema = Schema.object({
    type: Schema.value("ToolCall"),
    call: MessageStreamToolCallPartPayloadCallSchema,
});

export type MessageStreamPartPayload = SchemaType<typeof MessageStreamPartPayloadSchema>;

export const MessageStreamPartPayloadSchema = Schema.union({
    Content: MessageStreamContentPartPayloadSchema,
    ToolCall: MessageStreamToolCallPartPayloadSchema,
});

export type MessageStream = SchemaType<typeof MessageStreamSchema>;

export const MessageStreamSchema = Schema.object({
    completedTime: Schema.date.nullable(),
    parts: Schema.array(
        Schema.object({
            version: Schema.integer,
            payload: MessageStreamPartPayloadSchema,
        }),
    ),
});
