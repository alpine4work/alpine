import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {AvatarSchema} from "~/shared/avatar/avatar_schema.js";
import {AccountId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";
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
                    }),
                },
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
                    attributes: Schema.object({
                        /**
                         * The ID of the space this account last opened.
                         * Used for determining which default space to open to
                         * when needing to route home.
                         */
                        lastOpenedSpaceId: Schema.id<SpaceId>().optional(),
                    }),
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
         * Apple device tokens are an anonymous identifier for a device + app pair. It
         * is the address to which we send push notifications. Only one user is signed
         * in on a device at a time but a user may sign out of the account on their
         * device then sign in to another.
         *
         * When the user signs out of an account we invalidate the device token with
         * Apple's Push Notification service (APNs) but don't remove it from the
         * database. Invalidating the device token means even if we send notifications
         * the device won't show them. When a new user signs in we update the device
         * token in the database with the new `AccountId`.
         *
         * We have an index to read all `AppleDeviceToken`s for an account.
         */
        {
            name: "AppleDeviceToken",
            partitionKeyAttributes: {
                deviceToken: DynamoKeyAttributeSchema.bytes(32),
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
 * Index containing all of an account's devices. When sending the user a push
 * notification we will query this index and send a notification to each
 * device.
 */
// NOTE(calebmer, 2024-06-11): While today we only support iOS devices, this
// index should eventually contain all devices for an account no matter the
// operating system so we only need to query one index. For example, Android
// registration IDs should also appear in this index.
export const AccountDevicesIndex = AccountsTable.addIndex({
    name: "AccountDevices",
    itemTypes: [{partitionType: "AppleDeviceToken", sortRangeType: "Attributes"}],
    partitionKeyAttributes: {
        accountId: DynamoKeyAttributeSchema.id<AccountId>(),
    },
    sortKeyAttributes: {},
});
