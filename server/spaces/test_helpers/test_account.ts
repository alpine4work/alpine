import {
    createAccountForTest,
    dangerouslyGetAccountIfExistsWithoutCaching,
} from "~/server/accounts/accounts_table.js";
import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
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

    public static async create(
        context: TestContext,
        {
            name = TestAccount.getNewName(),
        }: {
            name?: string;
        } = {},
    ) {
        const id = generateId<AccountId>();

        await createAccountForTest(context, {
            id,
            name,
        });

        return new TestAccount(context, id, name);
    }

    public static getNewName() {
        return `Test Account ${testAccountCount++}`;
    }

    public async get(): Promise<AccountModel> {
        return assertExists(
            await dangerouslyGetAccountIfExistsWithoutCaching(this.context, this.id),
        );
    }
}
