import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {PostContentSchema} from "~/shared/forum/post_content_schema.js";
import {AccountId, ChannelId, PostDraftId, PostId, SpaceId} from "~/shared/id/types/id_types.js";
import {MessageContentSchema} from "~/shared/messaging/message_content_schema.js";
import {
    MessagePayloadSchema,
    MessageStreamPartPayloadSchema,
} from "~/shared/messaging/message_schema.js";
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
                /**
                 * Accounts who are subscribed to get notifications in their inbox whenever a
                 * post is created in this channel.
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
                        payload: MessagePayloadSchema,
                    }),
                    childSortRanges: [
                        {
                            name: "Stream",
                            sortKeyAttributes: {},
                            attributes: Schema.object({
                                // We duplicate `authorId` here to easily check if the bot is allowed to update
                                // the stream.
                                authorId: Schema.id<AccountId>(),

                                /**
                                 * When the stream was completed. If null then the stream hasn't been
                                 * finished so we should expect more updates!
                                 *
                                 * If a stream hasn't completed for some period of time since creation (a
                                 * couple hours) then we consider the stream to be completed whether or not
                                 * it actually has been completed.
                                 */
                                completedTime: Schema.date.nullable(),

                                /**
                                 * The number of parts in the stream so far. A bot can only ever create
                                 * new parts or update the last part in the stream.
                                 */
                                partCount: Schema.integer.min(0),

                                /**
                                 * The current `updateLockVersion` of the last part in the stream.
                                 */
                                lastPartUpdateLockVersion: Schema.integer.min(0).nullable(),

                                /**
                                 * The last `IndexSearchEntity` job that was sent for this stream. We send an
                                 * `IndexSearchEntity` job once every 10 seconds.
                                 */
                                lastIndexSearchEntityJob: Schema.object({
                                    sendTime: Schema.date,
                                    delaySeconds: Schema.integer.min(0),
                                }),
                            }),
                        },
                        {
                            name: "StreamPart",
                            sortKeyAttributes: {
                                partIndex: DynamoKeyAttributeSchema.integer,
                            },
                            attributes: Schema.object({
                                payload: MessageStreamPartPayloadSchema,
                            }),
                        },
                    ],
                },

                /**
                 * We keep a log of changes to comments so that when backfilling for realtime
                 * we can send any missed updates between the last time data was loaded and
                 * the backfill.
                 *
                 * `changeTime` should be monotonically increasing which is managed by
                 * `lastChangeTime` in `commentsSummary`.
                 *
                 * This log does not include when comments are created, only updated or
                 * deleted. Because comment indexes are dense we can take the last seen comment
                 * index and load comments after that to backfill.
                 *
                 * Log items will expire after a certain amount of time. If a client hasn't
                 * backfilled in a long time it will need to fully reload since we won't know
                 * what changed.
                 */
                {
                    name: "CommentChangeLog",
                    sortKeyAttributes: {
                        changeTime: DynamoKeyAttributeSchema.date,
                    },
                    withExpirationTime: "Required",
                    attributes: Schema.object({
                        commentIndex: Schema.integer,
                        change: Schema.union({
                            UpdateContent: Schema.object({
                                type: Schema.value("UpdateContent"),
                                content: MessageContentSchema,
                                // `contentUpdatedTime` is the `changeTime` sort key attribute. We don't
                                // duplicate it here.
                            }),
                            Delete: Schema.object({
                                type: Schema.value("Delete"),
                                // `deletedTime` is the `changeTime` sort key attribute. We don't
                                // duplicate it here.
                            }),
                        }),
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
                 * backend. That way the content in their post is saved across reloads and
                 * across devices. We also can attach files to post drafts.
                 *
                 * As of 2024-10-30 we're introducing `PostDraft`s only to have a backend
                 * entity to attach files to. In the future we should show drafts in the UI and
                 * let the user resume writing a post from a draft.
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
