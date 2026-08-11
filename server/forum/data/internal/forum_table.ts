import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {
    MessageStreamAttributesSchema,
    MessageStreamPartSchema,
} from "~/server/messaging/helpers/message_stream_schema.js";
import {PostContentSchema} from "~/shared/forum/post_content_schema.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {
    AccountId,
    ChannelId,
    PostDraftId,
    PostId,
    SpaceId,
} from "~/shared/id/types/id_types.open_source.js";
import {MessagePayloadSchema} from "~/shared/messaging/message_schema.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {Schema} from "~/shared/schema/schema.js";

// Contains forum data that's not covered by our general realtime system. For
// instance, post comments are covered by our messaging realtime system.
export const ForumTable = DynamoTableSchema.new({
    name: "Forum",
    partitions: [
        {
            name: "Channel",
            partitionKeyAttributes: {
                channelId: DynamoKeyAttributeSchema.id<ChannelId>(),
            },
            sortRanges: [
                {
                    name: "Posts",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        lastPostCreatedTime: Schema.date,
                    }),
                },

                /**
                 * Accounts who are subscribed to get notifications in their inbox whenever a post
                 * is created in this channel.
                 */
                {
                    name: "Subscription",
                    sortKeyAttributes: {
                        accountId: DynamoKeyAttributeSchema.id<AccountId>(),
                    },
                    attributes: Schema.object({
                        createdTime: Schema.date,
                    }),
                },
            ],
        },
        {
            name: "Post",
            partitionKeyAttributes: {
                postId: DynamoKeyAttributeSchema.id<PostId>(),
            },
            sortRanges: [
                /**
                 * Comments on a post. Has all the attributes needed for a message in
                 * `MessageInterface`.
                 */
                {
                    name: "Comments",
                    sortKeyAttributes: {
                        commentIndex: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        authorId: Schema.id<AccountId>(),
                        createdTime: Schema.date,
                        createdTimeZone: TimeZoneSchema.default(defaultTimeZone),
                        payload: MessagePayloadSchema,
                    }),
                    childSortRanges: [
                        {
                            name: "Stream",
                            sortKeyAttributes: {},
                            attributes: MessageStreamAttributesSchema,
                        },
                        {
                            name: "StreamPart",
                            sortKeyAttributes: {
                                partIndex: DynamoKeyAttributeSchema.integer,
                            },
                            attributes: MessageStreamPartSchema,
                        },
                    ],
                },

                /**
                 * Whenever a message is updated we add a `MessageUpdates` item. So when clients
                 * need to backfill realtime events they missed while disconnected from a WebSocket
                 * server they can query this sort range to catch up.
                 *
                 * The event includes the `messageIndex` and the new `version` of the message.
                 * During backfill we load the new version of the item.
                 *
                 * This sort range has a similar design to the `Events` sort range in
                 * `RynamoTableSchema`.
                 *
                 * IMPORTANT: This does not include realtime events for streaming messages!
                 * Streaming messages are updated with a different realtime system that's more
                 * efficient for the streaming use case.
                 *
                 * Named `MessageUpdates` instead of `CommentUpdates` so we can have shared
                 * utilities for querying this sort range that work across all messaging surfaces.
                 */
                {
                    name: "MessageUpdates",
                    sortKeyAttributes: {
                        // NOTE(calebmer): Reversed so if we ever wanted to backfill in one query we could.
                        // Through a query that starts at the client's last `messageIndex` and ends at the
                        // checkpoint's `eventTime`.
                        eventTime: DynamoKeyAttributeSchema.date.reverse(),
                        // All the data is in the key so we can safely use create-or-replace to add items
                        // to the table without worrying we're overriding some other data.
                        messageIndex: DynamoKeyAttributeSchema.integer,
                        version: DynamoKeyAttributeSchema.integer,
                    },
                    withExpirationTime: "Required",
                    attributes: Schema.object({}),
                },

                // NOTE(calebmer, 2025-10-13): We changed the format for messaging realtime events
                // to a new sort range: `MessageUpdates`. Leaving this around until all old
                // `CommentChangeLog` items expire. At which point we can remove this from the
                // DynamoDB schema.
                {
                    name: "CommentChangeLog",
                    sortKeyAttributes: {
                        changeTime: DynamoKeyAttributeSchema.date,
                    },
                    withExpirationTime: "Required",
                    attributes: Schema.object({
                        commentIndex: Schema.integer,
                        change: Schema.unknown(),
                    }),
                },
            ],
        },
        {
            name: "Account",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
                accountId: DynamoKeyAttributeSchema.id<AccountId>(),
            },
            sortRanges: [
                /**
                 * When the user creates a post we create a `PostDraft` item for them on the
                 * backend. That way the content in their post is saved across reloads and across
                 * devices. We also can attach files to post drafts.
                 *
                 * As of 2024-10-30 we're introducing `PostDraft`s only to have a backend entity to
                 * attach files to. In the future we should show drafts in the UI and let the user
                 * resume writing a post from a draft.
                 */
                {
                    name: "PostDraft",
                    sortKeyAttributes: {
                        draftId: DynamoKeyAttributeSchema.id<PostDraftId>(),
                    },
                    attributes: Schema.object({
                        channelId: Schema.id<ChannelId>().nullable(),
                        content: PostContentSchema,
                    }),
                },
            ],
        },
    ],
});
