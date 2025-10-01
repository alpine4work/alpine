import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {AvatarSchema} from "~/shared/avatar/avatar_schema.js";
import {AccountId, BotId, ChannelId, SpaceId} from "~/shared/id/types/id_types.js";
import {IdByteSetSchema} from "~/shared/schema/helpers/id_byte_set_schema.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema} from "~/shared/schema/schema.js";
import {
    AccountModelDataSpaceState,
    AccountModelDataSpaceStateSchema,
} from "~/shared/spaces/account_model.js";
import {SpaceAccountSettingsSchema} from "~/shared/spaces/space_account_settings.js";
import {spaceAccountStateDefault} from "~/shared/spaces/space_account_state.js";
import {SpaceRoleSchema} from "~/shared/spaces/space_model.js";

export const SpacesTable = DynamoTableSchema.new({
    name: "Spaces",
    partitions: [
        /**
         * We organize all content in our product into spaces. Many accounts may be
         * members of a space and our entities must have a parent space.
         *
         * The name "space" is a generalization of the word "workspace". While right
         * now our products are intended to only be used for work, we may one day
         * enable personal use of our products.
         *
         * Spaces provide a means of data isolation.
         *
         * - Crashes in one space should not affect another space.
         *
         * - If spaces need some resource, we should be able to dynamically scale
         *   spaces independently of one another.
         *
         * - Eventually, to comply to EU regulations we will choose a home region for a
         *   space and all data associated with a space will live there.
         */
        {
            name: "Space",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
            },
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        name: LabelStringSchema,
                        createdTime: Schema.date,

                        /**
                         * During our alpha phase, you can manually set this property in the database
                         * and it will be used for some navigation elements until we have proper
                         * implementations.
                         */
                        alphaAccessDefaultChannelId: Schema.id<ChannelId>().optional(),
                    }),
                },

                // See #avatar-items for reasoning behind separate avatar items.
                {
                    name: "AvatarLightTheme",
                    sortKeyAttributes: {},
                    attributes: AvatarSchema,
                },

                {
                    name: "AvatarDarkTheme",
                    sortKeyAttributes: {},
                    attributes: AvatarSchema,
                },

                /**
                 * Represents an account that is a member of this space.
                 */
                {
                    name: "Account",
                    sortKeyAttributes: {
                        accountId: DynamoKeyAttributeSchema.id<AccountId>(),
                    },
                    attributes: Schema.object({
                        /**
                         * Space account role by which the account can access the space.
                         *
                         * There must only be one owner in the space. We enforce this through
                         * the functions in this file. If you're updating account roles take
                         * care to make sure one account per space is always an owner.
                         *
                         * We'll likely never have uniqueness constraints in our DynamoDB
                         * abstraction. That all has to be explicitly implemented in our code.
                         */
                        role: SpaceRoleSchema.default("Member"),

                        /**
                         * The timestamp when the account was invited to the space.
                         * This is set when we create an entry in the `Account` sort range.
                         */
                        addedTime: Schema.date.originalPropertyKey("joinedTime"),

                        /**
                         * Is this a bot account? This is the same `BotId` that's in
                         * `accountItem.bot.botId`. We copy it here since the `bot`
                         * property is immutable and it's useful to know whether an account
                         * is a bot if we're authorizing.
                         */
                        botId: Schema.id<BotId>().optional(),

                        /**
                         * The state of the account's membership in this space.
                         *
                         * As of 2025-07-30, this used to be removal?: { time: Date } to mark
                         * an account as removed, but we needed to support more account states.
                         *
                         * We use a transform() here instead of a default() to ensure
                         * that our TS types are not nullable, while still supporting
                         * null as "active" in the database.
                         *
                         * We also use a defaultVariant() to ensure that if there was an object
                         * stored previously, we assign it the "Removed" type.
                         */
                        state: AccountModelDataSpaceStateSchema.defaultVariant("Removed")
                            .nullable()
                            .transform<AccountModelDataSpaceState>({
                                serialize: value => value,
                                deserialize: value => (!value ? spaceAccountStateDefault : value),
                            })
                            .default(spaceAccountStateDefault)
                            .originalPropertyKey("removal"),
                    }),
                },

                /**
                 * When an account is removed from a space, we snapshot and store their avatar
                 * at the time of removal. This ensures that their last known avatar continues
                 * to appear on all historical content (posts, messages, tasks, mentions, etc.).
                 */
                {
                    name: "AccountAvatarOverride",
                    sortKeyAttributes: {
                        accountId: DynamoKeyAttributeSchema.id<AccountId>(),
                    },
                    attributes: AvatarSchema,
                },

                /**
                 * Represents secondary information for an account that's a member of this
                 * space.
                 *
                 * The `Account` item is the primary, canonical, item which we use for
                 * determining whether an account is a member of the space (critical for
                 * authorization!). Information in the primary `Account` item goes into
                 * `AccountModel` which is shared to the client whenever an `AccountId` is
                 * referenced. It's important for performance that the primary `Account` item
                 * stays small and only contains critical data.
                 *
                 * This item contains secondary information associated with the space account
                 * we don't need to load in hot code paths (thus reducing the number of RCUs we
                 * spend loading the space account list). As a rule of thumb, put information
                 * in the primary `Account` item if it's needed for:
                 *
                 * - Authorization
                 * - `AccountModel`, which is used for:
                 *     - Rendering account mentions
                 *     - Rendering `<AccountAvatar>`
                 *     - Rendering an account tooltip preview
                 *
                 * Anything else goes into this secondary item. A secondary item may not exist
                 * when a primary item exists. We only create this secondary item if needed.
                 */
                {
                    name: "AccountSettings",
                    sortKeyAttributes: {
                        accountId: DynamoKeyAttributeSchema.id<AccountId>(),
                    },
                    attributes: SpaceAccountSettingsSchema,
                },
            ],
        },

        /**
         * The spaces all of our accounts are members of. This is an item we have to
         * manually maintain instead of a DynamoDB index so we can read an account's
         * spaces with strong read consistency or have transaction conditional checks
         * on an account's space memberships.
         */
        {
            name: "Account",
            partitionKeyAttributes: {
                accountId: DynamoKeyAttributeSchema.id<AccountId>(),
            },
            sortRanges: [
                {
                    name: "Spaces",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        spaceIds: IdByteSetSchema.get<SpaceId>(),
                        invitePendingSpaceIds: IdByteSetSchema.get<SpaceId>().default(new Set()),
                    }),
                },
            ],
        },

        /**
         * All the spaces our bot is instantiated in. We have a separate `AccountId`
         * for each space a bot is in. That way bot accounts can't accidentally read
         * data from spaces they're not a part of.
         */
        {
            name: "Bot",
            partitionKeyAttributes: {
                botId: DynamoKeyAttributeSchema.id<BotId>(),
            },
            sortRanges: [
                {
                    name: "Space",
                    sortKeyAttributes: {
                        spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
                    },
                    attributes: Schema.object({
                        accountId: Schema.id<AccountId>(),
                    }),
                },
            ],
        },
    ],
});
