import {createPath, resolvePath} from "react-router";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {DocumentPreviewModel} from "~/shared/documents/document_model.js";
import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
import {convertSpacePathToPeekPath} from "~/shared/remix/peek_path_helpers.js";
import {createModelUnionSchema} from "~/shared/schema/model/create_model_union_schema.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

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
    getSpacePath(): string;
    getPeekPath(): string;
}

function getPeekPath(model: {getSpacePath(): string}) {
    return createPath(assertExists(convertSpacePathToPeekPath(resolvePath(model.getSpacePath()))));
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
                author: AccountModel.schema,
                createdTime: Schema.date,
                contentTextSnippet: Schema.string,
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

    public getSpacePath() {
        return `/s/${this.spaceId}/chat/${this.chatId}`;
    }

    public getPeekPath() {
        return getPeekPath(this);
    }
}

export class InboxPostCommentsEntryModel
    extends Model(
        Schema.object({
            spaceId: Schema.id<SpaceId>(),
            accountId: Schema.id<AccountId>(),
            postId: Schema.id<PostId>(),
            postAuthor: AccountModel.schema,
            channel: ChannelPreviewModel.schema(),
            loudNotificationCount: Schema.integer.min(0),
            postCreatedTime: Schema.date,
            postContentTextSnippetIfMentioned: Schema.string.nullable(),
            latestComment: Schema.object({
                author: AccountModel.schema,
                createdTime: Schema.date,
                contentTextSnippet: Schema.string,
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

    public getSpacePath() {
        return `/s/${this.spaceId}/posts/${this.postId}`;
    }

    public getPeekPath() {
        return getPeekPath(this);
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
            channelId: this.channel.id,
            bucketGeneration: this.bucketGeneration,
        };
    }

    public getSpacePath() {
        return `/s/${this.spaceId}/notifications/channel-posts/${this.channel.id}-${this.bucketGeneration}`;
    }

    public getPeekPath() {
        return getPeekPath(this);
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
            firstCommentAuthor: AccountModel.schema,
            latestComment: Schema.object({
                author: AccountModel.schema,
                createdTime: Schema.date,
                contentTextSnippet: Schema.string,
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
            documentId: this.document.id,
            commentThreadId: this.commentThreadId,
        };
    }

    public getSpacePath() {
        return `/s/${this.spaceId}/documents/${this.document.id}/comments/${this.commentThreadId}`;
    }

    public getPeekPath() {
        return getPeekPath(this);
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
            documentId: this.document.id,
            bucketGeneration: this.bucketGeneration,
        };
    }

    public getSpacePath() {
        return `/s/${this.spaceId}/notifications/document-comment-threads/${this.document.id}-${this.bucketGeneration}`;
    }

    public getPeekPath() {
        return getPeekPath(this);
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
