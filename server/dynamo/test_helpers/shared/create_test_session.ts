import {SessionItem, getAccountsTableForTest} from "~/server/dynamo/accounts_table.js";
import {DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema.js";
import {getSpacesTableForTest} from "~/server/dynamo/spaces_table.js";
import {TestContext} from "~/server/dynamo/test_helpers/shared/create_test_context.js";
import {TestSpace} from "~/server/dynamo/test_helpers/shared/create_test_space.js";
import {testSharedHooks} from "~/server/dynamo/test_helpers/shared/test_shared_hooks.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SessionId} from "~/shared/id/types/id_types.js";

export type TestSession = {
    readonly sessionId: SessionId;
    readonly accountId: AccountId;
    readonly createdTime: Date;
    readonly account: AccountModel;
};

let accountNameCounter = 1;

/**
 * Creates a test account and session for the account for use in tests. The
 * account will be added as a member to the provided space.
 *
 * The IDs are generated synchronously but the session is actually created in a
 * `beforeAll()` hook.
 */
export function createTestSession(
    context: TestContext,
    space: TestSpace,
    {
        name = `Test Account ${accountNameCounter++}`,
        hasInternalAccess,
    }: {
        name?: string;
        hasInternalAccess?: boolean;
    } = {},
): TestSession {
    const AccountsTable = getAccountsTableForTest();
    const SpacesTable = getSpacesTableForTest();
    const sessionId = generateId<SessionId>();
    const accountId = generateId<AccountId>();

    const createdTime = new Date();

    const account = new AccountModel({
        id: accountId,
        name,
        createdTime,
        hasInternalAccess,
    });

    const sessionItem: SessionItem = {
        partitionType: "Session",
        sortRangeType: "Attributes",
        sessionId,
        accountId,
        createdTime,
        initialIpAddress: null,
        initialUserAgent: null,
    };

    testSharedHooks.beforeAll(async () => {
        await DynamoTableSchema.executeTransaction(context, [
            AccountsTable.transactionCreateItem({
                partitionType: "Account",
                sortRangeType: "Attributes",
                accountId,
                name: account.name,
                createdTime,
                hasInternalAccess,
            }),
            AccountsTable.transactionCreateItem(sessionItem),
            SpacesTable.transactionCreateItem({
                partitionType: "Space",
                sortRangeType: "Account",
                spaceId: space.id,
                accountId,
                joinedTime: createdTime,
            }),
        ]);
    });

    return {
        sessionId,
        accountId,
        createdTime: sessionItem.createdTime,
        account,
    };
}
