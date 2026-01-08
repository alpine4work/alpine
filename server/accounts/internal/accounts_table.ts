import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {AccountsSettingsSchema} from "~/shared/accounts/accounts_settings.js";
import {AvatarSchema} from "~/shared/avatar/avatar_schema.js";
import {AccountId, BotId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";
import {ReactionCharacterSchema} from "~/shared/reactions/reaction_character_schema.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema} from "~/shared/schema/schema.js";

export const AccountsTable = DynamoTableSchema.new({
    name: "Accounts",
    partitions: [
        {
            name: "Account",
            partitionKeyAttributes: {
                accountId: DynamoKeyAttributeSchema.id<AccountId>(),
            },
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        /**
                         * The name of this account.
                         */
                        name: LabelStringSchema,

                        /**
                         * Whenever we update the account's name we also increment this version number.
                         * Unlike `updateLockVersion` this only tracks name updates.
                         *
                         * Useful for the task system which updates a bunch of data in OpenSearch when
                         * an account name changes to only update old names.
                         */
                        nameVersion: Schema.integer.default(0),

                        /**
                         * When was this account created?
                         */
                        createdTime: Schema.date,

                        /**
                         * Does this account have access to pages under `/internal`?
                         */
                        hasInternalAccess: Schema.boolean.optional(),

                        /**
                         * Was this account created without going through the `/sign-up` flow? If true
                         * then:
                         *
                         * 1. The account can go through the `/auth/sign-up` flow even if an account
                         *    item already exists
                         *
                         * 2. The first time the account tries to `/auth/sign-in` they'll be redirected
                         *    to the `/sign-up` flow
                         */
                        hasNotSignedUp: Schema.value(true).optional(),

                        /**
                         * Is this a bot account? Undefined if this isn't a bot account and
                         * defined if it is. Includes the `BotId` this account is an instantiation of.
                         * There's only one account per bot per space.
                         *
                         * Bot accounts shouldn't have sessions. Bot accounts shouldn't have email
                         * addresses. You shouldn't be able to sign into a bot account.
                         *
                         * This property is also immutable. When you create a bot account, it's always
                         * a bot account. It can never be turned into a regular account and a regular
                         * account can never be turned into a bot account.
                         */
                        bot: Schema.object({
                            spaceId: Schema.id<SpaceId>(),
                            botId: Schema.id<BotId>(),
                        }).optional(),

                        /**
                         * The reaction character chosen by this account to represent them. When
                         * reacting, the account uses emotions from this character. We pick a random
                         * reaction character when creating the account and let the user configure from
                         * there.
                         *
                         * `null` is for accounts created before 2025-10-06 which we didn't select a
                         * random reaction for on account creation. If you see null then call
                         * `getLegacyFallbackReactionCharacterForId()` to get the character. This
                         * function only returns a character from our initial set of reaction
                         * characters so we make sure the character never changes over time.
                         *
                         * This property is visible to everyone with access to the account's
                         * information and shared across all the spaces an account is a member of.
                         */
                        reactionCharacter: ReactionCharacterSchema.nullable().default(null),
                    }),
                },
                /**
                 * NOTE(ifitzsimmons, #avatar-items): Avatar content (the image) can be up to
                 * 3kb in size. By pulling it out into its own item, we can ensure that the item
                 * is always below DynamoDB's 4kb item limit.
                 *
                 * This means that in order to get the complete Account data, we need to query the
                 * the sort range and get the Attributes and Avatar items. Unless the attributes
                 * item exceeds 1kb, this query will only consume 1 RCU.
                 */
                {
                    name: "Avatar",
                    sortKeyAttributes: {},
                    attributes: AvatarSchema,
                },
                {
                    /**
                     * Settings related to the account. These fields should be considered private
                     * and not sent to other clients.
                     */
                    name: "Settings",
                    sortKeyAttributes: {},
                    attributes: AccountsSettingsSchema,
                },
            ],
        },

        /**
         * We have separate partitions in this table for every email address associated
         * with an account. Multiple email addresses may be associated with a single
         * account however each email address may only be associated with a single
         * account.
         *
         * So to maintain global uniqueness of email addresses across our entire
         * service we have a separate account email address partition.
         */
        {
            name: "AccountEmailAddress",
            partitionKeyAttributes: {
                emailAddress: DynamoKeyAttributeSchema.emailAddressString,
            },
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        /**
                         * The account associated with the email address.
                         *
                         * We expect the account referenced by this session to always exist.
                         * When deleting an account, we should delete these items first.
                         */
                        accountId: Schema.id<AccountId>(),

                        // NOTE(rmtobin): The default value is an arbitrary date for backwards
                        // compatibility with existing data that did not have this attribute. New
                        // entries should always set this to the current time.
                        /**
                         * When was this email address added to the account?
                         */
                        createdTime: Schema.date.default(new Date("2025-09-05T11:11:00.000Z")),

                        /**
                         * Have we successfully delivered an email to this address and has someone
                         * opened that email and taken action on it?
                         *
                         * e.g. Has someone used a one-time password sent to this email address?
                         */
                        isVerified: Schema.boolean,

                        /**
                         * To sign in, we send the user a [one-time password][1] to their email
                         * address. We track the password hash here and some state while the user
                         * attempts to sign in.
                         *
                         * [1]: https://en.wikipedia.org/wiki/One-time_password
                         */
                        oneTimePasswordSignInState: Schema.object({
                            generatedTime: Schema.date,

                            /**
                             * We keep the password in plain text. We could consider hashing with bcrypt
                             * (slow) or sha256 (fast) but that's not a practically useful precaution. If
                             * an attacker has a dump of the accounts table they'll also have `SessionId`s
                             * which gives them arbitrary, permanent, access to the associated account when
                             * paired with a private key from one of our services.
                             *
                             * So also giving the one time password which is only valid for a short period
                             * of time isn't a problem in comparison.
                             *
                             * It may be worth using a sha256 hash as an extra precaution someday since
                             * it's fast (we don't need a slow hash since the user only gets 5 attempts
                             * anyway).
                             */
                            password: Schema.string,

                            failedAttemptCount: Schema.integer,
                            lastFailedAttemptTime: Schema.date.nullable(),
                        }).optional(),
                    }),
                },
            ],
        },

        /**
         * When an account successfully signs in it gets a session. The session is
         * saved in a location that can't be tampered (signed browser cookie). Having a
         * valid session id in a secure location identifies a user with our services.
         */
        {
            name: "Session",
            partitionKeyAttributes: {
                sessionId: DynamoKeyAttributeSchema.id<SessionId>(),
            },
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        /**
                         * The account this session is for.
                         *
                         * We expect the account referenced by this session to always exist.
                         * When deleting an account, we should delete these items first.
                         */
                        accountId: Schema.id<AccountId>(),

                        /**
                         * When was this session created?
                         */
                        createdTime: Schema.date,

                        /**
                         * The IP address of the HTTP request which created this session.
                         */
                        initialIpAddress: Schema.string.nullable(),

                        /**
                         * The user agent of the HTTP request which created this session.
                         */
                        initialUserAgent: Schema.string.nullable(),
                    }),
                },
            ],
        },

        /**
         * Allow an account to opt out of the "try on desktop" reminder email we
         * automatically send for them.
         */
        {
            name: "TryOnDesktopEmailOptOut",
            partitionKeyAttributes: {
                accountId: DynamoKeyAttributeSchema.id<AccountId>(),
            },
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    withExpirationTime: "Required",
                    attributes: Schema.object({}),
                },
            ],
        },

        /**
         * We only want to send an account the "try on desktop" email once. So save in
         * item in the database once we've sent the email.
         */
        {
            name: "SentTryOnDesktopEmail",
            partitionKeyAttributes: {
                accountId: DynamoKeyAttributeSchema.id<AccountId>(),
            },
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    withExpirationTime: "Required",
                    attributes: Schema.object({}),
                },
            ],
        },
    ],
});

/**
 * Index containing all of an account's email addresses. Allows email address lookups by accountId.
 */
export const AccountEmailAddressIndex = AccountsTable.addIndex({
    name: "AccountEmailAddresses",
    itemTypes: [{partitionType: "AccountEmailAddress", sortRangeType: "Attributes"}],
    partitionKeyAttributes: {
        accountId: DynamoKeyAttributeSchema.id<AccountId>(),
    },
    sortKeyAttributes: {createdTime: DynamoKeyAttributeSchema.date.reverse()},
});

export type AccountEmailAddressItem = DynamoTableItemType<
    typeof AccountsTable,
    "AccountEmailAddress",
    "Attributes"
>;

export type AccountItemWithoutAvatar = DynamoTableItemType<
    typeof AccountsTable,
    "Account",
    "Attributes"
>;

export type AccountAvatarItem = DynamoTableItemType<typeof AccountsTable, "Account", "Avatar">;

export type AccountItem = AccountItemWithoutAvatar & {
    readonly avatar: AccountAvatarItem | null;
};

export type AccountSettingsItem = DynamoTableItemType<typeof AccountsTable, "Account", "Settings">;

export type SessionItem = DynamoTableItemType<typeof AccountsTable, "Session", "Attributes">;
