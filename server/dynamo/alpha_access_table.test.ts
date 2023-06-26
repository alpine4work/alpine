import {getAccountsTableForTest} from "~/server/dynamo/accounts_table.js";
import {requestAlphaAccess} from "~/server/dynamo/alpha_access_table.js";
import {DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema.js";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context.js";
import {validateEmailAddress} from "~/server/emails/email_address.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";

const context = createTestContext();
const AccountsTable = getAccountsTableForTest();

async function createTestAccount() {
    const accountId = generateId<AccountId>();
    const emailAddress = await validateEmailAddress(
        context,
        `test@${accountId}.test.cyberworlds.dev`,
    );

    await DynamoTableSchema.executeTransaction(context, [
        AccountsTable.transactionCreateItem({
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId,
            name: "Test",
            createdTime: new Date(),
        }),
        AccountsTable.transactionCreateItem({
            partitionType: "AccountEmailAddress",
            sortRangeType: "Attributes",
            emailAddress,
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

    await requestAlphaAccess(context.unauthenticatedAction(), {
        name: "Test",
        emailAddress: await validateEmailAddress(context, `test.${id}@test.cyberworlds.dev`),
        message: "Hello, world!",
    });

    await expect(async () => {
        await requestAlphaAccess(context.unauthenticatedAction(), {
            name: "Test 2",
            emailAddress: await validateEmailAddress(context, `test.${id}@test.cyberworlds.dev`),
            message: "Hello, world!",
        });
    }).rejects.toThrowError(FailedPreconditionError);
});

test('can request alpha twice with "+" extension email trick', async () => {
    const id = generateId();

    await requestAlphaAccess(context.unauthenticatedAction(), {
        name: "Test",
        emailAddress: await validateEmailAddress(context, `test.${id}@test.cyberworlds.dev`),
        message: "Hello, world!",
    });

    await requestAlphaAccess(context.unauthenticatedAction(), {
        name: "Test 2",
        emailAddress: await validateEmailAddress(context, `test.${id}+2@test.cyberworlds.dev`),
        message: "Hello, world!",
    });
});

test("can not request alpha access for an account that already exists", async () => {
    const account = await createTestAccount();

    await expect(async () => {
        await requestAlphaAccess(context.unauthenticatedAction(), {
            name: "Test",
            emailAddress: account.emailAddress,
            message: "Hello, world!",
        });
    }).rejects.toThrowError(FailedPreconditionError);
});
