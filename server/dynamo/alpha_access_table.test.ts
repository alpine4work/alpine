import {getAccountsTableForTest} from "~/server/dynamo/accounts_table";
import {requestAlphaAccess} from "~/server/dynamo/alpha_access_table";
import {DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
import {FailedPreconditionError} from "~/shared/error/error";
import {generateId} from "~/shared/id/id";

const AccountsTable = getAccountsTableForTest();

async function createTestAccount() {
    const accountId = generateId();
    const emailAddress = `test@${accountId}.test.cyberworlds.dev`;

    await DynamoTableSchema.executeTransaction([
        AccountsTable.transactionPutItem({
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId,
            name: "Test",
            createdTime: new Date(),
        }),
        AccountsTable.transactionPutItem({
            partitionType: "AccountEmailAddress",
            sortRangeType: "Attributes",
            emailAddress,
            lockVersion: 0,
            accountId,
            isVerified: false,
        }),
    ]);

    return {
        id: accountId,
        emailAddress,
    };
}

test("can not request alpha access twice", async () => {
    const id = generateId();

    await requestAlphaAccess({
        name: "Test",
        emailAddress: `test.${id}@test.cyberworlds.dev`,
        message: "Hello, world!",
    });

    await expect(async () => {
        await requestAlphaAccess({
            name: "Test 2",
            emailAddress: `test.${id}@test.cyberworlds.dev`,
            message: "Hello, world!",
        });
    }).rejects.toThrowError(FailedPreconditionError);
});

test('can not request alpha twice with "+" extension email trick', async () => {
    const id = generateId();

    await requestAlphaAccess({
        name: "Test",
        emailAddress: `test.${id}@test.cyberworlds.dev`,
        message: "Hello, world!",
    });

    await requestAlphaAccess({
        name: "Test 2",
        emailAddress: `test.${id}+2@test.cyberworlds.dev`,
        message: "Hello, world!",
    });
});

test("can not request alpha access for an account that already exists", async () => {
    const account = await createTestAccount();

    await expect(async () => {
        await requestAlphaAccess({
            name: "Test",
            emailAddress: account.emailAddress,
            message: "Hello, world!",
        });
    }).rejects.toThrowError(FailedPreconditionError);
});
