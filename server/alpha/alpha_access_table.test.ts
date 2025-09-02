import {createAccountWithEmailAddressTransactionEntries} from "~/server/accounts/accounts_actions.js";
import {createAlphaSpaceAsAdmin, requestAlphaAccess} from "~/server/alpha/alpha_access_table.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {validateEmailAddress} from "~/server/emails/email_address.js";
import {createChannel, getChannel} from "~/server/forum/data/forum_actions.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {
    FailedPreconditionError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";

const context = createTestContext();

async function createTestAccount() {
    const accountId = generateId<AccountId>();
    const emailAddress = await validateEmailAddress(
        context,
        `test@${accountId}.test.cyberworlds.dev`,
    );

    await DynamoTableSchema.executeTransaction(
        context,
        createAccountWithEmailAddressTransactionEntries({
            id: accountId,
            name: "Test",
            emailAddress,
            currentTime: new Date(),
        }),
    );

    return {
        id: accountId,
        emailAddress,
    };
}

test("can not request alpha access twice", async () => {
    const id = generateId();

    await requestAlphaAccess(context.anonymousAction(), {
        name: "Test",
        emailAddress: await validateEmailAddress(context, `test.${id}@test.cyberworlds.dev`),
        message: "Hello, world!",
    });

    await expect(async () => {
        await requestAlphaAccess(context.anonymousAction(), {
            name: "Test 2",
            emailAddress: await validateEmailAddress(context, `test.${id}@test.cyberworlds.dev`),
            message: "Hello, world!",
        });
    }).rejects.toThrow(FailedPreconditionError);
});

test("can request alpha twice with `+` extension email trick", async () => {
    const id = generateId();

    await requestAlphaAccess(context.anonymousAction(), {
        name: "Test",
        emailAddress: await validateEmailAddress(context, `test.${id}@test.cyberworlds.dev`),
        message: "Hello, world!",
    });

    await requestAlphaAccess(context.anonymousAction(), {
        name: "Test 2",
        emailAddress: await validateEmailAddress(context, `test.${id}+2@test.cyberworlds.dev`),
        message: "Hello, world!",
    });
});

test("can not request alpha access for an account that already exists", async () => {
    const account = await createTestAccount();

    await expect(async () => {
        await requestAlphaAccess(context.anonymousAction(), {
            name: "Test",
            emailAddress: account.emailAddress,
            message: "Hello, world!",
        });
    }).rejects.toThrow(FailedPreconditionError);
});

test("can create alpha spaces as admin", async () => {
    const adminAccount = await TestAccount.create(context, {hasInternalAccess: true});
    const otherAccount = await TestAccount.create(context);

    const adminSession = await TestSession.create(adminAccount);
    const otherSession = await TestSession.create(otherAccount);

    await expect(
        createAlphaSpaceAsAdmin(otherSession.action(), {
            name: "Hello",
            ownerAccountId: otherSession.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        createAlphaSpaceAsAdmin(otherSession.action(), {
            name: "Hello",
            ownerAccountId: adminSession.account.id,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    const result1 = await createAlphaSpaceAsAdmin(adminSession.action(), {
        name: "Hello 1",
        ownerAccountId: otherSession.account.id,
    });

    const result2 = await createAlphaSpaceAsAdmin(adminSession.action(), {
        name: "Hello 2",
        ownerAccountId: adminSession.account.id,
    });

    await expect(
        createAlphaSpaceAsAdmin(adminSession.action(), {
            name: "Hello 3",
            ownerAccountId: generateId(),
        }),
    ).rejects.toThrow(NotFoundError);

    await expect(
        createChannel(adminSession.action(), {
            spaceId: result1.spaceId,
            name: "Channel 1",
        }),
    ).rejects.toThrow(PermissionDeniedError);

    const channel1 = await createChannel(adminSession.action(), {
        spaceId: result2.spaceId,
        name: "Channel 2",
    });

    const channel2 = await createChannel(otherSession.action(), {
        spaceId: result1.spaceId,
        name: "Channel 3",
    });

    await expect(
        createChannel(otherSession.action(), {
            spaceId: result2.spaceId,
            name: "Channel 4",
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await getChannel(adminSession.action(), channel1.id);
    await expect(getChannel(otherSession.action(), channel1.id)).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(getChannel(adminSession.action(), channel2.id)).rejects.toThrow(
        PermissionDeniedError,
    );
    await getChannel(otherSession.action(), channel2.id);
});
