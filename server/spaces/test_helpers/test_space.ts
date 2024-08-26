import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    addSpaceAccountForTest,
    createSpaceForTest,
    getSpace,
    isAccountMemberOfSpaceWithoutAuthorization,
} from "~/server/spaces/spaces_table.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {Tuple} from "~/shared/helpers/types/tuple.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

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

        return new TestSpace(context, id);
    }

    public getTokenPayload() {
        return {type: "System" as const, spaceId: this.id};
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

    public async createSession(
        account?: TestAccount | {name?: string; hasInternalAccess?: boolean},
    ): Promise<TestSpaceSession> {
        if (!account || !(account instanceof TestAccount)) {
            account = await TestAccount.create(this.context, account);
        }

        const [session] = await runAllPromises([
            TestSpaceSession._create(this, account),
            this.addAccountIfNotExists(account),
        ]);

        return session;
    }

    public createSessions<N extends number>(count: N): Promise<Tuple<TestSpaceSession, N>>;
    public createSessions(count: number): Promise<Array<TestSpaceSession>> {
        return runAllPromises(createArrayWithLength(count, () => this.createSession()));
    }

    public async addAccount(account: TestAccount | TestSession) {
        await addSpaceAccountForTest(this.context, {
            spaceId: this.id,
            accountId: account instanceof TestSession ? account.account.id : account.id,
        });
    }

    public async addAccountIfNotExists(account: TestAccount | TestSession) {
        if (
            await isAccountMemberOfSpaceWithoutAuthorization(
                this.context.clone({cache: new CacheContextModule()}),
                this.id,
                account instanceof TestSession ? account.account.id : account.id,
            )
        ) {
            return;
        }

        await this.addAccount(account);
    }
}
