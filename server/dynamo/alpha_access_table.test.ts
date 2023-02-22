import {getAccountsTableForTest} from "~/server/dynamo/accounts_table";
import {requestAlphaAccess} from "~/server/dynamo/alpha_access_table";
import {DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context";
import {validateEmailAddress} from "~/server/emails/email_address";
import {FailedPreconditionError} from "~/shared/error/error";
import {generateId} from "~/shared/id/id";
import {AccountId} from "~/shared/id/types/id_types";

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

    await requestAlphaAccess(context.unauthenticatedRequest(), {
        name: "Test",
        emailAddress: await validateEmailAddress(context, `test.${id}@test.cyberworlds.dev`),
        message: "Hello, world!",
    });

    await expect(async () => {
        await requestAlphaAccess(context.unauthenticatedRequest(), {
            name: "Test 2",
            emailAddress: await validateEmailAddress(context, `test.${id}@test.cyberworlds.dev`),
            message: "Hello, world!",
        });
    }).rejects.toThrowError(FailedPreconditionError);
});

test('can request alpha twice with "+" extension email trick', async () => {
    const id = generateId();

    await requestAlphaAccess(context.unauthenticatedRequest(), {
        name: "Test",
        emailAddress: await validateEmailAddress(context, `test.${id}@test.cyberworlds.dev`),
        message: "Hello, world!",
    });

    await requestAlphaAccess(context.unauthenticatedRequest(), {
        name: "Test 2",
        emailAddress: await validateEmailAddress(context, `test.${id}+2@test.cyberworlds.dev`),
        message: "Hello, world!",
    });
});

test("can not request alpha access for an account that already exists", async () => {
    const account = await createTestAccount();

    await expect(async () => {
        await requestAlphaAccess(context.unauthenticatedRequest(), {
            name: "Test",
            emailAddress: account.emailAddress,
            message: "Hello, world!",
        });
    }).rejects.toThrowError(FailedPreconditionError);
});
