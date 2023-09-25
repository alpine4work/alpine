import {createSessionForTest} from "~/server/accounts/accounts_table.js";
import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getAccount} from "~/server/spaces/spaces_table.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateId} from "~/shared/id/id.js";
import {SessionId} from "~/shared/id/types/id_types.js";

export class TestSpaceSession {
    public readonly context: TestContext;
    public readonly space: TestSpace;
    public readonly account: TestAccount;
    public readonly id: SessionId;
    public readonly createdTime: Date;

    private constructor(space: TestSpace, account: TestAccount, id: SessionId, createdTime: Date) {
        assert(space.context === account.context);

        this.context = space.context;
        this.space = space;
        this.account = account;
        this.id = id;
        this.createdTime = createdTime;
    }

    public static async create(space: TestSpace, account: TestAccount) {
        assert(space.context === account.context);

        const id = generateId<SessionId>();

        const {createdTime} = await createSessionForTest(space.context, {
            id,
            accountId: account.id,
        });

        return new TestSpaceSession(space, account, id, createdTime);
    }

    public action() {
        return this.context.action(this);
    }

    /**
     * Get the `AccountModel` for this session's account.
     */
    public get() {
        return getAccount(this.action(), this.space.id, this.account.id);
    }
}
