import {getAccountsTableForTest} from "~/server/dynamo/accounts_table";
import {requestAlphaAccess} from "~/server/dynamo/alpha_access_table";
import {DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
import {createTestProcessContext} from "~/server/dynamo/test/create_test_process_context";
import {validateEmailAddress} from "~/server/emails/email_address";
import {FailedPreconditionError} from "~/shared/error/error";
import {generateId} from "~/shared/id/id";

const getContext = createTestProcessContext();
const AccountsTable = getAccountsTableForTest();

async function createTestAccount() {
    const context = getContext();
    const accountId = generateId();
    const emailAddress = await validateEmailAddress(
        context,
        `test@${accountId}.test.cyberworlds.dev`,
    );

    await DynamoTableSchema.executeTransaction(context, [
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
    const context = getContext();
    const id = generateId();

    await requestAlphaAccess(context.request(), {
        name: "Test",
        emailAddress: await validateEmailAddress(context, `test.${id}@test.cyberworlds.dev`),
        message: "Hello, world!",
    });

    await expect(async () => {
        await requestAlphaAccess(context.request(), {
            name: "Test 2",
            emailAddress: await validateEmailAddress(context, `test.${id}@test.cyberworlds.dev`),
            message: "Hello, world!",
        });
    }).rejects.toThrowError(FailedPreconditionError);
});

test('can not request alpha twice with "+" extension email trick', async () => {
    const context = getContext();
    const id = generateId();

    await requestAlphaAccess(context.request(), {
        name: "Test",
        emailAddress: await validateEmailAddress(context, `test.${id}@test.cyberworlds.dev`),
        message: "Hello, world!",
    });

    await requestAlphaAccess(context.request(), {
        name: "Test 2",
        emailAddress: await validateEmailAddress(context, `test.${id}+2@test.cyberworlds.dev`),
        message: "Hello, world!",
    });
});

test("can not request alpha access for an account that already exists", async () => {
    const context = getContext();
    const account = await createTestAccount();

    await expect(async () => {
        await requestAlphaAccess(context.request(), {
            name: "Test",
            emailAddress: account.emailAddress,
            message: "Hello, world!",
        });
    }).rejects.toThrowError(FailedPreconditionError);
});
