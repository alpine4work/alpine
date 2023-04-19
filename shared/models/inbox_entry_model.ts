import {MessageContentSchema} from "~/shared/content/message_content_schema";
import {ChatId, PostId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
import {Model} from "~/shared/models/model";
import {Schema} from "~/shared/schema/schema";

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
}
