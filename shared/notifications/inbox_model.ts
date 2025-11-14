import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {DocumentPreviewModel} from "~/shared/documents/document_model.js";
import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    SpaceId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {MessageContentPayloadClericalSchema} from "~/shared/messaging/message_schema.js";
import {DigestNotificationsScheduleSchema} from "~/shared/notifications/notifications_schedule_schema.js";
import {createModelUnionSchema} from "~/shared/schema/model/create_model_union_schema.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export class InboxModel extends Model(
    Schema.object({
        spaceId: Schema.id<SpaceId>(),
        accountId: Schema.id<AccountId>(),
        loudNotificationCount: Schema.integer.min(0),
        entryCount: Schema.integer.min(0),
        lastZeroEntryCountTime: Schema.date.nullable(),
        digestNotificationsOptedOutTime: Schema.date.nullable(),
        digestNotificationsSchedule: DigestNotificationsScheduleSchema,
    }),
) {}

export type InboxEntryKey = SchemaType<typeof InboxEntryKeySchema>;

const InboxChatEntryKeySchema = Schema.object({
    type: Schema.value("Chat"),
    chatId: Schema.id<ChatId>(),
});

const InboxPostCommentsEntryKeySchema = Schema.object({
    type: Schema.value("PostComments"),
    postId: Schema.id<PostId>(),
});

const InboxChannelPostsEntryKeySchema = Schema.object({
    type: Schema.value("ChannelPosts"),
    channelId: Schema.id<ChannelId>(),
    bucketGeneration: Schema.integer,
});

const InboxDocumentCommentThreadEntryKeySchema = Schema.object({
    type: Schema.value("DocumentCommentThread"),
    documentId: Schema.id<DocumentId>(),
    commentThreadId: Schema.id<DocumentCommentThreadId>(),
});

const InboxDocumentNewCommentThreadsEntryKeySchema = Schema.object({
    type: Schema.value("DocumentNewCommentThreads"),
    documentId: Schema.id<DocumentId>(),
    bucketGeneration: Schema.integer,
});

const InboxTaskEntryKeySchema = Schema.object({
    type: Schema.value("Task"),
    taskId: Schema.id<TaskId>(),
});

export const InboxEntryKeySchema = Schema.union({
    Chat: InboxChatEntryKeySchema,
    PostComments: InboxPostCommentsEntryKeySchema,
    ChannelPosts: InboxChannelPostsEntryKeySchema,
    DocumentCommentThread: InboxDocumentCommentThreadEntryKeySchema,
    DocumentNewCommentThreads: InboxDocumentNewCommentThreadsEntryKeySchema,
    Task: InboxTaskEntryKeySchema,
});

export function getInboxEntryKeyPath(
    spaceId: SpaceId,
    key: InboxEntryKey,
    routeLayout: RouteLayout,
): string {
    switch (key.type) {
        case "Chat":
            return `/s/${spaceId}/chat/${key.chatId}?inbox=show`;
        case "PostComments":
            return `/s/${spaceId}/posts/${key.postId}?inbox=show`;
        case "ChannelPosts":
            return `/s/${spaceId}/notifications/channel-posts/${key.channelId}-${key.bucketGeneration}?inbox=show`;
        case "DocumentCommentThread":
            return `/s/${spaceId}/documents/${key.documentId}/comments/${key.commentThreadId}?inbox=show`;
        case "DocumentNewCommentThreads":
            return `/s/${spaceId}/notifications/document-comment-threads/${key.documentId}-${key.bucketGeneration}?inbox=show`;
        case "Task": {
            if (routeLayout === "wide") {
                return `/s/${spaceId}/tasks/${key.taskId}?inbox=show&comments=show`;
            } else {
                return `/s/${spaceId}/tasks/${key.taskId}/comments?inbox=show`;
            }
        }
        default:
            throw exhaustive(key);
    }
}

export function getInboxEntryPath(
    model: InboxEntryModelInterface,
    routeLayout: RouteLayout,
): string {
    return getInboxEntryKeyPath(model.spaceId, model.getKey(), routeLayout);
}

/**
 * Gets the path for an inbox entry and base64 encodes it to hide the fact that it's a URL.
 * Intended for use in search params, such as the `selected` search param (e.g. https://alpine.inc/s/1234/inbox?selected=<encoded entry path>).
 */
export function getEncodedInboxEntryPath(
    model: InboxEntryModelInterface,
    routeLayout: RouteLayout,
): string {
    const entryPath = getInboxEntryPath(model, routeLayout);
    const textEncoder = new TextEncoder();
    return encodeBase64(textEncoder.encode(entryPath.replace(/^(\/s\/[^/]+\/)/, "")), "Rfc4648Url");
}

interface InboxEntryModelInterface {
    readonly type: string;
    readonly spaceId: SpaceId;
    getKey(): InboxEntryKey;
}

export class InboxChatEntryModel
    extends Model(
        Schema.object({
            spaceId: Schema.id<SpaceId>(),
            accountId: Schema.id<AccountId>(),
            chatId: Schema.id<ChatId>(),
            chatAccountCount: Schema.integer,
            loudNotificationCount: Schema.integer.min(0),
            isArchived: Schema.boolean,
            latestMessage: Schema.object({
                author: AccountModel.schema,
                createdTime: Schema.date,
                contentTextSnippet: Schema.string,
                isStickyMention: Schema.boolean.default(false),
                clerical: MessageContentPayloadClericalSchema.optional(),
            }),
            otherChatAccount: AccountModel.schema.nullable(),
        }),
    )
    implements InboxEntryModelInterface
{
    public readonly type = "Chat" as const;

    public getKey(): InboxEntryKey {
        return {type: "Chat", chatId: this.chatId};
    }
}

export class InboxPostCommentsEntryModel
    extends Model(
        Schema.object({
            spaceId: Schema.id<SpaceId>(),
            accountId: Schema.id<AccountId>(),
            postId: Schema.id<PostId>(),
            postAuthor: AccountModel.schema,
            channel: Schema.booleanUnion(
                "isPrivate",
                Schema.object({
                    isPrivate: Schema.value(true),
                }),
                Schema.object({
                    isPrivate: Schema.value(false),
                    channel: ChannelPreviewModel.schema(),
                }),
            ),
            loudNotificationCount: Schema.integer.min(0),
            isArchived: Schema.boolean,
            postCreatedTime: Schema.date,
            postContentTextSnippetIfMentioned: Schema.string.nullable(),
            latestComment: Schema.object({
                author: AccountModel.schema,
                createdTime: Schema.date,
                contentTextSnippet: Schema.string,
                isStickyMention: Schema.boolean.default(false),
            }).nullable(),
            otherCommentAuthor: AccountModel.schema.nullable(),
        }),
    )
    implements InboxEntryModelInterface
{
    public readonly type = "PostComments" as const;

    public getKey(): InboxEntryKey {
        return {type: "PostComments", postId: this.postId};
    }
}

export class InboxChannelPostsEntryModel
    extends Model(
        Schema.object({
            spaceId: Schema.id<SpaceId>(),
            accountId: Schema.id<AccountId>(),
            loudNotificationCount: Schema.integer.min(0).max(0),
            isArchived: Schema.boolean,
            channel: Schema.booleanUnion(
                "isPrivate",
                Schema.object({
                    isPrivate: Schema.value(true),
                    channelId: Schema.id<ChannelId>(),
                }),
                Schema.object({
                    isPrivate: Schema.value(false),
                    channel: ChannelPreviewModel.schema(),
                }),
            ),
            bucketGeneration: Schema.integer,
            postAuthorCount: Schema.integer.min(1),
            posts: Schema.map(Schema.id<PostId>(), Schema.object({isArchived: Schema.boolean})),
            latestPost: Schema.object({
                author: AccountModel.schema,
                createdTime: Schema.date,
                contentTextSnippet: Schema.string,
            }),
            otherPostAuthor: AccountModel.schema.nullable(),
        }),
    )
    implements InboxEntryModelInterface
{
    public readonly type = "ChannelPosts" as const;

    public getKey(): InboxEntryKey {
        return {
            type: "ChannelPosts",
            channelId: this.getChannelId(),
            bucketGeneration: this.bucketGeneration,
        };
    }

    public getChannelId(): ChannelId {
        return this.channel.isPrivate ? this.channel.channelId : this.channel.channel.id;
    }
}

export class InboxDocumentCommentThreadEntryModel
    extends Model(
        Schema.object({
            spaceId: Schema.id<SpaceId>(),
            accountId: Schema.id<AccountId>(),
            loudNotificationCount: Schema.integer.min(0),
            isArchived: Schema.boolean,
            document: Schema.booleanUnion(
                "isPrivate",
                Schema.object({
                    isPrivate: Schema.value(true),
                    documentId: Schema.id<DocumentId>(),
                }),
                Schema.object({
                    isPrivate: Schema.value(false),
                    document: DocumentPreviewModel.schema(),
                }),
            ),
            commentThreadId: Schema.id<DocumentCommentThreadId>(),
            firstCommentAuthor: AccountModel.schema,
            latestComment: Schema.object({
                author: AccountModel.schema,
                createdTime: Schema.date,
                contentTextSnippet: Schema.string,
                isStickyMention: Schema.boolean.default(false),
            }),
            otherCommentAuthor: AccountModel.schema.nullable(),
        }),
    )
    implements InboxEntryModelInterface
{
    public readonly type = "DocumentCommentThread" as const;

    public getKey(): InboxEntryKey {
        return {
            type: "DocumentCommentThread",
            documentId: this.document.isPrivate
                ? this.document.documentId
                : this.document.document.id,
            commentThreadId: this.commentThreadId,
        };
    }
}

export class InboxDocumentNewCommentThreadsEntryModel
    extends Model(
        Schema.object({
            spaceId: Schema.id<SpaceId>(),
            accountId: Schema.id<AccountId>(),
            loudNotificationCount: Schema.integer.min(0).max(0),
            isArchived: Schema.boolean,
            document: Schema.booleanUnion(
                "isPrivate",
                Schema.object({
                    isPrivate: Schema.value(true),
                    documentId: Schema.id<DocumentId>(),
                }),
                Schema.object({
                    isPrivate: Schema.value(false),
                    document: DocumentPreviewModel.schema(),
                }),
            ),
            bucketGeneration: Schema.integer,
            commentThreadCount: Schema.integer.min(1),
            commentThreadAuthorCount: Schema.integer.min(1),
            firstComment: Schema.object({
                author: AccountModel.schema,
                createdTime: Schema.date,
                contentTextSnippet: Schema.string,
            }),
            otherCommentThreadAuthor: AccountModel.schema.nullable(),
        }),
    )
    implements InboxEntryModelInterface
{
    public readonly type = "DocumentNewCommentThreads" as const;

    public getKey(): InboxEntryKey {
        return {
            type: "DocumentNewCommentThreads",
            documentId: this.document.isPrivate
                ? this.document.documentId
                : this.document.document.id,
            bucketGeneration: this.bucketGeneration,
        };
    }
}

export class InboxTaskEntryModel
    extends Model(
        Schema.object({
            spaceId: Schema.id<SpaceId>(),
            accountId: Schema.id<AccountId>(),
            task: Schema.booleanUnion(
                "isPrivate",
                Schema.object({
                    isPrivate: Schema.value(true),
                    taskId: Schema.id<TaskId>(),
                }),
                Schema.object({
                    isPrivate: Schema.value(false),
                    taskId: Schema.id<TaskId>(),
                    taskOwner: AccountModel.schema,
                }),
            ),
            loudNotificationCount: Schema.integer.min(0),
            isArchived: Schema.boolean,
            latestComment: Schema.object({
                author: AccountModel.schema,
                createdTime: Schema.date,
                contentTextSnippet: Schema.string,
                isStickyMention: Schema.boolean,
            }),
            otherCommentAuthor: AccountModel.schema.nullable(),
        }),
    )
    implements InboxEntryModelInterface
{
    public readonly type = "Task" as const;

    public getKey(): InboxEntryKey {
        return {type: "Task", taskId: this.task.taskId};
    }
}

export type InboxEntryModel = SchemaType<typeof InboxEntryModelSchema>;

export const InboxEntryModelSchema = createModelUnionSchema({
    InboxChatEntry: InboxChatEntryModel,
    InboxPostCommentsEntry: InboxPostCommentsEntryModel,
    InboxChannelPostsEntry: InboxChannelPostsEntryModel,
    InboxDocumentCommentThreadEntry: InboxDocumentCommentThreadEntryModel,
    InboxDocumentNewCommentThreadsEntry: InboxDocumentNewCommentThreadsEntryModel,
    InboxTaskEntry: InboxTaskEntryModel,
});

export type InboxItemModel = SchemaType<typeof InboxItemModelSchema>;

export const InboxItemModelSchema = createModelUnionSchema({
    Inbox: InboxModel,
    InboxChatEntry: InboxChatEntryModel,
    InboxPostCommentsEntry: InboxPostCommentsEntryModel,
    InboxChannelPostsEntry: InboxChannelPostsEntryModel,
    InboxDocumentCommentThreadEntry: InboxDocumentCommentThreadEntryModel,
    InboxDocumentNewCommentThreadsEntry: InboxDocumentNewCommentThreadsEntryModel,
    InboxTaskEntry: InboxTaskEntryModel,
});
