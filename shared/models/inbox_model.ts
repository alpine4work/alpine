import {To} from "history";
import {AccountId, ChatId, PostId, SpaceId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
import {ChannelPreviewModel} from "~/shared/models/channel_model";
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

export const InboxEntryKeySchema = Schema.union({
    Chat: InboxChatEntryKeySchema,
    PostComments: InboxPostCommentsEntryKeySchema,
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

export type InboxEntryModel = SchemaType<typeof InboxEntryModelSchema>;

export const InboxEntryModelSchema = createModelUnionSchema({
    InboxChatEntry: InboxChatEntryModel,
    InboxPostCommentsEntry: InboxPostCommentsEntryModel,
});

export type InboxItemModel = SchemaType<typeof InboxItemModelSchema>;

export const InboxItemModelSchema = createModelUnionSchema({
    Inbox: InboxModel,
    InboxChatEntry: InboxChatEntryModel,
    InboxPostCommentsEntry: InboxPostCommentsEntryModel,
});
