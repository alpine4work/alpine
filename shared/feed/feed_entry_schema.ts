import {DocumentCreatorFromSchema} from "~/shared/documents/document_creator_from.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentId,
    PostId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export type FeedEntryEvent = SchemaType<typeof FeedEntryEventSchema>;

export const FeedEntryEventSchema = Schema.enum(["Created", "SharedWithAccessPolicyDefaultGrant"]);

export const FeedTaskEntryEventSchema = Schema.enum([
    "UpdatedToProjectLayout",
    "SharedWithAccessPolicyDefaultGrant",
    "SharedProjectLayoutWithInheritedAccessPolicyDefaultGrant",
]);

export type FeedEntry = SchemaType<typeof FeedEntrySchema>;

export const FeedEntrySchema = Schema.union({
    /**
     * We add a "Welcome to Alpine" feed entry at the beginning of each account's feed.
     * The client decides how to render this feed entry. The account will be in an
     * otherwise empty space so we'll include some instructions on how to use Alpine.
     */
    Welcome: Schema.object({
        type: Schema.value("Welcome"),
        addedTime: Schema.date,
        emailDomainWithAutoAddAccountsEnabled: Schema.string.nullable().default(null),
    }),

    /**
     * Whenever a post is created, whether it is in a private channel or not, we create
     * a feed entry. When calculating an account's feed we load the post to see if the
     * account has access to the post.
     */
    Post: Schema.object({
        type: Schema.value("Post"),
        postId: Schema.id<PostId>(),
        channelId: Schema.id<ChannelId>(),
        authorId: Schema.id<AccountId>(),
        createdTime: Schema.date,
    }),

    /**
     * We add a feed entry for documents when they're shared with the space. The feed
     * entry says "X shared a document".
     */
    Document: Schema.object({
        type: Schema.value("Document"),
        documentId: Schema.id<DocumentId>(),
        sharedTime: Schema.date,
        sharerId: Schema.id<AccountId>(),
        creator: Schema.object({
            id: Schema.id<AccountId>().nullable(),
            from: DocumentCreatorFromSchema.wrapOriginalPropertyInUnionVariant(
                "Bot",
                "accountId",
                {},
            )
                .nullable()
                .default(null)
                .originalPropertyKey("fromBotAccountId"),
        })
            .wrapOriginalPropertyInObject("id", {from: null})
            .originalPropertyKey("creatorId"),
        excludeFromCreatorFeed: Schema.boolean.optional(),
        event: FeedEntryEventSchema,
    }),

    /**
     * We add a feed entry for tasks when they're shared with the space. The feed entry
     * says "X shared a task".
     */
    Task: Schema.object({
        type: Schema.value("Task"),
        taskId: Schema.id<TaskId>(),
        sharedTime: Schema.date,
        sharerId: Schema.id<AccountId>(),
        creatorId: Schema.id<AccountId>().nullable(),
        excludeFromCreatorFeed: Schema.boolean.optional(),
        event: FeedTaskEntryEventSchema,
    }),

    /**
     * We add a feed entry for task collections when they're shared with the space. The
     * feed entry says "X shared a task collection".
     */
    TaskCollection: Schema.object({
        type: Schema.value("TaskCollection"),
        collectionId: Schema.id<TaskCollectionId>(),
        sharedTime: Schema.date,
        sharerId: Schema.id<AccountId>(),
        creatorId: Schema.id<AccountId>().nullable(),
        excludeFromCreatorFeed: Schema.boolean.optional(),
        event: FeedEntryEventSchema,
    }),

    /**
     * We add a feed entry for channels when they're created (if they're public) or
     * when they're shared with the space (if they're private).
     *
     * The feed entry says either "X created a channel" or "X shared a channel"
     * depending on the event that created the feed entry.
     */
    Channel: Schema.object({
        type: Schema.value("Channel"),
        channelId: Schema.id<ChannelId>(),
        sharedTime: Schema.date,
        sharerId: Schema.id<AccountId>(),
        creatorId: Schema.id<AccountId>().nullable(),
        excludeFromCreatorFeed: Schema.boolean.optional(),
        event: FeedEntryEventSchema,
    }),

    /**
     * We add a feed entry for chat rooms when they're created (if they're public) or
     * when they're shared with the space (if they're private).
     *
     * The feed entry says either "X created a chat room" or "X shared a chat room"
     * depending on the event that created the feed entry.
     */
    RoomChat: Schema.object({
        type: Schema.value("RoomChat"),
        chatId: Schema.id<ChatId>(),
        sharedTime: Schema.date,
        sharerId: Schema.id<AccountId>(),
        creatorId: Schema.id<AccountId>().nullable(),
        excludeFromCreatorFeed: Schema.boolean.optional(),
        event: FeedEntryEventSchema,
    }),
});

export function getFeedEntryTime(entry: FeedEntry): Date {
    switch (entry.type) {
        case "Welcome":
            return entry.addedTime;
        case "Post":
            return entry.createdTime;
        case "Channel":
        case "RoomChat":
        case "Document":
        case "Task":
        case "TaskCollection":
            return entry.sharedTime;
        default:
            throw exhaustive(entry);
    }
}
