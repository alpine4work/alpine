import {createSessionForTest} from "~/server/accounts/create_account_for_test.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {dangerouslyGetAccountStubIfExistsWithoutAuthorization} from "~/server/spaces/dangerously_get_account_stub_if_exists_without_authorization.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestContext} from "~/server/spaces/test_helpers/test_context.js";
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

    public override withContext(context: TestContext) {
        return new TestSpaceSession(
            this.space.withContext(context),
            this.account.withContext(context),
            this.id,
            this.createdTime,
        );
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

    public static async forSpace(session: TestSession, space: TestSpace) {
        await authorizeSpaceAccess(session.action(), space.id);
        return new TestSpaceSession(space, session.account, session.id, session.createdTime);
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

    public inviteEmailAddress(emailAddress: string) {
        return this.space.inviteEmailAddress(this, emailAddress);
    }

    public inviteEmailAddressAndCreateSession(emailAddress: string) {
        return this.space.inviteEmailAddressAndCreateSession(this, emailAddress);
    }
}
