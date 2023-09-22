import {AccountModel} from "~/shared/accounts/account_model.js";
import {ChatId, SpaceId} from "~/shared/id/types/id_types.js";
import {MessageModel, MessagePayloadModelSchema} from "~/shared/messaging/message_model.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * A chat history between some accounts in a space.
 */
export class ChatModel extends Model(
    Schema.object({
        id: Schema.id<ChatId>(),
        spaceId: Schema.id<SpaceId>(),
        createdTime: Schema.date,
        messageCount: Schema.integer,
        lastMessageChangeTime: Schema.date.nullable(),
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
            author: AccountModel.schema,
            createdTime: Schema.date,
            payload: MessagePayloadModelSchema,
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
