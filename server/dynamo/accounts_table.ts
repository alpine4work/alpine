import {differenceInHours, differenceInMinutes} from "date-fns";
import {ActionContext, MaybeSessionActionContext} from "~/server/dynamo/context/action_context.js";
import {DynamoContext} from "~/server/dynamo/context/dynamo_context.js";
import {getDynamoSeedConstants} from "~/server/dynamo/dynamo_seed_constants.js";
import {DynamoTransactionEntry} from "~/server/dynamo/helpers/dynamo_transaction_entry.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema.js";
import {
    DynamoTableItemType,
    DynamoTableSchema,
} from "~/server/dynamo/internal/dynamo_table_schema.js";
import {authorizeSpaceAccess, isAccountMemberOfSpace} from "~/server/dynamo/spaces_table.js";
import {EmailAddress} from "~/server/emails/email_address.js";
import {FromEmailAddress} from "~/server/emails/from_email_address.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {ContextCache} from "~/shared/context/cache_context_module.js";
import {
    FailedPreconditionError,
    InternalError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    ContentMentionAccountId,
    SessionId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/label_string_schema.js";
import {Schema} from "~/shared/schema/schema.js";

const AccountsTable = DynamoTableSchema.new({
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
                         * When was this account created?
                         */
                        createdTime: Schema.date,

                        /**
                         * Does this account have access to pages under `/internal`?
                         */
                        hasInternalAccess: Schema.boolean.optional(),
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
    ],
});

/**
 * We are not allowed to export our DynamoDB tables so instead export a
 * function that can only be used in test environments.
 */
export function getAccountsTableForTest() {
    assert(process.env.NODE_ENV === "test");
    return AccountsTable;
}

type AccountEmailAddressItem = DynamoTableItemType<
    typeof AccountsTable,
    "AccountEmailAddress",
    "Attributes"
>;

type AccountItem = DynamoTableItemType<typeof AccountsTable, "Account", "Attributes">;

export type SessionItem = DynamoTableItemType<typeof AccountsTable, "Session", "Attributes">;

export async function seedTestAccounts(context: DynamoContext) {
    assert(process.env.NODE_ENV !== "production");
    const {adminAccountId, adminEmailAddress} = getDynamoSeedConstants();

    await AccountsTable.createItemIfNoneExists(context, {
        partitionType: "Account",
        sortRangeType: "Attributes",
        accountId: adminAccountId,
        name: "Test Admin",
        createdTime: new Date(),
        hasInternalAccess: true,
    });

    await AccountsTable.createItemIfNoneExists(context, {
        partitionType: "AccountEmailAddress",
        sortRangeType: "Attributes",
        emailAddress: adminEmailAddress,
        accountId: adminAccountId,
        isVerified: true,
    });
}

/**
 * Transaction entry that checks to make sure an account email address does not
 * already exist.
 */
export function checkAccountEmailAddressDoesNotExistTransactionEntry(
    emailAddress: EmailAddress,
): DynamoTransactionEntry {
    return AccountsTable.transactionDoesNotExistConditionCheck({
        partitionType: "AccountEmailAddress",
        sortRangeType: "Attributes",
        emailAddress,
    });
}

/**
 * Make transaction entries that create a new account with the provided name
 * and email address. The account starts with an unverified email address.
 *
 * This is meant to be used for creating accounts during closed alpha.
 */
export function createAccountForAlphaTransactionEntries({
    id,
    name,
    emailAddress,
}: {
    id: AccountId;
    name: string;
    emailAddress: EmailAddress;
}): Array<DynamoTransactionEntry> {
    return [
        AccountsTable.transactionCreateItem({
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: id,
            name,
            createdTime: new Date(),
        }),
        AccountsTable.transactionCreateItem({
            partitionType: "AccountEmailAddress",
            sortRangeType: "Attributes",
            emailAddress,
            accountId: id,
            isVerified: false,
        }),
    ];
}

/**
 * Generates a new one time password for signing into an account with the
 * provided email address. Sends the password to the account's email address.
 */
export async function regenerateOneTimePasswordSignIn(
    context: MaybeSessionActionContext,
    emailAddress: EmailAddress,
): Promise<void> {
    const generatedTime = new Date();
    const password = generateOneTimePassword();

    await AccountsTable.updateItem(
        context,
        {
            partitionType: "AccountEmailAddress",
            sortRangeType: "Attributes",
            emailAddress,
        },
        accountEmailAddressItem => {
            if (!accountEmailAddressItem) throw accountEmailAddressNotFoundError(emailAddress);

            const hoursUntilUnlocked =
                getHoursUntilRegenerateOneTimePasswordUnlocked(accountEmailAddressItem);

            // If the account is locked, you cannot regenerate a password.
            if (hoursUntilUnlocked > 0)
                throw accountEmailAddressSignInLockedError(hoursUntilUnlocked);

            return {
                ...accountEmailAddressItem,
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
            };
        },
    );

    // We allow tests to capture one time password emails. Make sure this only
    // happens in test environments since we don't want developers to have access
    // to one time password.
    if (oneTimePasswordSignInEmailsForTest !== null) {
        assert(import.meta.jest);
        oneTimePasswordSignInEmailsForTest.push({emailAddress, oneTimePassword: password});
    }

    // We allow integration tests to capture one time password emails by
    // setting a global function.
    if (
        process.env.NODE_ENV !== "production" &&
        typeof globalThis.__logOneTimePassword === "function"
    ) {
        globalThis.__logOneTimePassword({emailAddress, oneTimePassword: password});
    }

    await context.email.send({
        fromEmailAddress: FromEmailAddress.SignIn,
        toEmailAddress: emailAddress,
        templateName: "SignIn",
        templateProps: {
            code: password,
            emailAddress,
        },
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
export function generateOneTimePassword(): string {
    const randomUint32s = new Uint32Array(6);
    crypto.getRandomValues(randomUint32s);

    const randomDigits = randomUint32s.map(randomUint32 => {
        // Convert a uint32 to a float. We divide by 0xffffffff since that's the
        // maximum uint32 value. We add 1 so that our float is in the range [0, 1)
        // (0 inclusive, 1 exclusive).
        const randomFloat = randomUint32 / (0xffffffff + 1);

        return Math.floor(randomFloat * 10);
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
    assert(import.meta.jest);

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
// We write in our `SignInEmailTemplate` copy that the code expires after one
// hour. If we change the password expiration time, we should also change
// the copy.
export const expireOneTimePasswordAfterMinutes = 60;

/**
 * Attempts to sign into the account with a one time password. After a few
 * consecutive failed attempts to sign in, we will lock the account for at
 * least 24 hours.
 */
export function attemptOneTimePasswordSignIn(
    context: DynamoContext,
    emailAddress: EmailAddress,
    oneTimePassword: string,
    {
        ipAddress,
        userAgent,
    }: {
        /**
         * What is the IP address of the client attempting to sign in? We will store
         * this with the created session to identify the device the session is for.
         */
        ipAddress: string | null;
        /**
         * What is the user agent of the client attempting to sign in? We will store
         * this with the created session to identify the device the session is for.
         */
        userAgent: string | null;
    },
): Promise<{
    sessionId: SessionId;
    sessionAccountId: AccountId;
}> {
    return context.dynamo.retryTransaction(async context => {
        const accountEmailAddressItem = await AccountsTable.getItemIfExists(context, {
            partitionType: "AccountEmailAddress",
            sortRangeType: "Attributes",
            emailAddress,
        });
        if (!accountEmailAddressItem) throw accountEmailAddressNotFoundError(emailAddress);

        if (!accountEmailAddressItem.oneTimePasswordSignInState)
            throw missingOneTimePasswordError();

        const hoursUntilUnlocked =
            getHoursUntilRegenerateOneTimePasswordUnlocked(accountEmailAddressItem);

        // Check if the account is locked.
        if (hoursUntilUnlocked > 0) throw accountEmailAddressSignInLockedError(hoursUntilUnlocked);

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
            throw missingOneTimePasswordError();
        }

        const isCorrectOneTimePassword =
            accountEmailAddressItem.oneTimePasswordSignInState.password === oneTimePassword;

        if (!isCorrectOneTimePassword) {
            await AccountsTable.directlyUpdateItem(context, {
                ...accountEmailAddressItem,
                oneTimePasswordSignInState: {
                    ...accountEmailAddressItem.oneTimePasswordSignInState,
                    failedAttemptCount:
                        accountEmailAddressItem.oneTimePasswordSignInState.failedAttemptCount + 1,
                    lastFailedAttemptTime: new Date(),
                },
            });

            const remainingAttemptCount =
                maxFailedOneTimePasswordAttemptCount -
                (accountEmailAddressItem.oneTimePasswordSignInState.failedAttemptCount + 1);

            throw new PermissionDeniedError("Incorrect one time password", {
                displayMessage: errorDisplayMessage`The sign in code does not match the one we sent to your email. ${remainingAttemptCount} attempt(s) remaining before this account is locked. If you can’t find the email, check your spam folder or try ${errorDisplayMessage.link(
                    "signing in",
                    "/sign-in",
                )} again.`,
            });
        } else {
            const sessionId = generateId<SessionId>();

            await DynamoTableSchema.executeTransaction(context, [
                AccountsTable.transactionDirectlyUpdateItem({
                    ...accountEmailAddressItem,
                    // Verify this email address.
                    isVerified: true,
                    // Remove our one-time password sign in state.
                    oneTimePasswordSignInState: undefined,
                }),
                AccountsTable.transactionCreateOrReplaceItem({
                    partitionType: "Session",
                    sortRangeType: "Attributes",
                    sessionId,
                    accountId: accountEmailAddressItem.accountId,
                    createdTime: new Date(),
                    initialIpAddress: ipAddress,
                    initialUserAgent: userAgent,
                }),
            ]);

            return {
                sessionId,
                sessionAccountId: accountEmailAddressItem.accountId,
            };
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
}: AccountEmailAddressItem): number {
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

function accountEmailAddressNotFoundError(emailAddress: string) {
    return new NotFoundError("Account email address not found", {
        displayMessage: accountEmailAddressNotFoundErrorDisplayMessage(emailAddress),
    });
}

function accountEmailAddressNotFoundErrorDisplayMessage(emailAddress: string) {
    return errorDisplayMessage`An account for “${emailAddress}” does not exist. Try again with a different email or ${errorDisplayMessage.link(
        "request access",
        "/",
    )}.`;
}

function missingOneTimePasswordError() {
    return new FailedPreconditionError("Missing one time password", {
        displayMessage: errorDisplayMessage`To sign in, you need a recent code. Try ${errorDisplayMessage.link(
            "signing in",
            "/sign-in",
        )} again to get a new code.`,
    });
}

function accountEmailAddressSignInLockedError(hoursUntilUnlocked: number) {
    return new PermissionDeniedError("Account email address is locked", {
        displayMessage: errorDisplayMessage`This account is locked after entering too many incorrect passwords. Wait ${hoursUntilUnlocked} hour(s) then try ${errorDisplayMessage.link(
            "signing in",
            "/sign-in",
        )} again.`,
    });
}

export class Session {
    public readonly id: SessionId;
    public readonly createdTime: Date;
    public readonly accountId: AccountId;
    private readonly _preloadedAccount: AccountModel | null;

    private constructor(
        sessionId: SessionId,
        sessionItem: SessionItem,
        preloadedAccount: AccountModel | null,
    ) {
        this.id = sessionId;
        this.createdTime = sessionItem.createdTime;
        this.accountId = sessionItem.accountId;
        this._preloadedAccount = preloadedAccount;
    }

    public static async getIfExists(
        context: DynamoContext,
        sessionId: SessionId,
        // Optional: As an optimization you may include the account the session is for
        // so you load both the session data and account data in parallel. If you pass
        // in the wrong account ID for the session an error will be thrown.
        sessionAccountId: AccountId | null,
    ): Promise<Session | null> {
        const [sessionItem, accountItem] = await runAllPromises([
            AccountsTable.getItemIfExists(context, {
                partitionType: "Session",
                sortRangeType: "Attributes",
                sessionId,
            }),
            sessionAccountId
                ? AccountsTable.getItemIfExists(context, {
                      partitionType: "Account",
                      sortRangeType: "Attributes",
                      accountId: sessionAccountId,
                  })
                : null,
        ]);
        if (!sessionItem) return null;

        if (sessionAccountId && sessionItem.accountId !== sessionAccountId)
            throw new PermissionDeniedError("Wrong account ID for session");

        if (sessionAccountId && !accountItem)
            throw new InternalError("Expected account referenced by session to exist");

        return new Session(
            sessionId,
            sessionItem,
            accountItem ? createAccountModelFromItem(accountItem) : null,
        );
    }

    /**
     * Allow creating a session class directly from ID and database item object
     * in tests. Can only run in test environments.
     */
    public static test(sessionItem: SessionItem) {
        assert(process.env.NODE_ENV === "test");
        return new Session(sessionItem.sessionId, sessionItem, null);
    }

    private _accountPromise: Promise<AccountModel> | null = null;

    public getAccount(context: DynamoContext): Promise<AccountModel> {
        if (this._preloadedAccount !== null) return Promise.resolve(this._preloadedAccount);

        if (this._accountPromise === null) {
            this._accountPromise = (async () =>
                assertExists(
                    await getAccountIfExistsWithoutAuthorization(context, this.accountId),
                    "Expected account referenced by session to exist",
                ))();
        }

        return this._accountPromise;
    }
}

function createAccountModelFromItem(accountItem: AccountItem) {
    return new AccountModel({
        id: accountItem.accountId,
        name: accountItem.name,
        createdTime: accountItem.createdTime,
        hasInternalAccess: accountItem.hasInternalAccess,
    });
}

/**
 * Authorizes the account for this request has internal access. Throws a
 * `PermissionDeniedError` if not.
 */
export async function authorizeInternalAccess(context: ActionContext) {
    switch (context.actor.type) {
        case "Session": {
            const account = await context.actor.getAccount();

            if (!account.hasInternalAccess)
                throw new PermissionDeniedError("Account does not have internal access", {
                    displayMessage: errorDisplayMessage`Only members of our team may access internal tools.`,
                });

            break;
        }
        case "System": {
            throw new PermissionDeniedError("System does not have internal access");
        }
        default:
            throw exhaustive(context.actor);
    }
}

const AccountContextCache = new ContextCache<
    `${SpaceId}:${ContentMentionAccountId}`,
    AccountModel | null
>();

/**
 * Get an account without authorizing whether the current context has
 * access or not.
 */
async function getAccountIfExistsWithoutAuthorization(
    context: DynamoContext,
    accountId: AccountId | ContentMentionAccountId,
) {
    const accountItem = await AccountsTable.getItemIfExists(context, {
        partitionType: "Account",
        sortRangeType: "Attributes",
        accountId: accountId as AccountId,
    });
    if (!accountItem) return null;

    return createAccountModelFromItem(accountItem);
}

/**
 * Get an account through a provided space. We can only authorize whether you
 * have access to read an account by checking that both you and the account you
 * are trying to read are members of the same space.
 *
 * If the account does not exist, we return null. If the account does exist but
 * is not a member of the provided space then we also return null.
 */
export function getAccountIfExists(
    context: ActionContext,
    spaceId: SpaceId,
    // You may call this function `ContentMentionAccountId` since it does not throw
    // when the account does not exist in the space.
    accountId: AccountId | ContentMentionAccountId,
): Promise<AccountModel | null> {
    return AccountContextCache.get(context, `${spaceId}:${accountId}`, async () => {
        // Make sure we have access to the space being requested.
        await authorizeSpaceAccess(context, spaceId);

        // If we are requesting the authenticated account then return the account model
        // from our context which may already be cached.
        if (context.actor.type === "Session" && context.actor.getAccountId() === accountId)
            return context.actor.getAccount();

        const [account, isMemberOfSpace] = await runAllPromises([
            getAccountIfExistsWithoutAuthorization(context, accountId as AccountId),
            isAccountMemberOfSpace(context, spaceId, accountId as AccountId),
        ]);

        // If the account exists but is not a member of the space provided to this
        // function then you are not allowed to read the account.
        if (!isMemberOfSpace) return null;

        return account;
    });
}

/**
 * Throw an error if the account can not be found.
 *
 * You should not call this function with `ContentMentionAccountId`! Instead
 * you should call `getAccountIfExists()` since `ContentMentionAccountId` may
 * reference an account in a different space you don't have access to. You
 * should get a type error if you try to call this function
 * with `ContentMentionAccountId`.
 */
export async function getAccount(
    context: ActionContext,
    spaceId: SpaceId,
    accountId: AccountId,
): Promise<AccountModel> {
    const account = await getAccountIfExists(context, spaceId, accountId);
    if (!account) throw new NotFoundError("Can not find account in space");
    return account;
}
