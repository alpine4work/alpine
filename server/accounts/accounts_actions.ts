import {differenceInHours, differenceInMinutes, subHours} from "date-fns";
import {AccountDevicesIndex, AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {
    DynamoActorContextModule,
    DynamoSessionActorContextModule,
    SessionInterface,
} from "~/server/context/dynamo_actor_context_module.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {DynamoContext, DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getDynamoSeedConstants} from "~/server/dynamo/core/dynamo_seed_constants.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {EmailAddress, validateEmailAddress} from "~/server/emails/email_address.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {
    AccountModelWithoutSpace,
    unknownAccountId,
} from "~/shared/accounts/account_model_without_space.js";
import {ServerConstantsContextModule} from "~/shared/context/constants_context_module.js";
import {Context} from "~/shared/context/context.js";
import {
    FailedPreconditionError,
    InternalError,
    NotFoundError,
    PermissionDeniedError,
    UnimplementedError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, AvatarId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";

/**
 * NOTE: this file is currently being split up. We do not anticipate adding more methods here.
 */

/**
 * The email address we provide to Apple that lets a reviewer sign into our
 * app and try it out.
 *
 * Try to special case as little as possible for this email address!
 */
export const appleReviewerAccountEmailAddress = "apple.reviewer@alpine.inc" as EmailAddress;

/**
 * This is a secret string shared between our company and Apple. An Apple
 * reviewer may use this string to log into a space made just for them. It's
 * not that big a deal if the string leaks. All the account has access to is
 * their own space.
 */
const appleReviewerAccountPassword = "968706";

export function getAppleReviewerAccountPasswordForTest() {
    assert(import.meta.jest);
    return appleReviewerAccountPassword;
}

type AccountEmailAddressItem = DynamoTableItemType<
    typeof AccountsTable,
    "AccountEmailAddress",
    "Attributes"
>;

type AccountAttributesItem = DynamoTableItemType<typeof AccountsTable, "Account", "Attributes">;
type AccountAvatarItem = DynamoTableItemType<typeof AccountsTable, "Account", "Avatar">;
type AccountItem = AccountAttributesItem & {
    readonly avatar: AccountAvatarItem | null;
};
export type SessionItem = DynamoTableItemType<typeof AccountsTable, "Session", "Attributes">;

async function getAccountItem(
    context: DynamoContext,
    accountId: AccountId,
    {consistency = "Eventual"}: {consistency?: DynamoReadConsistency} = {},
): Promise<AccountItem> {
    const item = await getAccountItemIfExists(context, accountId, {consistency});
    if (!item) throw new NotFoundError("Account not found");
    return item;
}

// NOTE(ifitzsimmons, 2025-08-10):
// DynamoDB cost optimization: We query both Attributes and Avatar items in a single
// operation to consume only 1 RCU. Since avatars are <3KB, the combined size stays
// within DynamoDB's 4KB item limit, making this more cost-effective than separate
// requests while maintaining the flexibility to fetch account metadata independently.
async function getAccountItemIfExists(
    context: DynamoContext,
    accountId: AccountId,
    {consistency = "Eventual"}: {consistency?: DynamoReadConsistency} = {},
): Promise<AccountItem | null> {
    const items = await arrayFromAsyncIterable(
        AccountsTable.query(context, {
            limit: 2,
            partitionKey: {
                partitionType: "Account",
                accountId,
            },
            startSortKey: {sortRangeType: "Attributes"},
            endSortKey: {sortRangeType: "Avatar"},
            consistency,
        }),
    );

    const attributesItem = findMapIterable(items, item =>
        item.sortRangeType === "Attributes" ? item : undefined,
    );
    if (!attributesItem) return null;

    const avatarItem = findMapIterable(items, item =>
        item.sortRangeType === "Avatar" ? item : undefined,
    );

    return {
        avatar: avatarItem ?? null,
        ...attributesItem,
    };
}

/**
 * Create an account but only in test environments.
 */
export async function createAccountForTest(
    context: DynamoContext,
    {
        id = generateId<AccountId>(),
        name,
        hasInternalAccess = false,
        createdTime = new Date(),
    }: {
        id?: AccountId;
        name: string;
        hasInternalAccess?: boolean;
        createdTime?: Date;
    },
) {
    assert(process.env.NODE_ENV === "test");

    await AccountsTable.createItem(context, {
        partitionType: "Account",
        sortRangeType: "Attributes",
        accountId: id,
        name,
        nameVersion: 0,
        createdTime,
        hasInternalAccess,
    });

    return {createdTime};
}

/**
 * Create an email address associated with the provided account in a test
 * environment.
 */
export async function createAccountEmailAddressForTest(
    context: DynamoContext,
    {
        accountId,
        emailAddress,
        isEmailAddressVerified,
    }: {
        accountId: AccountId;
        emailAddress: EmailAddress;
        isEmailAddressVerified: boolean;
    },
) {
    assert(process.env.NODE_ENV === "test");

    // This is a test. We assume the `AccountId` exists.

    await AccountsTable.createItem(context, {
        partitionType: "AccountEmailAddress",
        sortRangeType: "Attributes",
        emailAddress,
        accountId,
        isVerified: isEmailAddressVerified,
    });
}

/**
 * Create a session but only in test environments. This is not secure! We must
 * only create sessions if the actual owner of the account is authorizing with
 * our service.
 */
export async function createSessionForTest(
    context: DynamoContext,
    {id = generateId<SessionId>(), accountId}: {id?: SessionId; accountId: AccountId},
) {
    assert(process.env.NODE_ENV === "test");

    const createdTime = new Date();

    await AccountsTable.createItem(context, {
        partitionType: "Session",
        sortRangeType: "Attributes",
        sessionId: id,
        accountId,
        createdTime,
        initialIpAddress: null,
        initialUserAgent: null,
    });

    return {createdTime};
}

/**
 * Get the item representing an email address associated with an account for tests.
 */
export async function getAccountEmailAddressForTest(
    context: DynamoContext,
    emailAddress: EmailAddress,
) {
    assert(process.env.NODE_ENV === "test");

    return AccountsTable.getItem(context, {
        partitionType: "AccountEmailAddress",
        sortRangeType: "Attributes",
        emailAddress,
    });
}

export async function seedTestAccounts(context: DynamoContext) {
    assert(process.env.NODE_ENV !== "production");
    const {adminAccountId, adminEmailAddress} = getDynamoSeedConstants();

    await AccountsTable.createItemIfNoneExists(context, {
        partitionType: "Account",
        sortRangeType: "Attributes",
        accountId: adminAccountId,
        name: "Test Admin",
        nameVersion: 0,
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
export function checkAccountVersionConditionCheck(
    account: AccountModelWithoutSpace,
): DynamoTransactionEntry {
    return AccountsTable.transactionUpdateLockVersionConditionCheck(
        {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: account.id,
        },
        // `AccountModel.initialData.version` is the same as `updateLockVersion`.
        account.initialData.version,
    );
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
export function createAccountTransactionEntries({
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
            nameVersion: 0,
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
 * Get any `AccountModelWithoutSpace` by `AccountId`. The actor must have
 * internal access to make this request.
 */
export async function getAccountByIdAsAdmin(
    context: ServerActionContext,
    accountId: AccountId,
): Promise<AccountModelWithoutSpace> {
    await authorizeInternalAccess(context);

    // Pretend like the unknown account doesn't exist. We do have an unknown
    // account record in our database as a safety precaution to make sure we
    // don't accidentally create an account with the unknown `AccountId`. But we
    // should never return that data. Instead if you want data for an unknown
    // account call `AccountModel.getUnknown()`.
    //
    // Calling `getAccount(unknownAccountId)` should always fail with a not
    // found error.
    if (accountId === unknownAccountId)
        throw new NotFoundError("Unknown account is treated as if it doesn’t exist");
    const accountItem = await getAccountItem(context, accountId);

    return createAccountModelFromItem(accountItem);
}

/**
 * Get any `AccountModelWithoutSpace` by `EmailAddress`. The actor must have
 * internal access to make this request.
 */
export async function getAccountByEmailAddressAsAdmin(
    context: ServerActionContext,
    emailAddress: string,
): Promise<AccountModelWithoutSpace> {
    await authorizeInternalAccess(context);

    const accountEmailAddressItem = await AccountsTable.getItem(context, {
        partitionType: "AccountEmailAddress",
        sortRangeType: "Attributes",
        emailAddress: await validateEmailAddress(context, emailAddress),
    });

    const accountItem = await getAccountItem(context, accountEmailAddressItem.accountId);

    return createAccountModelFromItem(accountItem);
}

/**
 * Get the AccountId associated with an email address, if one exists.
 *
 * Security considerations:
 *   This function allows determining whether an email address has signed up for Alpine
 *   and obtaining their AccountId. This is considered an acceptable information leak since:
 *     a) On the sign-in page, we already reveal whether an account exists
 *     b) An AccountId alone provides no access without additional authentication
 *   Additionally, there's no way to directly call this function from the client.
 */
export async function getAccountIdByEmailAddressIfExists(
    context: ServerActionContext,
    emailAddress: string,
): Promise<AccountId | null> {
    const accountEmailAddressItem = await AccountsTable.getItemIfExists(context, {
        partitionType: "AccountEmailAddress",
        sortRangeType: "Attributes",
        emailAddress: await validateEmailAddress(context, emailAddress),
    });

    if (!accountEmailAddressItem) {
        return null;
    }

    return accountEmailAddressItem.accountId;
}

/**
 * Generates a new one time password for signing into an account with the
 * provided email address. Sends the password to the account's email address.
 */
export async function regenerateOneTimePasswordSignIn(
    context: Context<
        DynamoContextModules & {email: EmailContextModuleBase} & {
            constants: ServerConstantsContextModule;
        }
    >,
    emailAddress: EmailAddress,
): Promise<void> {
    const generatedTime = new Date();

    // The Apple reviewer gets the same constant password every time since they
    // don't have access to the email address (we control the email address).
    const password =
        emailAddress === appleReviewerAccountEmailAddress
            ? appleReviewerAccountPassword
            : generateOneTimePassword();

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

    // In development (or Playwright integration tests), log the one time password
    // so developers can sign in. In integration tests we watch the app service
    // stdout for this log line and capture it so we can use the one time password
    // to log in.
    if (process.env.NODE_ENV === "development" || process.env.PLAYWRIGHT_TEST_PATH) {
        // eslint-disable-next-line no-console
        console.log(quote`The one time password for ${emailAddress} is ${password}`);
    }

    await context.email.sendImmediately({
        fromEmailAddressAlias: "SignIn",
        toEmailAddress: emailAddress,
        templateName: "SignIn",
        templateProps: {
            code: password,
            baseUrl: context.constants.edgeServiceUrl,
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
                displayMessage: errorDisplayMessage`The sign in code does not match the one we sent to your email. ${remainingAttemptCount} attempt(s) remaining before this account is locked. If you can’t find the email, check your spam folder or try ${errorDisplayMessage.signInLink(
                    "signing in",
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
        displayMessage: errorDisplayMessage`To sign in, you need a recent code. Try ${errorDisplayMessage.signInLink(
            "signing in",
        )} again to get a new code.`,
    });
}

function accountEmailAddressSignInLockedError(hoursUntilUnlocked: number) {
    return new PermissionDeniedError("Account email address is locked", {
        displayMessage: errorDisplayMessage`This account is locked after entering too many incorrect passwords. Wait ${hoursUntilUnlocked} hour(s) then try ${errorDisplayMessage.signInLink(
            "signing in",
        )} again.`,
    });
}

/**
 * Rewind an email address's one time password sign in state by some number of
 * hours. This allows us to test cases where time has passed after the user
 * tried to sign in.
 */
export async function rewindAccountEmailAddressOneTimePasswordSignInStateTimeForTest(
    context: DynamoContext,
    emailAddress: EmailAddress,
    hours: number,
) {
    assert(process.env.NODE_ENV === "test");

    await AccountsTable.updateItem(
        context,
        {
            partitionType: "AccountEmailAddress",
            sortRangeType: "Attributes",
            emailAddress,
        },
        accountEmailAddressItem => {
            assert(accountEmailAddressItem?.oneTimePasswordSignInState);

            return {
                ...accountEmailAddressItem,
                oneTimePasswordSignInState: {
                    ...accountEmailAddressItem.oneTimePasswordSignInState,
                    generatedTime: subHours(
                        accountEmailAddressItem.oneTimePasswordSignInState.generatedTime,
                        hours,
                    ),
                    lastFailedAttemptTime: accountEmailAddressItem.oneTimePasswordSignInState
                        .lastFailedAttemptTime
                        ? subHours(
                              accountEmailAddressItem.oneTimePasswordSignInState
                                  .lastFailedAttemptTime,
                              hours,
                          )
                        : null,
                },
            };
        },
    );
}

export class Session implements SessionInterface {
    public readonly id: SessionId;
    public readonly accountId: AccountId;
    private readonly _preloadedAccount: {
        readonly account: AccountModelWithoutSpace;
        readonly hasInternalAccess: boolean;
    } | null;

    private constructor(
        id: SessionId,
        accountId: AccountId,
        preloadedAccount: {
            readonly account: AccountModelWithoutSpace;
            readonly hasInternalAccess: boolean;
        } | null,
    ) {
        this.id = id;
        this.accountId = accountId;
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
            sessionAccountId ? getAccountItemIfExists(context, sessionAccountId) : null,
        ]);
        if (!sessionItem) return null;

        if (sessionAccountId && sessionItem.accountId !== sessionAccountId)
            throw new PermissionDeniedError("Wrong account ID for session");

        if (sessionAccountId && !accountItem)
            throw new InternalError("Expected account referenced by session to exist");

        return new Session(
            sessionId,
            sessionItem.accountId,
            accountItem
                ? {
                      account: createAccountModelFromItem(accountItem),
                      hasInternalAccess: accountItem.hasInternalAccess ?? false,
                  }
                : null,
        );
    }

    /**
     * Allow creating a session class directly from ID and database item object
     * in tests. Can only run in test environments.
     */
    public static test(
        sessionItem:
            | {id: SessionId; account: {id: AccountId}}
            | {sessionId: SessionId; accountId: AccountId},
    ) {
        assert(process.env.NODE_ENV === "test");

        // Support passing in a session model object (e.g. `TestScenarioSession`) and
        // passing a `SessionItem` object in directly.
        if ("id" in sessionItem) {
            return new Session(sessionItem.id, sessionItem.account.id, null);
        } else {
            return new Session(sessionItem.sessionId, sessionItem.accountId, null);
        }
    }

    private _accountPromise: Promise<{
        readonly account: AccountModelWithoutSpace;
        readonly hasInternalAccess: boolean;
    }> | null = null;

    public getAccountAndHasInternalAccess(context: DynamoContext): Promise<{
        readonly account: AccountModelWithoutSpace;
        readonly hasInternalAccess: boolean;
    }> {
        if (this._preloadedAccount !== null) return Promise.resolve(this._preloadedAccount);

        if (this._accountPromise === null) {
            this._accountPromise = (async () =>
                assertExists(
                    await dangerouslyGetAccountAndHasInternalAccessIfExistsWithoutCaching(
                        context,
                        this.accountId,
                    ),
                    "Expected account referenced by session to exist",
                ))();
        }

        return this._accountPromise;
    }

    public async getAccount(context: DynamoContext): Promise<AccountModelWithoutSpace> {
        const {account} = await this.getAccountAndHasInternalAccess(context);
        return account;
    }
}

function createAccountModelFromItem(accountItem: AccountItem) {
    return new AccountModelWithoutSpace({
        id: accountItem.accountId,
        version: accountItem.updateLockVersion ?? 0,
        name: accountItem.name,
        nameVersion: accountItem.nameVersion ?? 0,
        avatar: accountItem.avatar
            ? {
                  avatarId: accountItem.avatar.avatarId,
                  content: accountItem.avatar.content,
                  version: accountItem.avatar.updateLockVersion ?? 0,
              }
            : null,
    });
}

/**
 * Authorizes the account for this request has internal access. Throws a
 * `PermissionDeniedError` if not.
 */
export async function authorizeInternalAccess(context: Context<{actor: DynamoActorContextModule}>) {
    switch (context.actor.type) {
        case "Session": {
            const {hasInternalAccess} = await context.actor.getAccountAndHasInternalAccess();

            if (!hasInternalAccess) {
                throw new PermissionDeniedError("Account does not have internal access", {
                    displayMessage: errorDisplayMessage`Only members of our team may access internal tools.`,
                });
            }
            break;
        }
        case "System": {
            throw new PermissionDeniedError("System actor does not have internal access");
        }
        case "ImpersonatedAccount": {
            // TODO(calebmer): Implement this when we need it in the future.
            throw new UnimplementedError(
                "Impersonated account actor does not have internal access",
            );
        }
        case "Anonymous": {
            throw unauthenticatedSessionError();
        }
        default:
            throw exhaustive(context.actor);
    }
}

/**
 * Get an account without authorizing whether the current context has
 * access or not.
 *
 * You should not call this function! It does not authorize that you are
 * allowed to access the account and does not cache accounts. Instead use
 * `getAccountIfExists()` in `server/spaces/spaces_table.ts`.
 */
async function dangerouslyGetAccountAndHasInternalAccessIfExistsWithoutCaching(
    context: DynamoContext,
    accountId: AccountId,
    {consistency = "Eventual"}: {consistency?: DynamoReadConsistency} = {},
) {
    // Pretend like the unknown account doesn't exist. We do have an unknown
    // account record in our database as a safety precaution to make sure we
    // don't accidentally create an account with the unknown `AccountId`. But we
    // should never return that data. Instead if you want data for an unknown
    // account call `AccountModel.getUnknown()`.
    //
    // Calling `getAccount(unknownAccountId)` should always fail with a not
    // found error.
    if (accountId === unknownAccountId) return null;

    const accountItem = await getAccountItemIfExists(context, accountId, {consistency});
    if (!accountItem) return null;

    return {
        account: createAccountModelFromItem(accountItem),
        hasInternalAccess: accountItem.hasInternalAccess ?? false,
    };
}

/**
 * Get an account without authorizing whether the current context has
 * access or not.
 *
 * You should not call this function! It does not authorize that you are
 * allowed to access the account and does not cache accounts. Instead use
 * `getAccountIfExists()` in `server/spaces/spaces_table.ts`.
 */
export async function dangerouslyGetAccountIfExistsWithoutCaching(
    context: DynamoContext,
    accountId: AccountId,
    {consistency = "Eventual"}: {consistency?: DynamoReadConsistency} = {},
) {
    // Pretend like the unknown account doesn't exist. We do have an unknown
    // account record in our database as a safety precaution to make sure we
    // don't accidentally create an account with the unknown `AccountId`. But we
    // should never return that data. Instead if you want data for an unknown
    // account call `AccountModel.getUnknown()`.
    //
    // Calling `getAccount(unknownAccountId)` should always fail with a not
    // found error.
    if (accountId === unknownAccountId) return null;

    const accountItem = await getAccountItemIfExists(context, accountId, {consistency});
    if (!accountItem) return null;

    return createAccountModelFromItem(accountItem);
}

export const updateOurAccountNameBeforeExecuteTestCheckpoint = new TestCheckpoint<AccountId>();

/**
 * Updates an account's name. When we update an account's name we also need to
 * update our search index and task index since the account name is present in
 * both indexes.
 */
export async function updateOurAccountName(
    context: ServerSessionActionContext,
    name: string,
    {nameVersionForTest}: {nameVersionForTest?: number} = {},
): Promise<AccountModelWithoutSpace> {
    LabelStringSchema.validate?.(name, {
        errorDisplayMessagePrefix: errorDisplayMessage`The name you typed`,
    });

    return context.dynamo.retryTransaction(async context => {
        const accountItem = await getAccountItem(context, context.actor.getAccountId());

        // Can only set `nameVersionForTest` in unit tests.
        assert(
            nameVersionForTest === undefined ||
                (import.meta.jest && nameVersionForTest > accountItem.nameVersion),
        );

        const nameVersion = nameVersionForTest ?? accountItem.nameVersion + 1;

        // We commit an update account name task action in all the spaces an account is in.
        const {spaceIds, getConditionCheckTransactionEntry} =
            await context.spacesInjection.getOurAccountSpaceIds();

        const taskTransactionEntries =
            context.tasksInjection.internalGetUpdateOurAccountNameTaskTransactionEntries({
                spaceIds,
                name,
                nameVersion,
            });

        await updateOurAccountNameBeforeExecuteTestCheckpoint.waitForTest(
            context.actor.getAccountId(),
        );

        const newAccountItem = {
            ...accountItem,
            name,
            nameVersion,
        };

        const transactionEntries = [
            AccountsTable.transactionDirectlyUpdateItem(newAccountItem),
            ...taskTransactionEntries,
        ];

        // Don't commit if the account's spaces changed without us knowing.
        {
            const transactionEntry = getConditionCheckTransactionEntry();
            if (transactionEntry) transactionEntries.push(transactionEntry);
        }

        await DynamoTableSchema.executeTransaction(context, transactionEntries);

        // Reindex the account in all space search indexes where it appears. This may
        // recursively update any search entities where the account is mentioned.
        for (const spaceId of spaceIds) {
            context.jobs.send({
                type: "IndexSearchEntity",
                spaceId,
                update: {
                    type: "Account",
                    accountId: newAccountItem.accountId,
                    updatedTraits: {type: "Some", traits: ["WithoutSpace"]},
                },
            });
        }

        return createAccountModelFromItem(newAccountItem);
    });
}

/**
 * Updates our last opened `SpaceId`.
 */
export async function updateOurLastOpenedSpaceId(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
): Promise<void> {
    const accountSettingsItem = await AccountsTable.getItemIfExists(context, {
        partitionType: "Account",
        sortRangeType: "Settings",
        accountId: context.actor.getAccountId(),
    });

    const {spaceIds} = await context.spacesInjection.getOurAccountSpaceIds();

    if (!spaceIds.has(spaceId)) {
        throw new PermissionDeniedError("You don’t have access to this space.");
    }

    if (accountSettingsItem) {
        const updatedAccountSettingsItem = {
            ...accountSettingsItem,
            lastOpenedSpaceId: spaceId,
        };

        await AccountsTable.directlyUpdateItem(context, updatedAccountSettingsItem);
    } else {
        const newAccountSettingsItem = {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId: context.actor.getAccountId(),
            lastOpenedSpaceId: spaceId,
        } as const;

        await AccountsTable.createItem(context, newAccountSettingsItem);
    }
}

export async function getAccountSettingsForTest(
    context: DynamoContext,
    accountId: AccountId,
): Promise<{
    lastOpenedSpaceId: SpaceId | undefined;
}> {
    assert(process.env.NODE_ENV === "test");

    const accountSettingsItem = await AccountsTable.getItemIfExists(context, {
        partitionType: "Account",
        sortRangeType: "Settings",
        accountId,
    });

    return {
        lastOpenedSpaceId: accountSettingsItem?.lastOpenedSpaceId,
    };
}

export async function getOurLastOpenedSpaceId(
    context: ServerSessionActionContext,
): Promise<SpaceId> {
    const accountSettingsItem = await AccountsTable.getItemIfExists(context, {
        partitionType: "Account",
        sortRangeType: "Settings",
        accountId: context.actor.getAccountId(),
    });

    const {spaceIds} = await context.spacesInjection.getOurAccountSpaceIds();

    if (
        !accountSettingsItem?.lastOpenedSpaceId ||
        !spaceIds.has(accountSettingsItem.lastOpenedSpaceId)
    ) {
        return spaceIds.size > 0 ? spaceIds.values().next().value : null;
    }

    return accountSettingsItem.lastOpenedSpaceId;
}

/**
 * Save a 32-byte Apple device token for the acting account.
 *
 * If the device token was already registered with a different account then
 * this will override the `AccountId` associated with the device token. This is
 * acceptable since device tokens are unguessable. If a device wants to change
 * its `AccountId` (since the user signed out then back in) it may do so.
 */
export async function registerOurAccountAppleDeviceToken(
    context: Context<DynamoContextModules & {actor: DynamoSessionActorContextModule}>,
    deviceToken: Uint8Array,
): Promise<void> {
    // This method is called every time our iOS app is opened in case the device
    // token has changed. So it's ok to replace the existing item.
    await AccountsTable.createOrReplaceItem(context, {
        partitionType: "AppleDeviceToken",
        sortRangeType: "Attributes",
        deviceToken,
        accountId: context.actor.getAccountId(),
    });
}

export type AccountDevice = {
    readonly type: "Apple";
    readonly deviceToken: Uint8Array;
};

/**
 * Get all devices registered for the provided `AccountId`. System actors can
 * see the registered devices for any account since we need to send push
 * notifications to the account's devices as the system actor.
 *
 * You should use `getRegisteredAccountDevices()` in `spaces_table.ts` since it
 * authorizes that the actor is allowed to read the account's registered
 * devices.
 */
export async function internalGetRegisteredAccountDevicesWithoutAuthorization(
    context: Context<DynamoContextModules & {actor: DynamoActorContextModule}>,
    accountId: AccountId,
): Promise<ReadonlyArray<AccountDevice>> {
    return arrayFromAsyncIterable(
        AccountDevicesIndex.query(context, {partitionKey: {accountId}, limit: "All"}),
        (item): AccountDevice => ({type: "Apple", deviceToken: item.deviceToken}),
    );
}

/**
 * Delete a device token associated with the provided `AccountId`. System
 * actors can delete the device token for any account whereas session actors
 * may only delete device tokens for their own account.
 *
 * If the provided device token doesn't exist (or was already deleted) this
 * function does nothing.
 */
export async function deleteAccountAppleDeviceTokenIfExists(
    context: Context<DynamoContextModules & {actor: DynamoActorContextModule}>,
    accountId: AccountId,
    deviceToken: Uint8Array,
): Promise<void> {
    switch (context.actor.type) {
        case "Session":
        case "ImpersonatedAccount": {
            if (context.actor.getAccountId() !== accountId) {
                throw new PermissionDeniedError(
                    "Can’t delete device token for a different account",
                );
            }
            break;
        }
        case "System": {
            // System actor can delete device tokens for any account...
            break;
        }
        case "Anonymous": {
            throw unauthenticatedSessionError();
        }
        default:
            throw exhaustive(context.actor);
    }

    await AccountsTable.deleteItemWithKeyIfExists(context, {
        partitionType: "AppleDeviceToken",
        sortRangeType: "Attributes",
        deviceToken,
        accountId,
    });
}

export async function updateAccountAvatar(
    context: Context<DynamoContextModules & {actor: DynamoSessionActorContextModule}>,
    {
        avatarContent,
        avatarId,
    }: {
        avatarContent: Uint8Array;
        avatarId: AvatarId;
    },
): Promise<AccountModelWithoutSpace> {
    // NOTE(ifitzsimmons, 2025-08-15): TypeScript doesn't like this line and I have no idea why.
    // It seems to be confused about the context type. I don't have any concrete plan to fix this.
    // I think in an ideal state, I would just use the DynamoServerSessionContext, but that
    // introduces a circular dependency on the on //server/accounts. If we can decouple
    // //server/context and //server/accounts, we should use DynamoServerSessionContext above.
    // @ts-expect-error
    context.actor.authorizeSession();

    const accountId = context.actor.getAccountId();
    const oldAccountItem = await getAccountItem(context, accountId);
    const oldAccountAvatar = oldAccountItem.avatar;

    const newAvatarItem: AccountAvatarItem = {
        ...oldAccountAvatar,
        partitionType: "Account",
        sortRangeType: "Avatar",
        accountId,
        avatarId,
        content: avatarContent,
    };

    return context.dynamo.retryTransaction(async context => {
        // NOTE(ifitzsimmons, 2025-08-15): We considered adding a check to ensure that the
        // new avatarId is newer than the old avatarId. We opted against that for now, see
        // reasoning here: https://app.graphite.dev/github/pr/cyberworlds/cyberworlds/312/add-rpc-implementation-for-uploading-account-avatars#comment-PRRC_kwDOH2ktg86H2sCi
        const accountAvatarItem = await AccountsTable.directlyUpdateItem(context, newAvatarItem);

        return createAccountModelFromItem({
            ...oldAccountItem,
            avatar: accountAvatarItem,
        });
    });
}
