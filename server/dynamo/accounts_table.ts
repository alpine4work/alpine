import {differenceInHours, differenceInMinutes} from "date-fns";
import {DynamoConditionExpression} from "~/server/dynamo/internal/dynamo_condition";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
import {retryDynamoConditionCheckErrors} from "~/server/dynamo/internal/retry_dynamo_condition_check_errors";
import {NotFoundError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {quote} from "~/shared/helpers/string/quote";
import {isId} from "~/shared/id/id";
import {LabelStringSchema} from "~/shared/schema/label_string_schema";
import {Schema} from "~/shared/schema/schema";

const AccountsTable = DynamoTableSchema.new({
    name: "Accounts",
    partitions: {
        Account: {
            partitionKeyAttributes: {
                accountId: DynamoKeyAttributeSchema.id,
            },
            sortRanges: {
                Attributes: {
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        /**
                         * The name of this account.
                         */
                        name: LabelStringSchema,

                        /**
                         * Can this account approve folks who want to get alpha access to the product?
                         * We will eventually get rid of this option. Once the product is out of alpha
                         * and anyone can sign up.
                         */
                        canApproveAlphaAccessRequests: Schema.boolean.optional(),
                    }),
                },
            },
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
        AccountEmailAddress: {
            partitionKeyAttributes: {
                emailAddress: DynamoKeyAttributeSchema.labelString,
            },
            sortRanges: {
                Attributes: {
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        /**
                         * A version number to make sure we don't clobber another write while updating.
                         */
                        // TODO(calebmer): We should have this feature in `DynamoTableSchema` itself
                        lockVersion: Schema.integer,

                        /**
                         * The account associated with the email address.
                         */
                        accountId: Schema.id,

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
                             * [1]: https://github.com/dcodeIO/bcrypt.js/tree/master
                             * [2]: https://community.cloudflare.com/t/options-for-password-hashing/138077
                             */
                            password: Schema.string,
                            failedAttemptCount: Schema.integer,
                            lastFailedAttemptTime: Schema.date.nullable(),
                        }).optional(),
                    }),
                },
            },
        },
    },
});

/**
 * We are not allowed to export our DynamoDB tables so instead export a
 * function that can only be used in Jest tests.
 */
export function getAccountsTableForTest() {
    assert(typeof jest !== "undefined");
    return AccountsTable;
}

type AccountEmailAddressAttributes = DynamoTableItemType<
    typeof AccountsTable,
    "AccountEmailAddress",
    "Attributes"
>;

export async function seedTestAccounts() {
    assert(process.env.NODE_ENV !== "production");

    const adminAccountId = "27g6s1h4ygh1zqzw5h23gqtn88";
    assert(isId(adminAccountId));

    await DynamoTableSchema.executeTransaction([
        AccountsTable.transactionPutItem({
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: adminAccountId,
            name: "Test Admin",
            canApproveAlphaAccessRequests: true,
        }),
        AccountsTable.transactionPutItem(
            {
                partitionType: "AccountEmailAddress",
                sortRangeType: "Attributes",
                emailAddress: "admin@test.cyberworlds.dev",
                lockVersion: 0,
                accountId: adminAccountId,
                isVerified: true,
            },
            {
                condition: {
                    // If the email address already exists but with a different id, then seeding
                    // should fail.
                    accountId: DynamoConditionExpression.eq(adminAccountId).or(
                        DynamoConditionExpression.exists().not(),
                    ),
                },
            },
        ),
    ]);
}

export type RegenerateAccountEmailAddressOneTimePasswordResult =
    | {type: "RegeneratedOneTimePassword"}
    | {
          type: "AccountEmailAddressLocked";
          hoursUntilUnlocked: number;
      };

/**
 * Generates a new one time password for signing into an account with the
 * provided email address. Sends the password to the account's email address.
 */
export function regenerateOneTimePasswordSignIn(
    emailAddress: string,
): Promise<RegenerateAccountEmailAddressOneTimePasswordResult> {
    return retryDynamoConditionCheckErrors(async () => {
        // Email address is case insensitive.
        emailAddress = emailAddress.toLowerCase();

        const accountEmailAddressItem = await AccountsTable.getItem({
            partitionType: "AccountEmailAddress",
            sortRangeType: "Attributes",
            emailAddress,
        });
        if (!accountEmailAddressItem) throw new NotFoundError("Account email address not found");

        const hoursUntilUnlocked =
            getHoursUntilRegenerateOneTimePasswordUnlocked(accountEmailAddressItem);

        // If the account is locked, you cannot regenerate a password.
        if (hoursUntilUnlocked > 0) {
            return {
                type: "AccountEmailAddressLocked",
                hoursUntilUnlocked,
            };
        }

        const generatedTime = new Date();
        const password = generateOneTimePassword();

        await AccountsTable.putItem(
            {
                ...accountEmailAddressItem,
                lockVersion: accountEmailAddressItem.lockVersion + 1,
                oneTimePasswordSignInState: {
                    generatedTime,
                    password,
                    // Carry over failed attempt count so an attacker can't regenerate the password
                    // to get more sign in attempts.
                    //
                    // However, if we have exceeded the max attempts and we are at this point then
                    // regenerating the password unlocks this account. If the account is still
                    // locked we would have done an early return above.
                    failedAttemptCount:
                        accountEmailAddressItem.oneTimePasswordSignInState &&
                        accountEmailAddressItem.oneTimePasswordSignInState.failedAttemptCount <
                            maxFailedOneTimePasswordAttemptCount
                            ? accountEmailAddressItem.oneTimePasswordSignInState.failedAttemptCount
                            : 0,
                    lastFailedAttemptTime: null,
                },
            },
            {
                condition: {
                    lockVersion: accountEmailAddressItem.lockVersion,
                },
            },
        );

        // We allow tests to capture one time password emails. Make sure this only
        // happens in test environments since we don't want developers to have access
        // to one time password.
        if (oneTimePasswordSignInEmailsForTest !== null) {
            assert(typeof jest !== "undefined");
            oneTimePasswordSignInEmailsForTest.push({emailAddress, oneTimePassword: password});
        }

        // TODO(calebmer): Actually send emails!
        if (process.env.NODE_ENV === "development") {
            // eslint-disable-next-line no-console
            console.log(quote`✉️ The one time password for ${emailAddress} is ${password}`);
        }

        return {type: "RegeneratedOneTimePassword"};
    });
}

/**
 * Generates a random one time password. A one time password is 6 characters,
 * where each character is a digit from 0 to 9.
 *
 * There are 1 million possibilities so an attacker has a 0.000005% chance to
 * guess the password. We only allow 3 attempts to guess before locking the
 * account.
 */
function generateOneTimePassword(): string {
    const randomUint32s = new Uint32Array(6);
    crypto.getRandomValues(randomUint32s);

    const randomDigits = randomUint32s.map(randomUint32 => {
        // Convert a uint32 to a float. We divide by 0xffffffff since that's the
        // maximum uint32 value. We add 1 so that our float is in the range [0, 1)
        // (0 inclusive, 1 exclusive).
        const randomFloat = randomUint32 / (0xffffffff + 1);

        return Math.floor(randomFloat * 11);
    });

    return randomDigits.join("");
}

let oneTimePasswordSignInEmailsForTest: Array<{
    emailAddress: string;
    oneTimePassword: string;
}> | null = null;

/**
 * Helper for tests to capture one time password sign in emails.
 */
export async function captureOneTimePasswordSignInEmailsForTest(
    action: () => Promise<void>,
): Promise<Array<{emailAddress: string; oneTimePassword: string}>> {
    assert(typeof jest !== "undefined");

    const previousOneTimePasswordLoginEmailsForTest = oneTimePasswordSignInEmailsForTest;
    oneTimePasswordSignInEmailsForTest = [];
    try {
        await action();
        return oneTimePasswordSignInEmailsForTest;
    } finally {
        oneTimePasswordSignInEmailsForTest = previousOneTimePasswordLoginEmailsForTest;
    }
}

/**
 * Number of times a user may attempt to sign in with a one-time password.
 */
const maxFailedOneTimePasswordAttemptCount = 5;

/**
 * Expire one-time passwords after an hour.
 */
const expireOneTimePasswordAfterMinutes = 60;

export type AttemptOneTimePasswordLoginResult =
    | {type: "MissingOneTimePassword"}
    | {type: "CorrectOneTimePassword"}
    | {type: "IncorrectOneTimePassword"}
    | {
          type: "AccountEmailAddressLockedUntilRegenerateOneTimePassword";
          hoursUntilRegenerateOneTimePasswordUnlocked: number;
      };

/**
 * Attempts to sign into the account with a one time password. After a few
 * consecutive failed attempts to sign in, we will lock the account for at
 * least 24 hours.
 */
export function attemptOneTimePasswordSignIn(
    emailAddress: string,
    oneTimePassword: string,
): Promise<AttemptOneTimePasswordLoginResult> {
    return retryDynamoConditionCheckErrors(async (): Promise<AttemptOneTimePasswordLoginResult> => {
        // Email address is case insensitive.
        emailAddress = emailAddress.toLowerCase();

        const accountEmailAddressItem = await AccountsTable.getItem({
            partitionType: "AccountEmailAddress",
            sortRangeType: "Attributes",
            emailAddress,
        });
        if (!accountEmailAddressItem) throw new NotFoundError("Account email address not found");

        if (!accountEmailAddressItem.oneTimePasswordSignInState) {
            return {type: "MissingOneTimePassword"};
        }

        // Check if the account is locked.
        if (
            accountEmailAddressItem.oneTimePasswordSignInState.failedAttemptCount >=
            maxFailedOneTimePasswordAttemptCount
        ) {
            return {
                type: "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
                hoursUntilRegenerateOneTimePasswordUnlocked:
                    getHoursUntilRegenerateOneTimePasswordUnlocked(accountEmailAddressItem),
            };
        }

        // Check if the one-time password is expired. We check if the account is locked
        // first since the one-time password will expire while the account is locked
        // and you won't be able to generate a new one-time password until after the
        // account is unlocked.
        if (
            differenceInMinutes(
                new Date(),
                accountEmailAddressItem.oneTimePasswordSignInState.generatedTime,
            ) > expireOneTimePasswordAfterMinutes
        ) {
            return {type: "MissingOneTimePassword"};
        }

        const isCorrectOneTimePassword =
            accountEmailAddressItem.oneTimePasswordSignInState.password === oneTimePassword;

        if (!isCorrectOneTimePassword) {
            await AccountsTable.putItem(
                {
                    ...accountEmailAddressItem,
                    lockVersion: accountEmailAddressItem.lockVersion + 1,
                    oneTimePasswordSignInState: {
                        ...accountEmailAddressItem.oneTimePasswordSignInState,
                        failedAttemptCount:
                            accountEmailAddressItem.oneTimePasswordSignInState.failedAttemptCount +
                            1,
                        lastFailedAttemptTime: new Date(),
                    },
                },
                {
                    condition: {
                        lockVersion: accountEmailAddressItem.lockVersion,
                    },
                },
            );

            return {type: "IncorrectOneTimePassword"};
        } else {
            await AccountsTable.putItem(
                {
                    ...accountEmailAddressItem,
                    lockVersion: accountEmailAddressItem.lockVersion + 1,
                    // Verify this email address.
                    isVerified: true,
                    // Remove our one-time password sign in state.
                    oneTimePasswordSignInState: undefined,
                },
                {
                    condition: {
                        lockVersion: accountEmailAddressItem.lockVersion,
                    },
                },
            );

            return {type: "CorrectOneTimePassword"};
        }
    });
}

/**
 * The number of hours a user must wait after their account has been locked
 * before they can generate a new password.
 */
const maxHoursUntilRegenerateOneTimePasswordUnlocked = 24;

/**
 * Get the number of hours until the user can regenerate their password. If
 * the number is 0 than the account may be unlocked.
 */
function getHoursUntilRegenerateOneTimePasswordUnlocked({
    oneTimePasswordSignInState,
}: AccountEmailAddressAttributes): number {
    // If the email address is not locked, the user may regenerate a password
    // whenever.
    if (
        !oneTimePasswordSignInState ||
        oneTimePasswordSignInState.failedAttemptCount < maxFailedOneTimePasswordAttemptCount
    ) {
        return 0;
    }

    if (!oneTimePasswordSignInState.lastFailedAttemptTime) {
        return maxHoursUntilRegenerateOneTimePasswordUnlocked;
    }

    const hoursSinceLastFailedOneTimePasswordSignInAttempt = differenceInHours(
        new Date(),
        oneTimePasswordSignInState.lastFailedAttemptTime,
    );

    const hoursUntilRegenerateOneTimePasswordSignInUnlocked =
        maxHoursUntilRegenerateOneTimePasswordUnlocked -
        hoursSinceLastFailedOneTimePasswordSignInAttempt;

    return Math.max(hoursUntilRegenerateOneTimePasswordSignInUnlocked, 0);
}
