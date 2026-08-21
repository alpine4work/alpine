import {AvatarModelSchema} from "~/shared/avatar/avatar_schema.js";
import {BotOwnerEntitySchema} from "~/shared/bots/owners/bot_owner_entity.js";
import {BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export const BotWebhookSchema = Schema.object({
    url: Schema.string,
    secret: Schema.string.nullable(),
});
export type BotWebhook = SchemaType<typeof BotWebhookSchema>;

export const BotSchema = Schema.object({
    id: Schema.id<BotId>(),
    createdTime: Schema.date,

    /**
     * The entity that owns and manages the bot. `System` for a global bot that isn't
     * owned by anyone in particular.
     */
    ownerEntity: BotOwnerEntitySchema.default({type: "System"}),

    name: Schema.string,
    description: Schema.string.nullable(),
    avatar: AvatarModelSchema.nullable(),
});

export type Bot = SchemaType<typeof BotSchema>;

export const BotSecretsSchema = BotSchema.merge(
    Schema.object({
        webhook: BotWebhookSchema.nullable(),
        apiKeys: Schema.array(
            Schema.object({
                apiKey: Schema.string,
                name: LabelStringSchema.nullable(),
                spaceId: Schema.id<SpaceId>().nullable(),
                scope: Schema.unknown().nullable(),
            }),
        ),
    }),
);
export type BotSecrets = SchemaType<typeof BotSecretsSchema>;
