import {MessageContentSchema} from "~/shared/content/message_content_schema";
import {SimpleChatId, SpaceId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
import {MessageInterface} from "~/shared/models/message_interface";
import {Model} from "~/shared/models/model";
import {Schema} from "~/shared/schema/schema";

export class SimpleChatModel extends Model(
    Schema.object({
        id: Schema.id<SimpleChatId>(),
        spaceId: Schema.id<SpaceId>(),
        messageCount: Schema.integer,
    }),
) {}

export class SimpleChatMessageModel
    extends Model(
        Schema.object({
            simpleChatId: Schema.id<SimpleChatId>(),
            id: Schema.integer,
            author: AccountModel.schema(),
            createdTime: Schema.date,
            parentMessageId: Schema.integer.nullable(),
            content: MessageContentSchema,
            contentUpdatedTime: Schema.date.nullable(),
        }),
    )
    implements MessageInterface
{
    public getRoomKey(): string {
        return this.simpleChatId;
    }
}
