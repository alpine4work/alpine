import {ApiMentionTargetPath} from "~/shared/api/parse_api_path.js";
import {FileIdOrFileEntityIdSchema, getFileEntityTypes} from "~/shared/files/file_entity_id.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {MessageContentSchema} from "~/shared/messaging/message_content_schema.js";
import {ProsemirrorMappingSchema} from "~/shared/prosemirror/prosemirror_mapping_schema.js";
import {ReactionSet, emptyReactionSet} from "~/shared/reactions/reaction_set.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export type MessagePayload = SchemaType<typeof MessagePayloadSchema>;

export type MessageContentPayload = SchemaType<typeof MessageContentPayloadSchema>;

export type MessageContentPayloadClerical = SchemaType<typeof MessageContentPayloadClericalSchema>;

export type MessageDeletedPayload = SchemaType<typeof MessageDeletedPayloadSchema>;

export type MessageContentPayloadMessageParent = SchemaType<
    typeof MessageContentPayloadMessageParentSchema
>;

const MessageContentPayloadMessageParentSchema = Schema.object({
    type: Schema.value("Message"),
    index: Schema.integer,
});

export type MessageContentPayloadMessagesRangeParent = SchemaType<
    typeof MessageContentPayloadMessagesRangeParentSchema
>;

const MessageContentPayloadMessagesRangeParentSchema = Schema.object({
    type: Schema.value("MessagesRange"),
    startIndex: Schema.integer.min(0),
    endIndex: Schema.integer.min(0), // `endIndex` is inclusive
    startContentVersion: Schema.integer.min(0).originalPropertyKey("startVersion"),
    endContentVersion: Schema.integer.min(0).originalPropertyKey("endVersion"),
    startPos: Schema.integer.min(0),
    endPos: Schema.integer.min(0),
})
    .validation(
        "`startIndex` is less than or equal to `endIndex`",
        range => range.startIndex <= range.endIndex,
    )
    .validation(
        "`startContentVersion` is equal to `endContentVersion` if `startIndex` equals `endIndex`",
        range =>
            range.startIndex !== range.endIndex ||
            range.startContentVersion === range.endContentVersion,
    )
    .validation(
        "`startPos` is less than or equal to `endPos` if `startIndex` equals `endIndex`",
        range => range.startIndex !== range.endIndex || range.startPos <= range.endPos,
    );

export type MessageContentPayloadPostRangeParent = SchemaType<
    typeof MessageContentPayloadPostRangeParentSchema
>;

// Only post comments can have a post range parent. We throw an error if any
// other messaging surface has a post range parent.
const MessageContentPayloadPostRangeParentSchema = Schema.object({
    type: Schema.value("PostRange"),
    contentVersion: Schema.integer.min(0).originalPropertyKey("version"),
    startPos: Schema.integer.min(0),
    endPos: Schema.integer.min(0),
}).validation(
    "`startPos` is is less than or equal to `endPos`",
    range => range.startPos <= range.endPos,
);

export type MessageContentPayloadParent = SchemaType<typeof MessageContentPayloadParentSchema>;

export const MessageContentPayloadParentSchema = Schema.union({
    Message: MessageContentPayloadMessageParentSchema,
    MessagesRange: MessageContentPayloadMessagesRangeParentSchema,
    PostRange: MessageContentPayloadPostRangeParentSchema,
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
        case "PostRange": {
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

    /**
     * Reactions on the message. Users can leave reactions on each block node of
     * the message. Since if a user is looking at a series of messages from the
     * same user, we don't tell them where the message boundaries are. It looks
     * like one unified block of text. What users see are paragraph boundaries.
     * So we let them leave reactions on each paragraph (block node) of the
     * message.
     *
     * The server throws if the client tries to add a reaction that's not at the
     * end of a block node. The server will also perform some rebasing if the
     * client tries to add a reaction to an old message version.
     *
     * When a message updates, the server is responsible for moving reactions to
     * their new location. Based on how the message was updated.
     */
    reactionsByPos: Schema.map(Schema.integer, ReactionSet.schema).default(emptyMap),

    /**
     * Reactions on the files attached to the message. Should be empty if `fileIds`
     * is empty.
     */
    filesReactions: ReactionSet.schema.default(emptyReactionSet),
}).validation(
    "If `fileIds` is empty then `filesReactions` should be empty",
    payload => payload.fileIds.length > 0 || payload.filesReactions.get().size === 0,
);

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
    readonly reactionsByPos?: undefined;
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
        targetPath: Schema.string as Schema<ApiMentionTargetPath>,
    }),
    Search: Schema.object({
        type: Schema.value("Search"),
        query: Schema.string,
    }),
});

export type MessageStreamToolCallPartPayload = SchemaType<
    typeof MessageStreamToolCallPartPayloadSchema
>;

export const MessageStreamToolCallPartPayloadSchema = Schema.object({
    type: Schema.value("ToolCall"),
    call: MessageStreamToolCallPartPayloadCallSchema,
});

export type MessageStreamReasoningPartPayload = SchemaType<
    typeof MessageStreamReasoningPartPayloadSchema
>;

export const MessageStreamReasoningPartPayloadSchema = Schema.object({
    type: Schema.value("Reasoning"),
    content: MessageContentSchema,
});

export type MessageStreamPartPayload = SchemaType<typeof MessageStreamPartPayloadSchema>;

export const MessageStreamPartPayloadSchema = Schema.union({
    Content: MessageStreamContentPartPayloadSchema,
    ToolCall: MessageStreamToolCallPartPayloadSchema,
    Reasoning: MessageStreamReasoningPartPayloadSchema,
});

export type MessageStream = SchemaType<typeof MessageStreamSchema>;

export const MessageStreamSchema = Schema.object({
    createdTime: Schema.date,
    completedTime: Schema.date.nullable(),
    parts: Schema.array(
        Schema.object({
            version: Schema.integer,
            payload: MessageStreamPartPayloadSchema,
            createdTime: Schema.date,
        }),
    ),
});
