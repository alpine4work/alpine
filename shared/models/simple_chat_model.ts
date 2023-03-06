import {SimpleChatId, SpaceId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
import {MessageModel, MessagePayloadModelSchema} from "~/shared/models/message_model";
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
            index: Schema.integer,
            author: AccountModel.schema(),
            createdTime: Schema.date,
            payload: MessagePayloadModelSchema,
        }),
    )
    implements MessageModel<SimpleChatId>
{
    public getRoomKey() {
        return this.simpleChatId;
    }
}
