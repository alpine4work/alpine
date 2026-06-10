import {AvatarModelSchema} from "~/shared/avatar/avatar_schema.js";
import {BotId, SpaceId} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export const BotSchema = Schema.object({
    id: Schema.id<BotId>(),
    createdTime: Schema.date,
    name: Schema.string,
    avatar: AvatarModelSchema.nullable(),
});

export type Bot = SchemaType<typeof BotSchema>;

export const BotForAdminSchema = BotSchema.merge(
    Schema.object({
        webhookUrl: Schema.string.nullable(),
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
