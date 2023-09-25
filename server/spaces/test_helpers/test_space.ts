import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createSpaceAccountForTest, createSpaceForTest} from "~/server/spaces/spaces_table.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
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

    public systemAction() {
        return this.context.systemAction(this.id);
    }

    public async createSession(account?: TestAccount) {
        if (!account) {
            account = await TestAccount.create(this.context);
        }

        const [session] = await runAllPromises([
            TestSpaceSession.createForSpace(this, account),
            this.addAccount(account),
        ]);

        return session;
    }

    public async addAccount(account: TestAccount | TestSession) {
        await createSpaceAccountForTest(this.context, {
            spaceId: this.id,
            accountId: account instanceof TestSession ? account.account.id : account.id,
        });
    }
}
