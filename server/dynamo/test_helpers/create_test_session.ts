import {createAccountForTest, createSessionForTest} from "~/server/accounts/accounts_actions.js";
import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpaceItem} from "~/server/dynamo/test_helpers/create_test_space.js";
import {testSharedHooks} from "~/server/dynamo/test_helpers/test_shared_hooks.js";
import {
    acceptSpaceAccountInvite,
    addSpaceAccountForTest,
    getSpaceAccountForTest,
} from "~/server/spaces/spaces_actions.js";
import {AccountModelWithoutSpace} from "~/shared/accounts/account_model_without_space.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SessionId} from "~/shared/id/types/id_types.js";
import {SpaceRole} from "~/shared/spaces/space_model.js";
import {createTestAccountModelWithoutSpace} from "~/shared/spaces/test_helpers/account_model_test_helpers.js";

export type TestSessionItem = {
    readonly sessionId: SessionId;
    readonly accountId: AccountId;
    readonly createdTime: Date;
    readonly account: AccountModelWithoutSpace;
};

let accountNameCounter = 1;

/**
 * Creates a test account and session for the account for use in tests. The
 * account will be added as a member to the provided space.
 *
 * The IDs are generated synchronously but the session is actually created in a
 * `beforeAll()` hook.
 *
 * @deprecated Use `TestSessionAccount` in the body of a test instead
 */
export function createTestSession(
    context: TestContext,
    space: TestSpaceItem,
    {
        name = `Test Account ${accountNameCounter++}`,
        hasInternalAccess = false,
        role = "Member",
    }: {
        name?: string;
        hasInternalAccess?: boolean;
        role?: SpaceRole;
    } = {},
): TestSessionItem {
    const sessionId = generateId<SessionId>();
    const accountId = generateId<AccountId>();

    const createdTime = new Date();

    const account = createTestAccountModelWithoutSpace({
        id: accountId,
        name: name,
    });

    let sessionCreatedTime: Date | null = null;

    testSharedHooks.beforeAll(async () => {
        await createAccountForTest(context, {
            id: accountId,
            name: account.initialData.name,
            hasInternalAccess,
            createdTime,
        });

        const [{createdTime: _sessionCreatedTime}] = await runAllPromises([
            createSessionForTest(context, {
                id: sessionId,
                accountId,
            }),
            addSpaceAccountForTest(context, {
                spaceId: space.id,
                accountId,
                role,
            }),
        ]);

        const spaceAccount = await getSpaceAccountForTest(
            context.systemAction(space.id),
            space.id,
            accountId,
        );

        if (spaceAccount?.state.type === "InvitePending") {
            await acceptSpaceAccountInvite(context.action({id: sessionId, account}), space.id);
        }

        sessionCreatedTime = _sessionCreatedTime;
    });

    return {
        sessionId,
        accountId,
        get createdTime() {
            if (sessionCreatedTime === null) {
                throw new InternalError(
                    "Can’t access session `createdTime` until after test hook runs",
                );
            }
            return sessionCreatedTime;
        },
        account,
    };
}
