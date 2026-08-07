import {AvatarModelSchema} from "~/shared/avatar/avatar_schema.js";
import {BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.open_source.js";

export const BotWebhookSchema = Schema.object({
    url: Schema.string,
    secret: Schema.string.nullable(),
});
export type BotWebhook = SchemaType<typeof BotWebhookSchema>;

export const BotWebhookForAdminSchema = Schema.object({
    url: Schema.string.nullable(),
    hasSecret: Schema.boolean,
});

export const BotSchema = Schema.object({
    id: Schema.id<BotId>(),
    createdTime: Schema.date,
    name: Schema.string,
    avatar: AvatarModelSchema.nullable(),
});

export type Bot = SchemaType<typeof BotSchema>;

export const BotForAdminSchema = BotSchema.merge(
    Schema.object({
        webhook: BotWebhookForAdminSchema,
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
export type BotForAdmin = SchemaType<typeof BotForAdminSchema>;
