import {AccessPolicyModel} from "~/shared/access/model/access_policy_model.js";
import {ChatId, SpaceId} from "~/shared/id/types/id_types.js";
import {MessageModel, MessagePayloadModelSchema} from "~/shared/messaging/message_model.js";
import {MessageStreamSchema} from "~/shared/messaging/message_schema.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export type ChatModelDefinition = SchemaType<typeof ChatModelDefinitionSchema>;

export const ChatModelDefinitionSchema = Schema.union({
    Direct: Schema.object({
        type: Schema.value("Direct"),
        accounts: Schema.array(AccountModel.schema),
    }),
    Room: Schema.object({
        type: Schema.value("Room"),
        name: LabelStringSchema,
        accessPolicy: AccessPolicyModel.schema,
        previewAccounts: Schema.array(AccountModel.schema).minLength(1).maxLength(2),
    }),
});

/**
 * A chat history between some accounts in a space.
 */
export class ChatModel extends Model(
    Schema.object({
        id: Schema.id<ChatId>(),
        version: Schema.integer,
        spaceId: Schema.id<SpaceId>(),
        createdTime: Schema.date,
        definition: ChatModelDefinitionSchema.wrapOriginalPropertyInUnionVariant(
            "Direct",
            "accounts",
            {},
        ).originalPropertyKey("accounts"),
        messageCount: Schema.integer,
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
            createdTimeZone: TimeZoneSchema,
            payload: MessagePayloadModelSchema,
            stream: MessageStreamSchema.nullable(),
        }),
    )
    implements MessageModel<ChatId>
{
    // Make sure this property is available on this type and not just the interface.
    public readonly isOptimistic?: undefined;

    public getRoomKey() {
        return this.chatId;
    }

    public getSeeReactionsUrl(
        spaceId: SpaceId,
        contentVersion: number,
        pos: number | "Files",
    ): string {
        const baseUrl = `/chat/${this.chatId}/message/${this.index}/reactions`;
        const at = pos === "Files" ? "files" : `${pos}@${contentVersion}`;
        return `${baseUrl}?at=${at}`;
    }
}
