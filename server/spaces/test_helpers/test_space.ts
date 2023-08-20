import {getAccountsTableForTest} from "~/server/accounts/accounts_table.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getSpacesTableForTest} from "~/server/spaces/spaces_table.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {testClock} from "~/server/spaces/test_helpers/test_clock.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";

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
 * - For update methods provide a chaining API that returns `this`. For example
 *   we want to call `task.updatePriority().addCollection()`.
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
        const SpacesTable = getSpacesTableForTest();

        const id = generateId<SpaceId>();

        await SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Attributes",
            spaceId: id,
            name,
            createdTime: testClock.nowDate(),
        });

        return new TestSpace(context, id);
    }

    public systemAction() {
        return this.context.systemAction(this.id);
    }

    public async createSession(account?: TestAccount) {
        const AccountsTable = getAccountsTableForTest();
        const SpacesTable = getSpacesTableForTest();

        const transactionEntries = [];

        const accountId = account?.id ?? generateId<AccountId>();
        const sessionId = generateId<SessionId>();

        const createdTime = testClock.nowDate();

        if (!account) {
            const accountName = TestAccount.getNewName();

            transactionEntries.push(
                AccountsTable.transactionCreateItem({
                    partitionType: "Account",
                    sortRangeType: "Attributes",
                    accountId,
                    name: accountName,
                    createdTime,
                }),
            );

            account = TestAccount._newAssumingExists(this.context, accountId, accountName);
        }

        transactionEntries.push(
            AccountsTable.transactionCreateItem({
                partitionType: "Session",
                sortRangeType: "Attributes",
                sessionId,
                accountId,
                createdTime,
                initialIpAddress: null,
                initialUserAgent: null,
            }),
        );

        transactionEntries.push(
            SpacesTable.transactionCreateItem({
                partitionType: "Space",
                sortRangeType: "Account",
                spaceId: this.id,
                accountId,
                joinedTime: createdTime,
            }),
        );

        await DynamoTableSchema.executeTransaction(this.context, transactionEntries);

        return TestSpaceSession._newAssumingExists(this, account, sessionId, createdTime);
    }
}
