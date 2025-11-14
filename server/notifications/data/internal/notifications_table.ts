import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {
    DynamoTableItemKeyType,
    DynamoTableSchema,
} from "~/server/dynamo/core/dynamo_table_schema.js";
import {
    AccountId,
    ChannelId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

// Regular DynamoDB table for any data regarding notifications that does not
// need to be updated on the client in realtime. `InboxTable` is where all the
// data for an account's inbox is stored because that data needs to update on
// the client in realtime.
export const NotificationsTable = DynamoTableSchema.new({
    name: "Notifications",
    partitions: [
        {
            name: "Inbox",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
                accountId: DynamoKeyAttributeSchema.id<AccountId>(),
            },
            sortRanges: [
                // This is a reverse index from `PostId` to `ChannelPostsEntry` in
                // `InboxTable`. So we can easily check whether a given `PostId` is present
                // in a channel posts inbox entry.
                //
                // Once a `PostInChannelPostsEntry` item has been created, it will never be
                // deleted. Since we never delete `postIds` from a `ChannelPostsEntry`.
                {
                    name: "PostInChannelPostsEntry",
                    sortKeyAttributes: {
                        postId: DynamoKeyAttributeSchema.id<PostId>(),
                    },
                    attributes: Schema.object({
                        channelId: Schema.id<ChannelId>(),
                        bucketGeneration: Schema.integer,
                    }),
                },

                // This is a reverse index from `DocumentId` + `DocumentCommentThreadId` to
                // `DocumentNewCommentThreadsEntry` in `InboxTable`. So we can easily check
                // whether a given comment thread is present in a new comment threads inbox
                // entry.
                //
                // Once a `DocumentCommentThreadInNewCommentThreadsEntry` item has been
                // created, it will never be deleted. Since we never delete `commentThreadIds`
                // from a `DocumentNewCommentThreadsEntry`.
                {
                    name: "DocumentCommentThreadInNewCommentThreadsEntry",
                    sortKeyAttributes: {
                        documentId: DynamoKeyAttributeSchema.id<DocumentId>(),
                        commentThreadId: DynamoKeyAttributeSchema.id<DocumentCommentThreadId>(),
                    },
                    attributes: Schema.object({
                        bucketGeneration: Schema.integer,
                    }),
                },
            ],
        },
    ],
});

export type InboxPostInChannelPostsEntryItemKey = DynamoTableItemKeyType<
    typeof NotificationsTable,
    "Inbox",
    "PostInChannelPostsEntry"
>;

export type InboxDocumentCommentThreadInNewCommentThreadsEntryItemKey = DynamoTableItemKeyType<
    typeof NotificationsTable,
    "Inbox",
    "DocumentCommentThreadInNewCommentThreadsEntry"
>;
