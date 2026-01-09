import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {AccountsSettingsSchema} from "~/shared/accounts/accounts_settings.js";
import {AvatarSchema} from "~/shared/avatar/avatar_schema.js";
import {AccountId, BotId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";
import {ReactionCharacterSchema} from "~/shared/reactions/reaction_character_schema.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export const AccountsBillingSchema = Schema.object({
    /**
     * The ID of the customer in Stripe for this account's billing.
     * If an entry exists, we should have a stripe customer created.
     */
    stripeCustomerId: Schema.string,

    /**
     * A historical log of this account's Stripe purchases.
     */
    stripePurchases: Schema.array(
        Schema.object({
            priceId: Schema.string,
            price: Schema.float,
            createdTime: Schema.date,
        }),
    ).default([]),

    /**
     * The time at which the account was created.
     */
    createdTime: Schema.date,
});

export type AccountsBilling = SchemaType<typeof AccountsBillingSchema>;

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
                         * The plan for Alpine that this individual account is on.
                         * This is the source of truth for any individual account limits.
                         */
                        plan: Schema.enum(["LifetimeAccess"]).optional(),

                        /**
                         * When was this account created?
                         */
                        createdTime: Schema.date,

                        /**
                         * Does this account have access to pages under `/internal`?
                         */
                        hasInternalAccess: Schema.boolean.optional(),

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
                {
                    /**
                     * Billing data related to the account. These fields should be considered
                     * private and not sent to other clients.
                     */
                    name: "Billing",
                    sortKeyAttributes: {},
                    attributes: AccountsBillingSchema,
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
                             * We would hash this with Bcrypt ([Bcrypt.js][1] has a browser mode) but
                             * that runs up against the Cloudflare Worker CPU time limit in the
                             * "bundled" pricing model (see this [community forum post][1]).
                             *
                             * We need a worker on "unbound" pricing to get unlimited CPU time. It's
                             * unclear whether our main app worker will be on unbound pricing or not.
                             * The "bundled" pricing model generally appears cheaper for web services
                             * so we're going to start there.
                             *
                             * We could create a second worker with unbound pricing or Durable Object
                             * (which uses similar pricing to unbound) but that seems too difficult right
                             * now.
                             *
                             * It doesn't seem too bad to keep one-time passwords in plain text. We
                             * only allow ~5 attempts per day and expire the password after ~1 hour.
                             *
                             * If an attacker could only read from this table they learn nothing secret
                             * about the user. (Unlike storing regular passwords in plain text. They
                             * learn something secret!) An attacker could sign in as the user within
                             * the ~1 hour window.
                             *
                             * If an attacker could read and write to the table they could update the
                             * password to whatever they want and sign in. We would have the same
                             * vulnerability if the password was hashed.
                             *
                             * There may be a chance at timing attacks? But again, 5 attempts is a
                             * pretty sufficient defense.
                             *
                             * So the only vulnerabilities I can think of by not hashing are if an
                             * attacker has just read-only access to the database they can sign in as
                             * accounts trying to sign in within the last ~1 hour. Not great but
                             * the risk is small (if you have read access you probably also have write
                             * access and attacks get much worse) so accepting it for now...
                             *
                             * [1]: https://github.com/dcodeIO/bcrypt.js
                             * [2]: https://community.cloudflare.com/t/options-for-password-hashing/138077
                             */
                            // NOTE(calebmer, 2023-06-29): The above decision was made when this code ran
                            // in Cloudflare instead of Node.js. Now it's perfectly fine (and desirable!)
                            // to use the Node.js bcrypt module.
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
         * We maintain a copy of Stripe Customers here to map from Stripe Customer ID
         * to our internal Account ID. This allows us to map accounts from Stripe webhooks
         * which only contain the Stripe Customer ID.
         *
         * We explicitly do not use an index here as indexes can only ever be eventually
         * consistent. We need strong consistency to avoid missing this connection
         * after creating new customers.
         */
        {
            name: "StripeCustomer",
            partitionKeyAttributes: {
                // Stripe Customer IDs may be up to 255 characters.
                // https://docs.stripe.com/upgrades#what-changes-does-stripe-consider-to-be-backward-compatible
                stripeCustomerId: DynamoKeyAttributeSchema.labelString({maxLength: 255}),
            },
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        accountId: Schema.id<AccountId>(),
                    }),
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
