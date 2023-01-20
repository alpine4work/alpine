import {MessageContentSchema} from "~/shared/content/message_content_schema";
import {AccountModel} from "~/shared/models/account_model";
import {MessageInterface} from "~/shared/models/message_interface";
import {Model} from "~/shared/models/model";
import {Schema} from "~/shared/schema/schema";

export class SimpleChatMessageModel
    extends Model(
        Schema.object({
            id: Schema.integer,
            author: AccountModel.schema(),
            createdTime: Schema.date,
            parentMessageId: Schema.integer.nullable(),
            content: MessageContentSchema,
            contentUpdatedTime: Schema.date.nullable(),
        }),
    )
    implements MessageInterface {}
