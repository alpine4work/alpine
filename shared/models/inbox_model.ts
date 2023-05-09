import {To} from "history";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    SpaceId,
} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
import {ChannelPreviewModel} from "~/shared/models/channel_model";
import {DocumentPreviewModel} from "~/shared/models/document_model";
import {createModelUnionSchema} from "~/shared/models/helpers/create_model_union_schema";
import {MessageContentWithReferencesSchema} from "~/shared/models/message_model";
import {Model} from "~/shared/models/model";
import {PostContentWithReferencesSchema} from "~/shared/models/post_model";
import {Schema, SchemaType} from "~/shared/schema/schema";

export class InboxModel extends Model(
    Schema.object({
        spaceId: Schema.id<SpaceId>(),
        accountId: Schema.id<AccountId>(),
        loudNotificationCount: Schema.integer.min(0),
        entryCount: Schema.integer.min(0),
        lastZeroEntryCountTime: Schema.date.nullable(),
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

export const InboxEntryKeySchema = Schema.union({
    Chat: InboxChatEntryKeySchema,
    PostComments: InboxPostCommentsEntryKeySchema,
    ChannelPosts: InboxChannelPostsEntryKeySchema,
    DocumentCommentThread: InboxDocumentCommentThreadEntryKeySchema,
    DocumentNewCommentThreads: InboxDocumentNewCommentThreadsEntryKeySchema,
});

interface InboxEntryModelInterface {
    readonly type: string;
    getKey(): InboxEntryKey;
    getPath(): To;
}

export class InboxChatEntryModel
    extends Model(
        Schema.object({
            spaceId: Schema.id<SpaceId>(),
            accountId: Schema.id<AccountId>(),
            chatId: Schema.id<ChatId>(),
            chatAccountCount: Schema.integer,
            loudNotificationCount: Schema.integer.min(0),
            latestMessage: Schema.object({
                author: AccountModel.schema(),
                createdTime: Schema.date,
                contentSnippet: MessageContentWithReferencesSchema,
            }),
            otherChatAccount: AccountModel.schema().nullable(),
        }),
    )
    implements InboxEntryModelInterface
{
    public readonly type = "Chat" as const;

    public getKey(): InboxEntryKey {
        return {type: "Chat", chatId: this.chatId};
    }

    public getPath(): To {
        return `/s/${this.spaceId}/chat/${this.chatId}`;
    }
}

export class InboxPostCommentsEntryModel
    extends Model(
        Schema.object({
            spaceId: Schema.id<SpaceId>(),
            accountId: Schema.id<AccountId>(),
            postId: Schema.id<PostId>(),
            postAuthor: AccountModel.schema(),
            channel: ChannelPreviewModel.schema(),
            loudNotificationCount: Schema.integer.min(0),
            postCreatedTime: Schema.date,
            postContentSnippetIfMentioned: PostContentWithReferencesSchema.nullable(),
            latestComment: Schema.object({
                author: AccountModel.schema(),
                createdTime: Schema.date,
                contentSnippet: MessageContentWithReferencesSchema,
            }).nullable(),
            otherCommentAuthor: AccountModel.schema().nullable(),
        }),
    )
    implements InboxEntryModelInterface
{
    public readonly type = "PostComments" as const;

    public getKey(): InboxEntryKey {
        return {type: "PostComments", postId: this.postId};
    }

    public getPath(): To {
        return `/s/${this.spaceId}/posts/${this.postId}`;
    }
}

export class InboxChannelPostsEntryModel
    extends Model(
        Schema.object({
            spaceId: Schema.id<SpaceId>(),
            accountId: Schema.id<AccountId>(),
            loudNotificationCount: Schema.integer.min(0).max(0),
            channel: ChannelPreviewModel.schema(),
            bucketGeneration: Schema.integer,
            postCount: Schema.integer.min(1),
            postAuthorCount: Schema.integer.min(1),
            latestPost: Schema.object({
                author: AccountModel.schema(),
                createdTime: Schema.date,
                contentSnippet: PostContentWithReferencesSchema,
            }),
            otherPostAuthor: AccountModel.schema().nullable(),
        }),
    )
    implements InboxEntryModelInterface
{
    public readonly type = "ChannelPosts" as const;

    public getKey(): InboxEntryKey {
        return {
            type: "ChannelPosts",
            channelId: this.channel.id,
            bucketGeneration: this.bucketGeneration,
        };
    }

    public getPath(): To {
        return `/s/${this.spaceId}/notifications/channel-posts/${this.channel.id}-${this.bucketGeneration}`;
    }
}

export class InboxDocumentCommentThreadEntryModel
    extends Model(
        Schema.object({
            spaceId: Schema.id<SpaceId>(),
            accountId: Schema.id<AccountId>(),
            loudNotificationCount: Schema.integer.min(0),
            document: DocumentPreviewModel.schema(),
            commentThreadId: Schema.id<DocumentCommentThreadId>(),
            firstCommentAuthor: AccountModel.schema(),
            latestComment: Schema.object({
                author: AccountModel.schema(),
                createdTime: Schema.date,
                contentSnippet: MessageContentWithReferencesSchema,
            }),
            otherCommentAuthor: AccountModel.schema().nullable(),
        }),
    )
    implements InboxEntryModelInterface
{
    public readonly type = "DocumentCommentThread" as const;

    public getKey(): InboxEntryKey {
        return {
            type: "DocumentCommentThread",
            documentId: this.document.id,
            commentThreadId: this.commentThreadId,
        };
    }

    public getPath(): To {
        // NOCOMMIT
        return "/s/ywcffewdn377x442nkxd5x41r0/notifications/channel-posts/qk8jepk9epmb48b3fbaykw4vk0-1490";
    }
}

export class InboxDocumentNewCommentThreadsEntryModel
    extends Model(
        Schema.object({
            spaceId: Schema.id<SpaceId>(),
            accountId: Schema.id<AccountId>(),
            loudNotificationCount: Schema.integer.min(0).max(0),
            document: DocumentPreviewModel.schema(),
            bucketGeneration: Schema.integer,
            commentThreadCount: Schema.integer.min(1),
            commentThreadAuthorCount: Schema.integer.min(1),
            firstComment: Schema.object({
                author: AccountModel.schema(),
                createdTime: Schema.date,
                contentSnippet: MessageContentWithReferencesSchema,
            }),
            otherCommentThreadAuthor: AccountModel.schema().nullable(),
        }),
    )
    implements InboxEntryModelInterface
{
    public readonly type = "DocumentNewCommentThreads" as const;

    public getKey(): InboxEntryKey {
        return {
            type: "DocumentNewCommentThreads",
            documentId: this.document.id,
            bucketGeneration: this.bucketGeneration,
        };
    }

    public getPath(): To {
        // NOCOMMIT
        return "/s/ywcffewdn377x442nkxd5x41r0/notifications/channel-posts/qk8jepk9epmb48b3fbaykw4vk0-1490";
    }
}

export type InboxEntryModel = SchemaType<typeof InboxEntryModelSchema>;

export const InboxEntryModelSchema = createModelUnionSchema({
    InboxChatEntry: InboxChatEntryModel,
    InboxPostCommentsEntry: InboxPostCommentsEntryModel,
    InboxChannelPostsEntry: InboxChannelPostsEntryModel,
    InboxDocumentCommentThreadEntry: InboxDocumentCommentThreadEntryModel,
    InboxDocumentNewCommentThreadsEntry: InboxDocumentNewCommentThreadsEntryModel,
});

export type InboxItemModel = SchemaType<typeof InboxItemModelSchema>;

export const InboxItemModelSchema = createModelUnionSchema({
    Inbox: InboxModel,
    InboxChatEntry: InboxChatEntryModel,
    InboxPostCommentsEntry: InboxPostCommentsEntryModel,
    InboxChannelPostsEntry: InboxChannelPostsEntryModel,
    InboxDocumentCommentThreadEntry: InboxDocumentCommentThreadEntryModel,
    InboxDocumentNewCommentThreadsEntry: InboxDocumentNewCommentThreadsEntryModel,
});
