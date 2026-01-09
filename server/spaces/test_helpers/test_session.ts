import {createSessionForTest} from "~/server/accounts/create_account_for_test.js";
import {getSessionIfExists} from "~/server/accounts/get_session_if_exists.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestContext} from "~/server/spaces/test_helpers/test_context.js";
import {SessionTokenPayload} from "~/server/tokens/token_payload.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateId} from "~/shared/id/id.js";
import {SessionId} from "~/shared/id/types/id_types.js";

export class TestSession {
    public readonly context: TestContext;
    public readonly account: TestAccount;
    public readonly id: SessionId;
    public readonly createdTime: Date;

    protected constructor(account: TestAccount, id: SessionId, createdTime: Date) {
        this.context = account.context;
        this.account = account;
        this.id = id;
        this.createdTime = createdTime;
    }

    public withContext(context: TestContext) {
        return new TestSession(this.account.withContext(context), this.id, this.createdTime);
    }

    public static async create(account: TestAccount) {
        const id = generateId<SessionId>();

        const {createdTime} = await createSessionForTest(account.context, {
            id,
            accountId: account.id,
        });

        return new TestSession(account, id, createdTime);
    }

    public static async get(context: TestContext, sessionId: SessionId) {
        const session = await getSessionIfExists(
            context.clone({cache: CacheContextModule.new()}),
            sessionId,
            null,
        );
        assert(session);

        const account = await TestAccount.get(context, session.accountId);

        return new TestSession(account, session.id, session.createdTime);
    }

    public getTokenPayload(): SessionTokenPayload {
        return {type: "Session", sessionId: this.id, accountId: this.account.id};
    }

    public action() {
        return this.context.action(this);
    }

    /**
     * Get the `AccountModel` for this session's account.
     */
    public get() {
        return this.account.get();
    }

    /**
     * Get the `ReactionCharacter` for this session's account.
     */
    public getReactionCharacter() {
        return this.account.getReactionCharacter();
    }
}
