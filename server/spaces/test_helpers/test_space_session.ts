import {createSessionForTest} from "~/server/accounts/accounts_actions.js";
import {
    authorizeSpaceAccess,
    dangerouslyGetAccountStubIfExistsWithoutAuthorization,
    getAccount,
} from "~/server/spaces/spaces_table.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {NotFoundError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateId} from "~/shared/id/id.js";
import {SessionId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export class TestSpaceSession extends TestSession {
    public readonly space: TestSpace;

    private constructor(space: TestSpace, account: TestAccount, id: SessionId, createdTime: Date) {
        assert(space.context === account.context);

        super(account, id, createdTime);

        this.space = space;
    }

    // Starts with an underscore since you should prefer calling
    // `space.createSession()` instead of `TestSpaceSession._create()`.
    public static async _create(space: TestSpace, account: TestAccount) {
        assert(space.context === account.context);

        const id = generateId<SessionId>();

        const {createdTime} = await createSessionForTest(space.context, {
            id,
            accountId: account.id,
        });

        return new TestSpaceSession(space, account, id, createdTime);
    }

    public async forSpace(space: TestSpace) {
        await authorizeSpaceAccess(this.action(), space.id);
        return new TestSpaceSession(space, this.account, this.id, this.createdTime);
    }

    /**
     * Get the `AccountModel` for this session's account.
     */
    public override get(): Promise<AccountModel> {
        return getAccount(this.space.systemAction(), this.space.id, this.account.id);
    }

    /**
     * Get the `AccountModel` stub for this session's account. We return stubs
     * to actors which only have URL access to some URL.
     */
    public async getStub(): Promise<AccountModel> {
        const account = await dangerouslyGetAccountStubIfExistsWithoutAuthorization(
            this.space.systemAction(),
            this.space.id,
            this.account.id,
        );
        if (!account) throw new NotFoundError("Account not found");
        return account;
    }
}
