import {ServerSessionActionContextWithEmail} from "~/server/context/server_action_context.js";
import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {inviteEmailAddressesToSpace} from "~/server/spaces/invite_email_addresses_to_space.js";
import {
    acceptSpaceAccountInvite,
    addSpaceAccountForTest,
    createSpaceForTest,
    getSpace,
    isAccountMemberOfSpaceWithoutAuthorization,
    rejectSpaceAccountInviteAsSpam,
    removeSpaceAccount,
} from "~/server/spaces/spaces_table.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {SystemTokenPayload} from "~/server/tokens/token_payload.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {Tuple} from "~/shared/helpers/types/tuple.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {SpaceRole} from "~/shared/spaces/space_model.js";

let testSpaceCount = 1;

/**
 * Our test object system gives you a way to quickly set up scenarios for your
 * unit and integration tests.
 *
 * When migrating tests from the old style (`createTestSpace()` and
 * `createTestSession()`) we wrap old tests in a `describe()` block labeled
 * `"old style"` and write new tests beneath with our test objects.
 *
 * ## Conventions
 *
 * - Avoid properties on the test object that change. Instead provide getters
 *   that read from the database. You may have a property that changes if you
 *   prefix it with "initial" like `initialName` if that's useful.
 *
 * - Provide low-level convenience helpers off dot methods like
 *   `space.createSession()` and `task.updatePriority()`.
 *
 * - Don't `return this` from update methods. Update chaining unfortunately
 *   isn't a good style for asynchronous functions.
 */
export class TestSpace {
    public readonly context: TestContext;
    public readonly id: SpaceId;

    private constructor(context: TestContext, spaceId: SpaceId) {
        this.context = context;
        this.id = spaceId;
    }

    public static async create(
        context: TestContext,
        {
            name = `Test Space ${testSpaceCount++}`,
        }: {
            name?: string;
        } = {},
    ) {
        const id = generateId<SpaceId>();

        await createSpaceForTest(context, {
            id,
            name,
        });

        const space = new TestSpace(context, id);

        return space;
    }

    public getTokenPayload(): SystemTokenPayload {
        return {type: "System", spaceId: this.id};
    }

    /**
     * Get a `TestSpace` helper object for an existing space. In case you didn't
     * create the space with `TestSpace.create()`. Throws an error if the space
     * doesn't already exist.
     */
    public static async get(context: TestContext, id: SpaceId) {
        // Confirm the space exists.
        await getSpace(context.systemAction(id), id);

        return new TestSpace(context, id);
    }

    public systemAction() {
        return this.context.systemAction(this.id);
    }

    public impersonatedAction(account: AccountId | TestAccount | TestSpaceSession) {
        return this.context.impersonatedAccountAction(
            this.id,
            account instanceof TestSpaceSession
                ? account.account.id
                : account instanceof TestAccount
                ? account.id
                : account,
        );
    }

    public async createSession(
        account?:
            | TestAccount
            | {
                  id?: AccountId;
                  name?: string;
                  hasInternalAccess?: boolean;
                  role?: SpaceRole;
              },
    ): Promise<TestSpaceSession> {
        let role: SpaceRole | undefined;
        let actualAccount: TestAccount;

        if (account instanceof TestAccount) {
            actualAccount = account;
        } else {
            role = account?.role;
            actualAccount = await TestAccount.create(this.context, account);
        }

        const [session] = await runAllPromises([
            TestSpaceSession._create(this, actualAccount),
            this.addAccountIfNotExists(actualAccount, role),
        ]);

        return session;
    }

    public createSessions<N extends number>(count: N): Promise<Tuple<TestSpaceSession, N>>;
    public createSessions(count: number): Promise<Array<TestSpaceSession>> {
        return runAllPromises(createArrayWithLength(count, () => this.createSession()));
    }

    public async addAccount(account?: TestAccount | TestSession, role?: SpaceRole) {
        let actualAccount: TestAccount;

        if (account instanceof TestAccount) {
            actualAccount = account;
        } else if (account instanceof TestSession) {
            actualAccount = account.account;
        } else {
            actualAccount = await TestAccount.create(this.context, account);
        }

        await addSpaceAccountForTest(this.context, {
            spaceId: this.id,
            accountId: actualAccount.id,
            role: role ?? "Member",
        });

        await this.acceptInviteForAccountIfNeeded(actualAccount);

        return actualAccount;
    }

    public async removeAccount(account: TestAccount | TestSession) {
        await removeSpaceAccount(this.systemAction(), {
            spaceId: this.id,
            accountId: account instanceof TestSession ? account.account.id : account.id,
        });
    }

    public async addAccountIfNotExists(account: TestAccount | TestSession, role?: SpaceRole) {
        if (
            await isAccountMemberOfSpaceWithoutAuthorization(
                this.context.clone({cache: CacheContextModule.new()}),
                this.id,
                account instanceof TestSession ? account.account.id : account.id,
            )
        ) {
            return;
        }

        await this.addAccount(account, role);

        return;
    }

    private async acceptInviteForAccountIfNeeded(account: TestAccount | TestSession) {
        if (
            await isAccountMemberOfSpaceWithoutAuthorization(
                this.context.clone({cache: CacheContextModule.new()}),
                this.id,
                account instanceof TestSession ? account.account.id : account.id,
            )
        ) {
            return;
        }

        const session =
            account instanceof TestSession
                ? account
                : await TestSpaceSession._create(this, account);

        await acceptSpaceAccountInvite(session.action(), this.id);
    }

    /**
     * Invites a valid email address to the space.
     * If you're expecting to validate errors from this call, use
     * inviteEmailAddressesToSpace directly.
     */
    public async inviteEmailAddress(
        context: ServerSessionActionContextWithEmail,
        emailAddress: string,
    ) {
        const result = await inviteEmailAddressesToSpace(context, {
            spaceId: this.id,
            emailAddresses: [emailAddress],
        });

        const account = assertExists(
            result.accounts[0],
            `Expected an account to be created from the email invite, got ${
                result.alreadyMemberEmailAddresses.length
                    ? "alreadyMember"
                    : result.invalidEmailAddresses.length
                    ? "invalidEmail"
                    : result.rejectedAsSpamEmailAddresses.length
                    ? "rejectedAsSpam"
                    : result.unexpectedFailureEmailAddresses.size
                    ? `unexpectedFailure:\n${
                          result.unexpectedFailureEmailAddresses.values().next().value
                      }`
                    : "none"
            }`,
        );

        return account;
    }

    /**
     * Invites a valid email address to the space and creates a session for the created account.
     * If you're expecting to validate errors from this call, use
     * inviteEmailAddressesToSpace directly.
     */
    public async inviteEmailAddressAndCreateSession(
        context: ServerSessionActionContextWithEmail,
        emailAddress: string,
    ) {
        const account = await this.inviteEmailAddress(context, emailAddress);

        const testAccount = await TestAccount.get(this.context, account.id);
        const session = await TestSpaceSession._create(this, testAccount);

        return {
            session,
            acceptInvite: async () => {
                await acceptSpaceAccountInvite(session.action(), this.id);
            },
            rejectInviteAsSpam: async () => {
                await rejectSpaceAccountInviteAsSpam(session.action(), this.id);
            },
        };
    }
}
