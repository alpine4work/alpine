import {ApiContentMentionInlineElementTargetPath} from "~/shared/api/types/api_specification_convenience_types.js";
import {FileIdOrFileEntityIdSchema, getFileEntityTypes} from "~/shared/files/file_entity_id.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {MessageContentSchema} from "~/shared/messaging/message_content_schema.js";
import {ProsemirrorMappingSchema} from "~/shared/prosemirror/prosemirror_mapping_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export type MessagePayload = SchemaType<typeof MessagePayloadSchema>;

export type MessageContentPayload = SchemaType<typeof MessageContentPayloadSchema>;

export type MessageContentPayloadClerical = SchemaType<typeof MessageContentPayloadClericalSchema>;

export type MessageDeletedPayload = SchemaType<typeof MessageDeletedPayloadSchema>;

export type MessageContentPayloadParent = SchemaType<typeof MessageContentPayloadParentSchema>;

export const MessageContentPayloadParentSchema = Schema.union({
    Message: Schema.object({
        type: Schema.value("Message"),
        index: Schema.integer,
    }),
    MessagesRange: Schema.object({
        type: Schema.value("MessagesRange"),
        startIndex: Schema.integer.min(0),
        endIndex: Schema.integer.min(0), // `endIndex` is inclusive
        startVersion: Schema.integer.min(0),
        endVersion: Schema.integer.min(0),
        startPos: Schema.integer.min(0),
        endPos: Schema.integer.min(0),
    })
        .validation(
            "`startIndex` is less than or equal to `endIndex`",
            range => range.startIndex <= range.endIndex,
        )
        .validation(
            "`startVersion` is equal to `endVersion` if `startIndex` equals `endIndex`",
            range => range.startIndex !== range.endIndex || range.startVersion === range.endVersion,
        )
        .validation(
            "`startPos` is less than or equal to `endPos` if `startIndex` equals `endIndex`",
            range => range.startIndex !== range.endIndex || range.startPos <= range.endPos,
        ),
});

export function* iterateMessageContentPayloadParentIndexes(
    parent: MessageContentPayloadParent,
): IterableIterator<number> {
    switch (parent.type) {
        case "Message": {
            yield parent.index;
            break;
        }
        case "MessagesRange": {
            for (let index = parent.startIndex; index <= parent.endIndex; index++) {
                yield index;
            }
            break;
        }
        default:
            throw exhaustive(parent);
    }
}

export type MessageContentPayloadContentUpdate = SchemaType<
    typeof MessageContentPayloadContentUpdateSchema
>;

export const MessageContentPayloadContentUpdateSchema = Schema.object({
    time: Schema.date,
    mappings: Schema.array(ProsemirrorMappingSchema).default(emptyArray),
});

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
    parent: MessageContentPayloadParentSchema.wrapOriginalPropertyInUnionVariant(
        "Message",
        "index",
        {},
    )
        .originalPropertyKey("parentMessageIndex")
        .nullable()
        .default(null),

    /**
     * The contents of the message.
     */
    content: MessageContentSchema,

    /**
     * If this message was ever updated then this is the time at which the update
     * occurred. Will be null if the message was never updated.
     *
     * Also includes `mappings`. Each time the message is updated we record the
     * mapping for positions from the start version to the end version of the
     * updated message. So we can map any positions in `MessagesRange`. The version
     * of the message is `contentUpdate.mappings.length` (we start at version 0).
     */
    contentUpdate: MessageContentPayloadContentUpdateSchema.wrapOriginalPropertyInObject("time", {
        mappings: [],
    })
        .originalPropertyKey("contentUpdatedTime")
        .nullable()
        .default(null),

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
