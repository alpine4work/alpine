import {isBotItemDeleted} from "~/server/bots/internal/is_bot_item_deleted.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {AvatarSchema} from "~/shared/avatar/avatar_schema.js";
import {BotWebhook, BotWebhookSchema} from "~/shared/bots/bot_schema.js";
import {BotSettingsSchemaSchema} from "~/shared/bots/bot_settings_schema.js";
import {BotTokenScope} from "~/shared/bots/bot_token_scope.js";
import {BotOwnerEntityId, BotOwnerEntityIdSchema} from "~/shared/bots/owners/bot_owner_entity.js";
import {SimpleContentSchema} from "~/shared/content/simple_content_schema.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.open_source.js";
import {ApiKey} from "~/shared/id/api_key.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
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
                         * When was the bot last updated?
                         */
                        updatedTime: Schema.date.optional(),

                        // TODO(#migrate-bot-owners): Temporarily nullable for backwards compatibility with
                        // bots created before this field was added. Make it non-nullable once
                        // `runBackfillBotOwnerAndCreatorMigration()` has run against production.
                        /**
                         * The account that created the bot. Used for auditing purposes.
                         */
                        createdByAccount: Schema.id<AccountId>().nullable().default(null),

                        /**
                         * Information about when this bot was soft-deleted and by whom. If this is null
                         * then the bot is active. We keep a record of deleted bots so their accounts can
                         * still be referenced by old content while they're cleaned up.
                         *
                         * Matches the shape documents use for soft deletion (see `documents_table.ts`).
                         */
                        deleted: Schema.object({
                            time: Schema.date,
                            deletor: Schema.object({
                                /**
                                 * The account that soft-deleted this bot.
                                 */
                                id: Schema.id<AccountId>().nullable().default(null),

                                /**
                                 * What soft-deleted this bot on behalf of the account ID, if anything.
                                 */
                                from: Schema.union({
                                    Bot: Schema.object({
                                        type: Schema.value("Bot"),
                                        accountId: Schema.id<AccountId>(),
                                    }),
                                })
                                    .nullable()
                                    .default(null),
                            }),
                        })
                            .nullable()
                            .default(null),

                        /**
                         * When this bot was soft-deleted, duplicating `deleted.time`, because the
                         * `BotsByOwner` index is `KEYS_ONLY`: it can only filter on attributes that are
                         * part of the index key, and an index key can't be a nested property.
                         *
                         * Always write this in the same update as `deleted` so the two can't drift. Read
                         * it through `isBotItemDeleted()` rather than directly.
                         */
                        isDeleted: Schema.date.nullable().default(null),

                        /**
                         * Name of the bot. This name will be used for all of the bot's accounts.
                         */
                        name: Schema.string,

                        /**
                         * The entity that owns and manages the bot.
                         *
                         * `System` for a global/system bot that Alpine manages and that isn't owned by any
                         * one entity. Bots created before ownership existed also read back as `System`
                         * (hence the `.default("System")`), so they're treated as global bots.
                         *
                         * TODO(#migrate-bot-owners): Give the bots that predate ownership their real owner
                         * with `runBackfillBotOwnerAndCreatorMigration()` and drop the default. Until that
                         * runs, a personal bot we created for someone reads back as a system bot, so only
                         * internal users can manage it.
                         */
                        ownerEntity: BotOwnerEntityIdSchema.default("System"),

                        /**
                         * When the bot is mentioned, send an event to this webhook.
                         *
                         * Bot webhook URLs should be null when the bot is "uni-directional". A good
                         * example of a uni-directional bot is our "Alerts" bot, whose sole function is to
                         * send alerts into Alpine - it should never listen to Alpine events.
                         *
                         * `secret` is a shared secret used to sign outbound webhook payloads. It is
                         * nullable for bots that do not need request signing.
                         */
                        webhook: BotWebhookSchema.wrapOriginalPropertyInObject("url", {
                            secret: null,
                        })
                            .originalPropertyKey("webhookUrl")
                            .nullable(),

                        /**
                         * How many API keys the bot has right now.
                         *
                         * The count lives here, on the item every API key write already locks with
                         * `updateLockVersion`, so `maxApiKeyCountPerBot` can be enforced exactly. Counting
                         * `BotApiKeysIndex` instead doesn't work: it's a GSI, so it's eventually
                         * consistent and can miss a key written moments ago.
                         *
                         * Only written by `getBotApiKeyWriteLockTransactionEntry()` and by bot deletion,
                         * always in the same transaction as the keys it accounts for.
                         *
                         * TODO(#migrate-bot-owners): Bot items written before this field existed read back
                         * as zero however many keys they actually have.
                         * `runBackfillBotOwnerAndCreatorMigration()` counts their keys and writes a real
                         * number. Drop the default once it has run against production.
                         */
                        apiKeyCount: Schema.integer.default(0),
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
                         * The bot's description, rendered on the bot settings page.
                         */
                        description: SimpleContentSchema,

                        /**
                         * Schema for the bot's space-specific and account-specific settings. We render
                         * inputs on the bot settings page for each of these settings. The bot has access
                         * to its settings through the API.
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
                         *   Individual developers at companies typically use these API keys. The API key
                         *   can't access anything outside of the space.
                         *
                         * - Unscoped: API keys that aren't associated with any resource. To use unscoped
                         *   API keys you need an access token that provides a scope. Integration authors
                         *   use unscoped API keys and they get an access tokens when called from a bot
                         *   webhook.
                         *
                         *     I'm also imagining we have an API endpoint called `/request-access-token` or
                         *     something that returns an access token for an unscoped API key. This forces
                         *     integrators to take basic security measures to make sure they're only
                         *     requesting data from one space at a time.
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
                            scope: Schema.unknown<BotTokenScope>(),
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
                         * The dynamic account settings values for the bot that match the structure from
                         * `schema`.
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
    readonly createdTime: Date;
    readonly ownerEntity: BotOwnerEntityId;
    readonly name: string;
    readonly description: string | null;
    readonly webhook: BotWebhook | null;
    readonly avatar: BotAvatarItem | null;
};

export const BotApiKeysIndex = BotsTable.addIndex({
    name: "BotApiKeys",
    itemTypes: [{partitionType: "ApiKey", sortRangeType: "Attributes"}],
    partitionKeyAttributes: {
        botId: DynamoKeyAttributeSchema.id<BotId>(),
    },
    sortKeyAttributes: {
        spaceId: DynamoKeyAttributeSchema.id<SpaceId>().nullable(),
    },
});

export const BotsByOwnerIndex = BotsTable.addIndex({
    name: "BotsByOwner",
    itemTypes: [{partitionType: "Bot", sortRangeType: "Attributes"}],
    partitionKeyAttributes: {
        ownerEntity: DynamoKeyAttributeSchema.labelString<BotOwnerEntityId>(),
    },
    sortKeyAttributes: {
        name: DynamoKeyAttributeSchema.labelString<string>(),
        isDeleted: DynamoKeyAttributeSchema.date.nullable(),
    },
    filter: item => !isBotItemDeleted(item),
});
