import {MessageContentSchema} from "~/shared/content/message_content_schema";
import {AccountModel} from "~/shared/models/account_model";
import {Model} from "~/shared/models/model";
import {Schema} from "~/shared/schema/schema";

export type InboxEntryModel = InboxChatEntryModel | InboxPostCommentsEntryModel;

export class InboxChatEntryModel extends Model(
    Schema.object({
        type: Schema.value("Chat"),
        loudNotificationCount: Schema.integer.min(0),
        latestMessage: Schema.object({
            author: AccountModel.schema(),
            createdTime: Schema.date,
            contentSnippet: MessageContentSchema,
        }),
    }),
) {}

export class InboxPostCommentsEntryModel extends Model(
    Schema.object({
        type: Schema.value("PostComments"),
        loudNotificationCount: Schema.integer.min(0),
        latestComment: Schema.object({
            author: AccountModel.schema(),
            createdTime: Schema.date,
            contentSnippet: MessageContentSchema,
        }),
    }),
) {}
