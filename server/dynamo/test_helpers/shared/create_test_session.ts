import {SessionItem, getAccountsTableForTest} from "~/server/dynamo/accounts_table";
import {DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
import {getSpacesTableForTest} from "~/server/dynamo/spaces_table";
import {TestContext} from "~/server/dynamo/test_helpers/shared/create_test_context";
import {TestSpace} from "~/server/dynamo/test_helpers/shared/create_test_space";
import {testHooks} from "~/server/dynamo/test_helpers/shared/test_hooks";
import {generateId} from "~/shared/id/id";
import {AccountId, SessionId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";

export type TestSession = {
    readonly id: SessionId;
    readonly accountId: AccountId;
    readonly account: AccountModel;
    readonly item: SessionItem;
};

let accountNameCounter = 1;

/**
 * Creates a test account and session for the account for use in tests. The
 * account will be added as a member to the provided space.
 *
 * The IDs are generated synchronously but the session is actually created in a
 * `beforeAll()` hook.
 */
export function createTestSession(context: TestContext, space: TestSpace): TestSession {
    const AccountsTable = getAccountsTableForTest();
    const SpacesTable = getSpacesTableForTest();
    const sessionId = generateId<SessionId>();
    const accountId = generateId<AccountId>();

    const createdTime = new Date();

    const account = new AccountModel({
        id: accountId,
        name: `Test ${accountNameCounter++}`,
        createdTime,
        // The `getAccount()` function includes the `hasInternalAccess` property but
        // sets it to undefined.
        hasInternalAccess: undefined,
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

    testHooks.beforeAll(async () => {
        await DynamoTableSchema.executeTransaction(context, [
            AccountsTable.transactionCreateItem({
                partitionType: "Account",
                sortRangeType: "Attributes",
                accountId,
                name: account.name,
                createdTime,
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
        id: sessionId,
        accountId,
        account,
        item: sessionItem,
    };
}
