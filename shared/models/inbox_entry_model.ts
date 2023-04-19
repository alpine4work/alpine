import {MessageContentSchema} from "~/shared/content/message_content_schema";
import {ChatId, PostId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
import {Model} from "~/shared/models/model";
import {Schema, SchemaType} from "~/shared/schema/schema";

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

export type InboxEntryModel = InboxChatEntryModel | InboxPostCommentsEntryModel;

export class InboxChatEntryModel extends Model(
    Schema.object({
        chatId: Schema.id<ChatId>(),
        loudNotificationCount: Schema.integer.min(0),
        latestMessage: Schema.object({
            author: AccountModel.schema(),
            createdTime: Schema.date,
            contentSnippet: MessageContentSchema,
        }),
    }),
) {
    public readonly type = "Chat" as const;

    public getKey(): InboxEntryKey {
        return {type: "Chat", chatId: this.chatId};
    }
}

export class InboxPostCommentsEntryModel extends Model(
    Schema.object({
        postId: Schema.id<PostId>(),
        loudNotificationCount: Schema.integer.min(0),
        latestComment: Schema.object({
            author: AccountModel.schema(),
            createdTime: Schema.date,
            contentSnippet: MessageContentSchema,
        }),
    }),
) {
    public readonly type = "PostComments" as const;

    public getKey(): InboxEntryKey {
        return {type: "PostComments", postId: this.postId};
    }
}
