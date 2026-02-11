import {BotSchema} from "~/shared/bots/bot_schema.js";
import {AccountId, AvatarId, BotId, SpaceId} from "~/shared/id/types/id_types.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {IdentifierStringSchema} from "~/shared/schema/helpers/identifier_string_schema.js";
import {Schema} from "~/shared/schema/schema.js";

export const finishUploadingBotAvatar = defineRpc({
    name: "finishUploadingBotAvatar",
    isIdempotent: true,
    input: {
        avatarContent: Schema.bytes,
        avatarId: Schema.id<AvatarId>(),
        botId: Schema.id<BotId>(),
    },
    output: {
        bot: BotSchema,
    },
});

export const updateBotSpaceSettingsPropertyValue = defineRpc({
    name: "updateBotSpaceSettingsPropertyValue",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        botId: Schema.id<BotId>(),
        propertyKey: IdentifierStringSchema,
        propertyValue: Schema.unknown(),
    },
    output: {
        valuesVersion: Schema.integer,
        values: Schema.map(Schema.string, Schema.unknown()),
        secretPropertyKeysWithValues: Schema.set(Schema.string),
    },
});

export const updateBotSpaceAccountSettingsPropertyValue = defineRpc({
    name: "updateBotSpaceAccountSettingsPropertyValue",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        botId: Schema.id<BotId>(),
        accountId: Schema.id<AccountId>(),
        propertyKey: IdentifierStringSchema,
        propertyValue: Schema.unknown(),
    },
    output: {
        valuesVersion: Schema.integer,
        values: Schema.map(Schema.string, Schema.unknown()),
    },
});
