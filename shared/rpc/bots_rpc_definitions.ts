import {BotSchema, BotWebhookSchema} from "~/shared/bots/bot_schema.js";
import {BotTokenScope} from "~/shared/bots/bot_token_scope.js";
import {BotOwnerEntityIdSchema} from "~/shared/bots/owners/bot_owner_entity.js";
import {AvatarId} from "~/shared/id/types/id_types.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {IdentifierStringSchema} from "~/shared/schema/helpers/identifier_string_schema.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema} from "~/shared/schema/schema.js";

export const createBot = defineRpc({
    name: "createBot",
    isIdempotent: false,
    input: {
        name: LabelStringSchema,
        description: Schema.string.nullable().optional(),
        webhook: BotWebhookSchema.nullable(),
        ownerEntity: BotOwnerEntityIdSchema,
        spaceId: Schema.id<SpaceId>().optional(),
    },
    output: {
        botId: Schema.id<BotId>(),
    },
});

export const deleteBot = defineRpc({
    name: "deleteBot",
    isIdempotent: true,
    input: {
        botId: Schema.id<BotId>(),
    },
    output: {},
});

export const updateBot = defineRpc({
    name: "updateBot",
    isIdempotent: true,
    input: {
        botId: Schema.id<BotId>(),
        name: LabelStringSchema,
        description: Schema.string.nullable().optional(),
        webhook: Schema.object({
            url: Schema.string,
            secret: Schema.string.nullable().optional(),
        }).nullable(),
    },
    output: {},
});

export const createUnscopedApiKeyForBot = defineRpc({
    name: "createUnscopedApiKeyForBot",
    isIdempotent: false,
    input: {
        botId: Schema.id<BotId>(),
        name: LabelStringSchema.nullable(),
    },
    output: {
        apiKey: Schema.string,
    },
});

export const createScopedApiKeyForBot = defineRpc({
    name: "createScopedApiKeyForBot",
    isIdempotent: false,
    input: {
        botId: Schema.id<BotId>(),
        spaceId: Schema.id<SpaceId>(),
        name: LabelStringSchema.nullable(),
        scope: Schema.unknown<BotTokenScope>(),
    },
    output: {
        apiKey: Schema.string,
        scope: Schema.unknown<BotTokenScope>(),
    },
});

export const deleteApiKeyForBot = defineRpc({
    name: "deleteApiKeyForBot",
    isIdempotent: true,
    input: {
        botId: Schema.id<BotId>(),
        apiKey: Schema.string,
    },
    output: {},
});

export const rotateApiKeyForBot = defineRpc({
    name: "rotateApiKeyForBot",
    // Each call mints a brand new random `apiKey` via `generateApiKey()` and returns
    // it, so repeated calls with the same input produce different outputs. A retry
    // also can't converge because the first call deletes the original key, so the
    // second call will throw a `NotFoundError`.
    isIdempotent: false,
    input: {
        botId: Schema.id<BotId>(),
        apiKey: Schema.string,
    },
    output: {
        apiKey: Schema.string,
    },
});

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

export const getBotAccountIdForSpaceIfExists = defineRpc({
    name: "getBotAccountIdForSpaceIfExists",
    isIdempotent: true,
    input: {
        botId: Schema.id<BotId>(),
        spaceId: Schema.id<SpaceId>(),
    },
    output: {
        accountId: Schema.id<AccountId>().nullable(),
    },
});
