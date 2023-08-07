import {SessionItem, getAccountsTableForTest} from "~/server/dynamo/accounts_table.js";
import {getSpacesTableForTest} from "~/server/dynamo/spaces_table.js";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

const context = createTestContext({shouldStartOpensearch: true});

// We create a new scenario for every test so we can query all tasks within
// a space.
async function createScenario() {
    const SpacesTable = getSpacesTableForTest();
    const AccountsTable = getAccountsTableForTest();

    const createdTime = new Date();

    const spaceId = generateId<SpaceId>();

    const account1Id = generateId<AccountId>();
    const account2Id = generateId<AccountId>();
    const account3Id = generateId<AccountId>();

    const account1SessionItem: SessionItem = {
        partitionType: "Session",
        sortRangeType: "Attributes",
        sessionId: generateId(),
        accountId: account1Id,
        createdTime,
        initialIpAddress: null,
        initialUserAgent: null,
    };
    const account2SessionItem: SessionItem = {
        partitionType: "Session",
        sortRangeType: "Attributes",
        sessionId: generateId(),
        accountId: account2Id,
        createdTime,
        initialIpAddress: null,
        initialUserAgent: null,
    };
    const account3SessionItem: SessionItem = {
        partitionType: "Session",
        sortRangeType: "Attributes",
        sessionId: generateId(),
        accountId: account3Id,
        createdTime,
        initialIpAddress: null,
        initialUserAgent: null,
    };

    await runAllPromises([
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Attributes",
            spaceId: spaceId,
            name: "Space",
            createdTime,
        }),
        AccountsTable.createItem(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: account1Id,
            name: "Account 1",
            createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId: spaceId,
            accountId: account1Id,
            joinedTime: createdTime,
        }),
        AccountsTable.createItem(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: account2Id,
            name: "Account 2",
            createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId: spaceId,
            accountId: account2Id,
            joinedTime: createdTime,
        }),
        AccountsTable.createItem(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: account3Id,
            name: "Account 3",
            createdTime,
        }),
        SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId: spaceId,
            accountId: account3Id,
            joinedTime: createdTime,
        }),
        AccountsTable.createItem(context, account1SessionItem),
        AccountsTable.createItem(context, account2SessionItem),
        AccountsTable.createItem(context, account3SessionItem),
    ]);

    return {
        space: {id: spaceId},
        session1: {accountId: account1Id, item: account1SessionItem},
        session2: {accountId: account2Id, item: account2SessionItem},
        session3: {accountId: account3Id, item: account3SessionItem},
    };
}

test("test", async () => {
    const {} = await createScenario();
});
