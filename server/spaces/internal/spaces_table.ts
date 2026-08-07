import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {AvatarSchema} from "~/shared/avatar/avatar_schema.js";
import {
    defaultSpaceThemeColor,
    selectableSpaceThemeColors,
} from "~/shared/design/core/theme_colors.js";
import {AccountId, BotId, ChannelId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {IdByteSetSchema} from "~/shared/schema/helpers/id_byte_set_schema.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema} from "~/shared/schema/schema.open_source.js";
import {
    AccountModelDataSpaceState,
    AccountModelDataSpaceStateSchema,
} from "~/shared/spaces/account_model.js";
import {SpaceAccountSettingsSchema} from "~/shared/spaces/space_account_settings.js";
import {SpaceRoleSchema} from "~/shared/spaces/space_model.js";

export const SpacesTable = DynamoTableSchema.new({
    name: "Spaces",
    partitions: [
        /**
         * We organize all content in our product into spaces. Many accounts may be members
         * of a space and our entities must have a parent space.
         *
         * The name "space" is a generalization of the word "workspace". While right now
         * our products are intended to only be used for work, we may one day enable
         * personal use of our products.
         *
         * Spaces provide a means of data isolation.
         *
         * - Crashes in one space should not affect another space.
         *
         * - If spaces need some resource, we should be able to dynamically scale spaces
         *   independently of one another.
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

                        // TODO(calebmer, 2026-04-28): This is no longer used. Remove it?
                        alphaAccessDefaultChannelId: Schema.id<ChannelId>().optional(),

                        /**
                         * The theme color used for accent UI elements throughout the space. Defaults to
                         * blue if not set.
                         */
                        themeColor: Schema.enum(selectableSpaceThemeColors).default(
                            defaultSpaceThemeColor,
                        ),
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
                         * There must only be one owner in the space. We enforce this through the functions
                         * in this file. If you're updating account roles take care to make sure one
                         * account per space is always an owner.
                         *
                         * We'll likely never have uniqueness constraints in our DynamoDB abstraction. That
                         * all has to be explicitly implemented in our code.
                         */
                        role: SpaceRoleSchema.default("Member"),

                        /**
                         * The timestamp when the account was invited to the space. This is set when we
                         * create an entry in the `Account` sort range.
                         */
                        addedTime: Schema.date.originalPropertyKey("joinedTime"),

                        /**
                         * Is this a bot account? This is the same `BotId` that's in
                         * `accountItem.bot.botId`. We copy it here since the `bot` property is immutable
                         * and it's useful to know whether an account is a bot if we're authorizing.
                         */
                        botId: Schema.id<BotId>().optional(),

                        /**
                         * The state of the account's membership in this space.
                         *
                         * As of 2025-07-30, this used to be `removal?: { time: Date }` to mark an account
                         * as removed, but we needed to support more account states.
                         *
                         * We use a transform() here instead of a default() to ensure that our TS types are
                         * not nullable, while still supporting null as "active" in the database.
                         *
                         * We also use a defaultVariant() to ensure that if there was an object stored
                         * previously, we assign it the "Removed" type.
                         */
                        state: AccountModelDataSpaceStateSchema.defaultVariant("Removed")
                            .nullable()
                            .transform<AccountModelDataSpaceState>({
                                serialize: value => value,
                                deserialize: value => {
                                    if (value) return value;

                                    return {
                                        type: "Active",
                                        // NOTE(calebmer, 2026-01-09): This property didn't exist before this date. So
                                        // default all objects that are missing this property to the migration date.
                                        activatedTime: new Date("2026-01-09T21:17:25.026Z"),
                                    };
                                },
                            })
                            .default({
                                type: "Active",
                                // NOTE(calebmer, 2026-01-09): This property didn't exist before this date. So
                                // default all objects that are missing this property to the migration date.
                                activatedTime: new Date("2026-01-09T21:17:25.026Z"),
                            })
                            .originalPropertyKey("removal"),
                    }),
                },

                /**
                 * When an account is removed from a space, we snapshot and store their avatar at
                 * the time of removal. This ensures that their last known avatar continues to
                 * appear on all historical content (posts, messages, tasks, mentions, etc.).
                 */
                {
                    name: "AccountAvatarOverride",
                    sortKeyAttributes: {
                        accountId: DynamoKeyAttributeSchema.id<AccountId>(),
                    },
                    attributes: AvatarSchema,
                },

                /**
                 * Represents secondary information for an account that's a member of this space.
                 *
                 * The `Account` item is the primary, canonical, item which we use for determining
                 * whether an account is a member of the space (critical for authorization!).
                 * Information in the primary `Account` item goes into `AccountModel` which is
                 * shared to the client whenever an `AccountId` is referenced. It's important for
                 * performance that the primary `Account` item stays small and only contains
                 * critical data.
                 *
                 * This item contains secondary information associated with the space account we
                 * don't need to load in hot code paths (thus reducing the number of RCUs we spend
                 * loading the space account list). As a rule of thumb, put information in the
                 * primary `Account` item if it's needed for:
                 *
                 * - Authorization
                 * - `AccountModel`, which is used for:
                 *     - Rendering account mentions
                 *     - Rendering `<AccountAvatar>`
                 *     - Rendering an account tooltip preview
                 *
                 * Anything else goes into this secondary item. A secondary item may not exist when
                 * a primary item exists. We only create this secondary item if needed.
                 */
                {
                    name: "AccountSettings",
                    sortKeyAttributes: {
                        accountId: DynamoKeyAttributeSchema.id<AccountId>(),
                    },
                    attributes: SpaceAccountSettingsSchema,
                },

                /**
                 * When a space is created, we create some default entities inside the space. We
                 * store the `Id`s of these entities in this item. When an account is added to a
                 * space we give them some affinity points for these entities.
                 */
                {
                    name: "WelcomePackage",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        generalChannelId: Schema.id<ChannelId>(),
                        randomChannelId: Schema.id<ChannelId>(),
                        chatGptBotAccountId: Schema.id<AccountId>().nullable(),
                        cursorBotAccountId: Schema.id<AccountId>().nullable().default(null),
                    }),
                },

                /**
                 * Accounts that sign up with an email from this email domain are automatically
                 * added to the space.
                 *
                 * The canonical item is `Space#AutoAddAccountsFromEmailDomain` and we have this
                 * item to allow for reading the email domains associated with a space at strong
                 * read consistency. (Indexes only allow eventual consistency.)
                 */
                {
                    name: "AutoAddAccountsFromEmailDomain",
                    sortKeyAttributes: {
                        emailDomain: DynamoKeyAttributeSchema.labelString<string>({
                            maxLength: null,
                        }),
                    },
                    attributes: Schema.object({}),
                },

                /**
                 * Currently used to rate limit the number of invites to a space.
                 *
                 * The day after we launched, there was an incident where a bad actor tried
                 * inviting > 30K emails to their space via the bulk invite UI [1].
                 *
                 * To prevent this from happening again, we rate limit invites to email addresses
                 * according to the following rules:
                 *
                 * 1. If the space has one or more `AutoAddAccountsFromEmailDomain`s, we will not
                 *    throttle invites to emails that belong to those domains. For example, if a
                 *    user in the "Amazon" space wants to invite their organization of 500 Amazon
                 *    employees, they should be able to do so. All other emails will be throttled
                 * 2. If the space does not have any `AutoAddAccountsFromEmailDomain`s, we'll
                 *    consider it to be a "personal space". There aren't currently any strong use
                 *    cases for bulk inviting tons of users into a "personal space" so we will rate
                 *    limit all invites to 50 per hour.
                 * 3. If the request pushes the total number of invites "outside of the
                 *    organization" past the rate limit, ALL EMAIL ADDRESSES IN THE BATCH WILL BE
                 *    REJECTED. The user will still be able to invite members of their
                 *    organization, but they'll have to remove the offending email addresses before
                 *    trying again.
                 *
                 * The naming of this sort range is generic and not bound to the implementation of
                 * rate limiting (e.g. it says nothing about rate limiting only non-organization
                 * emails addresses). This way, we can change the implementation later if needed.
                 *
                 * As of writing, we allow up to 50 invites to email addresses that are not part of
                 * the space's organization every hour. This may change. You can see the
                 * implementation of the rate limiting in the `inviteEmailAddressesToSpace`
                 * function.
                 *
                 * [1]:
                 *     https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/posts/yjhp5g4cm7s3nphhprcspp7tc0
                 */
                {
                    name: "SpaceInviteRateLimitBucket",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        bucket: Schema.object({
                            startTime: Schema.date,
                            remainingInviteCount: Schema.integer,
                        }),
                    }),
                },
            ],
        },

        /**
         * Accounts that sign up with an email from this email domain are automatically
         * added to the `SpaceId`.
         *
         * This is the canonical item. There's also a
         * `Space#AutoAddAccountsFromEmailDomain` item so we can read the email domains
         * associated with a space with strong read consistency. We could use an index but
         * the index wouldn't let us read at strong consistency and it's only 1 additional
         * WCU which happens rarely to write a second item.
         */
        {
            name: "AutoAddAccountsFromEmailDomain",
            partitionKeyAttributes: {
                emailDomain: DynamoKeyAttributeSchema.labelString<string>({maxLength: null}),
            },
            sortRanges: [
                {
                    name: "Space",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        /**
                         * The `SpaceId` to automatically add accounts to.
                         */
                        spaceId: Schema.id<SpaceId>(),

                        /**
                         * Whether auto-adding accounts from this email domain is enabled. We never delete
                         * this item (since on next sign up we'd create a new space for the domain) but
                         * space admins may set `isEnabled: false` to disable new sign ups from being
                         * automatically added to the space.
                         */
                        isEnabled: Schema.boolean,
                    }),
                },
            ],
        },

        /**
         * The spaces all of our accounts are members of. This is an item we have to
         * manually maintain instead of a DynamoDB index so we can read an account's spaces
         * with strong read consistency or have transaction conditional checks on an
         * account's space memberships.
         *
         * - `spaceIds`: The `SpaceId`s our account has an `Active` state in (excludes
         *   spaces where the account has an `InvitePending` or `Removed` state).
         *
         * - `invitePendingSpaceIds`: The `SpaceId`s our account has an `InvitePending`
         *   state in.
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
         * All the spaces our bot is instantiated in. We have a separate `AccountId` for
         * each space a bot is in. That way bot accounts can't accidentally read data from
         * spaces they're not a part of.
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

export type SpaceAttributesItem = DynamoTableItemType<typeof SpacesTable, "Space", "Attributes">;
export type SpaceAvatarDarkThemeItem = DynamoTableItemType<
    typeof SpacesTable,
    "Space",
    "AvatarDarkTheme"
>;
export type SpaceAvatarLightThemeItem = DynamoTableItemType<
    typeof SpacesTable,
    "Space",
    "AvatarLightTheme"
>;
export type SpaceItem = SpaceAttributesItem & {
    readonly avatars: {
        readonly darkTheme: SpaceAvatarDarkThemeItem | null;
        readonly lightTheme: SpaceAvatarLightThemeItem | null;
    };
};

export type SpaceAccountItem = DynamoTableItemType<typeof SpacesTable, "Space", "Account">;
export type SpaceAccountAvatarOverrideItem = DynamoTableItemType<
    typeof SpacesTable,
    "Space",
    "AccountAvatarOverride"
>;
export type SpaceAccountItemWithAccountAvatarOverride = SpaceAccountItem & {
    readonly accountAvatarOverride: SpaceAccountAvatarOverrideItem | null;
};

export type SpaceWelcomePackageItem = DynamoTableItemType<
    typeof SpacesTable,
    "Space",
    "WelcomePackage"
>;

export type SpaceInviteRateLimitBucketItem = DynamoTableItemType<
    typeof SpacesTable,
    "Space",
    "SpaceInviteRateLimitBucket"
>;

export type AccountSpacesItem = DynamoTableItemType<typeof SpacesTable, "Account", "Spaces">;
