import {SessionItem, getAccountsTableForTest} from "~/server/dynamo/accounts_table";
import {getSpacesTableForTest} from "~/server/dynamo/spaces_table";
import {TestContext} from "~/server/dynamo/test/create_test_context";
import {TestSpace} from "~/server/dynamo/test/create_test_space";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {Id, generateId} from "~/shared/id/id";

export type TestSession = {
    readonly id: Id;
    readonly accountId: Id;
    readonly item: SessionItem;
};

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
    const sessionId = generateId();
    const accountId = generateId();

    const createdTime = new Date();

    const sessionItem: SessionItem = {
        partitionType: "Session",
        sortRangeType: "Attributes",
        sessionId,
        accountId,
        createdTime,
        initialIpAddress: null,
        initialUserAgent: null,
    };

    beforeAll(async () => {
        await runAllPromises([
            AccountsTable.putItem(context, {
                partitionType: "Account",
                sortRangeType: "Attributes",
                accountId,
                name: "Test",
                createdTime,
            }),
            AccountsTable.putItem(context, sessionItem),
            SpacesTable.putItem(context, {
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
        item: sessionItem,
    };
}
