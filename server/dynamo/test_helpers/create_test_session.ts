import {SessionItem, getAccountsTableForTest} from "~/server/accounts/accounts_table.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpaceItem} from "~/server/dynamo/test_helpers/create_test_space.js";
import {testSharedHooks} from "~/server/dynamo/test_helpers/test_shared_hooks.js";
import {getSpacesTableForTest} from "~/server/spaces/spaces_table.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SessionId} from "~/shared/id/types/id_types.js";

export type TestSessionItem = {
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
// NOTE(calebmer, 2023-08-20): We recommend using `TestSessionAccount` instead
// of this function. Not deprecating yet since the new test API hasn't
// stabilized yet.
export function createTestSession(
    context: TestContext,
    space: TestSpaceItem,
    {
        name = `Test Account ${accountNameCounter++}`,
        hasInternalAccess,
    }: {
        name?: string;
        hasInternalAccess?: boolean;
    } = {},
): TestSessionItem {
    const AccountsTable = getAccountsTableForTest();
    const SpacesTable = getSpacesTableForTest();
    const sessionId = generateId<SessionId>();
    const accountId = generateId<AccountId>();

    const createdTime = new Date();

    const account = new AccountModel({
        id: accountId,
        name,
        nameVersion: 0,
        createdTime,
        hasInternalAccess,
        version: 0,
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
                name: account.initialData.name,
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
