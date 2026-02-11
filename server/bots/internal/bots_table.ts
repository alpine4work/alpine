import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {BotTokenPayloadScope} from "~/server/tokens/token_payload.js";
import {AvatarSchema} from "~/shared/avatar/avatar_schema.js";
import {BotSettingsSchemaSchema} from "~/shared/bots/bot_settings_schema.js";
import {SimpleContentSchema} from "~/shared/content/simple_content_schema.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {ApiKey} from "~/shared/id/api_key.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.js";
import {IdentifierStringSchema} from "~/shared/schema/helpers/identifier_string_schema.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema} from "~/shared/schema/schema.js";

export const BotsTable = DynamoTableSchema.new({
    name: "Bots",
    partitions: [
        {
            name: "Bot",
            partitionKeyAttributes: {
                botId: DynamoKeyAttributeSchema.id<BotId>(),
            },
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        /**
                         * When was the bot created?
                         */
                        createdTime: Schema.date,

                        /**
                         * Name of the bot. This name will be used for all of the bot's accounts.
                         */
                        name: Schema.string,

                        /**
                         * When the bot is mentioned, send an event to this webhook.
                         *
                         * Bot webhooks should be null when the bot is "uni-directional". A
                         * good example of a uni-directional bot is our "Alerts" bot, whose
                         * sole function is to send alerts into Alpine - it should never listen
                         * to Alpine events.
                         */
                        webhookUrl: Schema.string.nullable(),
                    }),
                },

                /**
                 * The avatar for the bot. For normal (non-bot) accounts, the Avatar is stored with
                 * the Account data in the Accounts table, because Accounts are space-agnostic.
                 *
                 * Bots are a little different. The Bot item in the Bots table is space-agnostic,
                 * but the Account item for a bot is space dependent. Data that is singular and
                 * unique to a bot should be defined here within the Bot table (name, avatar,
                 * etc.). This means that the Bot table is the source of truth for bot data.
                 *
                 * Bot Account items will be eventually consistent with the data in the Bot table.
                 */
                {
                    name: "Avatar",
                    sortKeyAttributes: {},
                    attributes: AvatarSchema,
                },

                /**
                 * Settings for the bot to be rendered in the bot settings page before the user
                 * chooses to instantiate the bot in their space.
                 */
                {
                    name: "SettingsSchema",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        /**
                         * A description of the bot to render in the bot settings page.
                         */
                        description: SimpleContentSchema,

                        /**
                         * Schema for the bot's space-specific and account-specific settings. We
                         * render inputs on the bot settings page for each of these settings. The
                         * bot has access to its settings through the API.
                         */
                        schema: BotSettingsSchemaSchema.default({properties: emptyMap}),
                    }),
                },
            ],
        },
        {
            name: "ApiKey",
            partitionKeyAttributes: {
                apiKey: DynamoKeyAttributeSchema.labelString<ApiKey>(),
            },
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        /**
                         * What bot does the API key grant access to?
                         */
                        botId: Schema.id<BotId>(),

                        /**
                         * The `SpaceId` this token is scoped to. Or if null then this is an unscoped
                         * token. If `spaceId` is non-null then `space` is also non-null.
                         *
                         * There are two types of API keys:
                         *
                         * - Scoped: API keys that are scoped to some resource in an individual space.
                         *   Individual developers at companies typically use these API keys. The API
                         *   key can't access anything outside of the space.
                         *
                         * - Unscoped: API keys that aren't associated with any resource. To use
                         *   unscoped API keys you need an access token that provides a scope.
                         *   Integration authors use unscoped API keys and they get an access tokens
                         *   when called from a bot webhook.
                         *
                         *   I'm also imagining we have an API endpoint called `/request-access-token`
                         *   or something that returns an access token for an unscoped API key. This
                         *   forces integrators to take basic security measures to make sure they're
                         *   only requesting data from one space at a time.
                         */
                        spaceId: Schema.id<SpaceId>().nullable(),

                        /**
                         * See the comment on `spaceId` for more information.
                         *
                         * Ideally `spaceId` would be inside this object but we don't currently support
                         * indexing nested properties so we have to keep `spaceId` outside.
                         */
                        space: Schema.object({
                            accountId: Schema.id<AccountId>(),
                            scope: Schema.unknown<BotTokenPayloadScope>(),
                        }).nullable(),

                        /**
                         * When was the API key created?
                         */
                        createdTime: Schema.date,

                        /**
                         * What is the API key used for?
                         */
                        name: LabelStringSchema.nullable().default(null),
                    }).validation(
                        "If `spaceId` is non-null then `space` is also non-null",
                        item => (item.spaceId === null) === (item.space === null),
                    ),
                },
            ],
        },
        {
            name: "Space",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
            },
            sortRanges: [
                {
                    name: "BotSettingsValues",
                    sortKeyAttributes: {
                        botId: DynamoKeyAttributeSchema.id<BotId>(),
                    },
                    attributes: Schema.object({
                        /**
                         * The dynamic space settings values for the bot that match the structure from
                         * `schema`.
                         */
                        values: Schema.map(IdentifierStringSchema, Schema.unknown()),
                    }),
                },
                {
                    name: "AccountBotSettingsValues",
                    sortKeyAttributes: {
                        botId: DynamoKeyAttributeSchema.id<BotId>(),
                        accountId: DynamoKeyAttributeSchema.id<AccountId>(),
                    },
                    attributes: Schema.object({
                        /**
                         * The dynamic account settings values for the bot that match the structure
                         * from `schema`.
                         */
                        values: Schema.map(IdentifierStringSchema, Schema.unknown()),
                    }),
                },
            ],
        },
    ],
});

export type BotItem = DynamoTableItemType<typeof BotsTable, "Bot", "Attributes">;
export type BotAvatarItem = DynamoTableItemType<typeof BotsTable, "Bot", "Avatar">;
export type BotSettingsSchemaItem = DynamoTableItemType<typeof BotsTable, "Bot", "SettingsSchema">;

export type BotWithAvatarItem = {
    readonly id: BotId;
    readonly name: string;
    readonly hasWebhookUrl: boolean;
    readonly avatar: BotAvatarItem | null;
};

// NOTE(calebmer, 2025-08-21): We don't currently use this index but something
// we'll definitely someday is the ability to list all of a bot's API keys.
// Since it's hard to add an index to an existing table right now, we're
// setting up this index on table creation.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const BotApiKeysIndex = BotsTable.addIndex({
    name: "BotApiKeys",
    itemTypes: [{partitionType: "ApiKey", sortRangeType: "Attributes"}],
    partitionKeyAttributes: {
        botId: DynamoKeyAttributeSchema.id<BotId>(),
    },
    sortKeyAttributes: {
        spaceId: DynamoKeyAttributeSchema.id<SpaceId>().nullable(),
    },
});
