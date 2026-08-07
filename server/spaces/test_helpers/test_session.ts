import {createSessionForTest} from "~/server/accounts/create_account_for_test.js";
import {getSessionIfExists} from "~/server/accounts/get_session_if_exists.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestContext} from "~/server/spaces/test_helpers/test_context.js";
import {SessionTokenPayload} from "~/server/tokens/token_payload.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {SessionId} from "~/shared/id/types/id_types.open_source.js";

export class TestSession {
    public readonly context: TestContext;
    public readonly account: TestAccount;
    public readonly id: SessionId;

    protected constructor(account: TestAccount, id: SessionId) {
        this.context = account.context;
        this.account = account;
        this.id = id;
    }

    public withContext(context: TestContext) {
        return new TestSession(this.account.withContext(context), this.id);
    }

    public static async create(account: TestAccount) {
        const id = generateId<SessionId>();

        await createSessionForTest(account.context, {
            id,
            accountId: account.id,
        });

        return new TestSession(account, id);
    }

    public static async get(context: TestContext, sessionId: SessionId) {
        const sessionAccountId = await getSessionIfExists(context, sessionId);
        assert(sessionAccountId);

        const account = await TestAccount.get(context, sessionAccountId);

        return new TestSession(account, sessionId);
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
