import {
    ApiBotWebhookCreatedMessageEventMessageParent,
    ApiBotWebhookCreatedMessageEventParent,
    ApiBotWebhookCreatedMessageEventPostParent,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {MessageContentSchema} from "~/shared/content/message_content_schema.js";
import {PostContentSchema} from "~/shared/forum/post_content_schema.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    NotificationEventId,
    PostId,
    SpaceId,
    TaskId,
} from "~/shared/id/types/id_types.open_source.js";
import {MessageContentPayloadClericalSchema} from "~/shared/messaging/message_schema.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.open_source.js";
import {SearchMentionEntityIdSchema} from "~/shared/search/search_entity_id.js";

const ApiBotWebhookNewMessageEventMessageParentSchema: Schema<ApiBotWebhookCreatedMessageEventMessageParent> =
    Schema.object({
        type: Schema.value("Message"),
        index: Schema.integer,
        author: Schema.object({
            id: Schema.id<AccountId>(),
        }),
    });

const ApiBotWebhookNewMessageEventPostParentSchema: Schema<ApiBotWebhookCreatedMessageEventPostParent> =
    Schema.object({
        type: Schema.value("Post"),
        author: Schema.object({
            id: Schema.id<AccountId>(),
        }),
    });

export const ApiBotWebhookCreatedMessageEventParentSchema: Schema<ApiBotWebhookCreatedMessageEventParent> =
    Schema.union({
        Message: ApiBotWebhookNewMessageEventMessageParentSchema,
        Post: ApiBotWebhookNewMessageEventPostParentSchema,
    });

export type NotificationCreateChatMessageEvent = SchemaType<
    typeof NotificationCreateChatMessageEventSchema
>;

const NotificationCreateChatMessageEventSchema = Schema.object({
    type: Schema.value("CreateChatMessage"),
    id: Schema.id<NotificationEventId>(),
    spaceId: Schema.id<SpaceId>(),
    chatId: Schema.id<ChatId>(),
    messageIndex: Schema.integer,
    createdTime: Schema.date,
    createdTimeZone: TimeZoneSchema,
    authorId: Schema.id<AccountId>(),
    mentionedAccountIds: Schema.set(Schema.id<AccountId>()),
    parent: ApiBotWebhookCreatedMessageEventParentSchema.nullable().default(null),
    isContentSnippetComplete: Schema.boolean.default(false),
    contentSnippet: MessageContentSchema,
    clerical: MessageContentPayloadClericalSchema.optional(),
    currentlyViewedSearchEntityId: SearchMentionEntityIdSchema.optional(),
});

export type NotificationCreatePostCommentEvent = SchemaType<
    typeof NotificationCreatePostCommentEventSchema
>;

const NotificationCreatePostCommentEventSchema = Schema.object({
    type: Schema.value("CreatePostComment"),
    id: Schema.id<NotificationEventId>(),
    spaceId: Schema.id<SpaceId>(),
    postId: Schema.id<PostId>(),
    commentIndex: Schema.integer,
    createdTime: Schema.date,
    createdTimeZone: TimeZoneSchema,
    authorId: Schema.id<AccountId>(),
    mentionedAccountIds: Schema.set(Schema.id<AccountId>()),
    parent: ApiBotWebhookCreatedMessageEventParentSchema.nullable().default(null),
    isContentSnippetComplete: Schema.boolean.default(false),
    contentSnippet: MessageContentSchema,
});

export type NotificationCreatePostEvent = SchemaType<typeof NotificationCreatePostEventSchema>;

const NotificationCreatePostEventSchema = Schema.object({
    type: Schema.value("CreatePost"),
    id: Schema.id<NotificationEventId>(),
    spaceId: Schema.id<SpaceId>(),
    channelId: Schema.id<ChannelId>(),
    postId: Schema.id<PostId>(),
    createdTime: Schema.date,
    createdTimeZone: TimeZoneSchema,
    authorId: Schema.id<AccountId>(),
    mentionedAccountIds: Schema.set(Schema.id<AccountId>()),
    isContentSnippetComplete: Schema.boolean.default(false),
    contentSnippet: PostContentSchema,
});

export type NotificationCreateDocumentCommentEvent = SchemaType<
    typeof NotificationCreateDocumentCommentEventSchema
>;

const NotificationCreateDocumentCommentEventSchema = Schema.object({
    type: Schema.value("CreateDocumentComment"),
    id: Schema.id<NotificationEventId>(),
    spaceId: Schema.id<SpaceId>(),
    documentId: Schema.id<DocumentId>(),
    commentThreadId: Schema.id<DocumentCommentThreadId>(),
    commentIndex: Schema.integer,
    createdTime: Schema.date,
    createdTimeZone: TimeZoneSchema,
    authorId: Schema.id<AccountId>(),
    mentionedAccountIds: Schema.set(Schema.id<AccountId>()),
    parent: ApiBotWebhookCreatedMessageEventParentSchema.nullable().default(null),
    isContentSnippetComplete: Schema.boolean.default(false),
    contentSnippet: MessageContentSchema,
});

export type NotificationCreateTaskCommentEvent = SchemaType<
    typeof NotificationCreateTaskCommentEventSchema
>;

const NotificationCreateTaskCommentEventSchema = Schema.object({
    type: Schema.value("CreateTaskComment"),
    id: Schema.id<NotificationEventId>(),
    spaceId: Schema.id<SpaceId>(),
    taskId: Schema.id<TaskId>(),
    commentIndex: Schema.integer,
    createdTime: Schema.date,
    createdTimeZone: TimeZoneSchema,
    authorId: Schema.id<AccountId>(),
    mentionedAccountIds: Schema.set(Schema.id<AccountId>()),
    parent: ApiBotWebhookCreatedMessageEventParentSchema.nullable().default(null),
    isContentSnippetComplete: Schema.boolean.default(false),
    contentSnippet: MessageContentSchema,
});

// TODO(calebmer): Add message, comment, and post update events in case they add a
// mention? How should this work?
export type NotificationEvent = SchemaType<typeof NotificationEventSchema>;

export const NotificationEventSchema = Schema.union({
    CreateChatMessage: NotificationCreateChatMessageEventSchema,
    CreatePostComment: NotificationCreatePostCommentEventSchema,
    CreatePost: NotificationCreatePostEventSchema,
    CreateDocumentComment: NotificationCreateDocumentCommentEventSchema,
    CreateTaskComment: NotificationCreateTaskCommentEventSchema,
});

export const NotificationEventJobDescriptionSchema = Schema.object({
    type: Schema.value("NotificationEvent"),
    event: NotificationEventSchema,
});
