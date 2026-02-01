import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {
    AccountId,
    ChannelId,
    DocumentId,
    PostId,
    TaskCollectionId,
} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export type FeedEntryEvent = SchemaType<typeof FeedEntryEventSchema>;

export const FeedEntryEventSchema = Schema.enum(["Created", "SharedWithAccessPolicyDefaultGrant"]);

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
     * Whenever a post is created, whether it is in a private channel or not, we
     * create a feed entry. When calculating an account's feed we load the post to
     * see if the account has access to the post.
     */
    Post: Schema.object({
        type: Schema.value("Post"),
        postId: Schema.id<PostId>(),
        channelId: Schema.id<ChannelId>(),
        authorId: Schema.id<AccountId>(),
        createdTime: Schema.date,
    }),

    /**
     * We add a feed entry for documents when they're shared with the space.
     * The feed entry says "X shared a document".
     */
    Document: Schema.object({
        type: Schema.value("Document"),
        documentId: Schema.id<DocumentId>(),
        sharedTime: Schema.date,
        sharerId: Schema.id<AccountId>(),
        creator: Schema.object({
            id: Schema.id<AccountId>().nullable(),
            fromBotAccountId: Schema.id<AccountId>().nullable(),
        })
            .wrapOriginalPropertyInObject("id", {fromBotAccountId: null})
            .originalPropertyKey("creatorId"),
        event: FeedEntryEventSchema,
    }),

    /**
     * We add a feed entry for task collections when they're shared with the space.
     * The feed entry says "X shared a task collection".
     */
    TaskCollection: Schema.object({
        type: Schema.value("TaskCollection"),
        collectionId: Schema.id<TaskCollectionId>(),
        sharedTime: Schema.date,
        sharerId: Schema.id<AccountId>(),
        creatorId: Schema.id<AccountId>().nullable(),
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
        case "Document":
        case "TaskCollection":
            return entry.sharedTime;
        default:
            throw exhaustive(entry);
    }
}
