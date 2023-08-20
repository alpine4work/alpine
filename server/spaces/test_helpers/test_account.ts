import {getAccountsTableForTest} from "~/server/accounts/accounts_table.js";
import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {testClock} from "~/server/spaces/test_helpers/test_clock.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";

let testAccountCount = 1;

export class TestAccount {
    public readonly context: TestContext;
    public readonly id: AccountId;
    public readonly initialName: string;

    private constructor(context: TestContext, id: AccountId, initialName: string) {
        this.context = context;
        this.id = id;
        this.initialName = initialName;
    }

    public static _newAssumingExists(context: TestContext, id: AccountId, initialName: string) {
        return new TestAccount(context, id, initialName);
    }

    public static async create(
        context: TestContext,
        {
            name = TestAccount.getNewName(),
        }: {
            name?: string;
        } = {},
    ) {
        const AccountsTable = getAccountsTableForTest();

        const id = generateId<AccountId>();

        await AccountsTable.createItem(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: id,
            name,
            createdTime: testClock.nowDate(),
        });

        return new TestAccount(context, id, name);
    }

    public static getNewName() {
        return `Test Account ${testAccountCount++}`;
    }
}
