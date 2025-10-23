import {ChatId, SpaceId} from "~/shared/id/types/id_types.js";
import {MessageModel, MessagePayloadModelSchema} from "~/shared/messaging/message_model.js";
import {MessageStreamSchema} from "~/shared/messaging/message_schema.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

/**
 * A chat history between some accounts in a space.
 */
export class ChatModel extends Model(
    Schema.object({
        id: Schema.id<ChatId>(),
        spaceId: Schema.id<SpaceId>(),
        createdTime: Schema.date,
        messageCount: Schema.integer,
        accounts: Schema.array(AccountModel.schema),
    }),
) {}

/**
 * A message in a chat room.
 */
export class ChatMessageModel
    extends Model(
        Schema.object({
            chatId: Schema.id<ChatId>(),
            index: Schema.integer,
            version: Schema.integer,
            author: AccountModel.schema,
            createdTime: Schema.date,
            payload: MessagePayloadModelSchema,
            stream: MessageStreamSchema.nullable(),
        }),
    )
    implements MessageModel<ChatId>
{
    // Make sure this property is available on this type and not just the
    // interface.
    public readonly isOptimistic?: undefined;

    public getRoomKey() {
        return this.chatId;
    }
}
