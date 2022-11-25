import {subHours} from "date-fns";
import {TestProcessContext} from "~/server/context/test_context";
import {
    attemptOneTimePasswordSignIn,
    captureOneTimePasswordSignInEmailsForTest,
    generateOneTimePassword,
    getAccountsTableForTest,
    regenerateOneTimePasswordSignIn,
} from "~/server/dynamo/accounts_table";
import {DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
import {FailedPreconditionError, PermissionDeniedError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {Id, generateId} from "~/shared/id/id";

jest.setTimeout(10 * 1000);

const context = new TestProcessContext();

const AccountsTable = getAccountsTableForTest();

async function createTestAccount({
    isEmailAddressVerified = false,
}: {isEmailAddressVerified?: boolean} = {}) {
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
            isVerified: isEmailAddressVerified,
        }),
    ]);

    return {
        id: accountId,
        emailAddress,
    };
}

async function getAccountEmailAddressItemForExpect(account: {id: Id; emailAddress: string}) {
    const accountEmailAddressItem = await AccountsTable.getItem({
        partitionType: "AccountEmailAddress",
        sortRangeType: "Attributes",
        emailAddress: account.emailAddress,
    });

    expect(accountEmailAddressItem).not.toEqual(null);
    assert(accountEmailAddressItem);

    expect(accountEmailAddressItem.accountId).toEqual(account.id);

    return {
        isVerified: accountEmailAddressItem.isVerified,
        oneTimePassword: accountEmailAddressItem.oneTimePasswordSignInState?.password ?? null,
    };
}

async function rewindOneTimePasswordSignInStateTime(emailAddress: string, hours: number) {
    const accountEmailAddressItem = await AccountsTable.getItem({
        partitionType: "AccountEmailAddress",
        sortRangeType: "Attributes",
        emailAddress,
    });
    assert(accountEmailAddressItem?.oneTimePasswordSignInState);

    await AccountsTable.putItem(
        {
            ...accountEmailAddressItem,
            lockVersion: accountEmailAddressItem.lockVersion + 1,
            oneTimePasswordSignInState: {
                ...accountEmailAddressItem.oneTimePasswordSignInState,
                generatedTime: subHours(
                    accountEmailAddressItem.oneTimePasswordSignInState.generatedTime,
                    hours,
                ),
                lastFailedAttemptTime: accountEmailAddressItem.oneTimePasswordSignInState
                    .lastFailedAttemptTime
                    ? subHours(
                          accountEmailAddressItem.oneTimePasswordSignInState.lastFailedAttemptTime,
                          hours,
                      )
                    : null,
            },
        },
        {
            condition: {
                lockVersion: accountEmailAddressItem.lockVersion,
            },
        },
    );
}

test("generates a one time password login hash", async () => {
    const account = await createTestAccount();

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: false,
        oneTimePassword: null,
    });

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(account.emailAddress);
    });

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: false,
        oneTimePassword: oneTimePasswordEmails[0]?.oneTimePassword,
    });
});

test("regenerates the one time password login hash even if there was one already", async () => {
    const account = await createTestAccount();

    const oneTimePasswordEmails1 = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(account.emailAddress);
    });

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: false,
        oneTimePassword: oneTimePasswordEmails1[0]?.oneTimePassword,
    });

    const oneTimePasswordEmails2 = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(account.emailAddress);
    });

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: false,
        oneTimePassword: oneTimePasswordEmails2[0]?.oneTimePassword,
    });
});

test("attempted login fails when account has no password", async () => {
    const account = await createTestAccount();

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXXX"),
    ).rejects.toThrow(new FailedPreconditionError("Missing one time password"));
});

test("attempted login with wrong password fails when account has password", async () => {
    const account = await createTestAccount();

    await regenerateOneTimePasswordSignIn(account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXXX"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));
});

test("attempted login with correct password succeeds", async () => {
    const account = await createTestAccount();

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(account.emailAddress);
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    await attemptOneTimePasswordSignIn(context.request(), account.emailAddress, oneTimePassword);
});

test("attempted correct password expires after a short window of time", async () => {
    const account = await createTestAccount();

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(account.emailAddress);
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    await rewindOneTimePasswordSignInStateTime(account.emailAddress, 2);

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, oneTimePassword),
    ).rejects.toThrow(new FailedPreconditionError("Missing one time password"));
});

test("attempted login with old correct password fails", async () => {
    const account = await createTestAccount();

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(account.emailAddress);
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    await regenerateOneTimePasswordSignIn(account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, oneTimePassword),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));
});

test("multiple incorrect password logins will lock the account", async () => {
    const account = await createTestAccount();

    await regenerateOneTimePasswordSignIn(account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX1"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX2"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX3"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX4"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX5"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX6"),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));
});

test("multiple incorrect password logins will lock the account and even a correct password won’t work", async () => {
    const account = await createTestAccount();

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(account.emailAddress);
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX1"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX2"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX3"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX4"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX5"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX6"),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, oneTimePassword),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));
});

test("correct password can not be used to login twice", async () => {
    const account = await createTestAccount();

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(account.emailAddress);
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    await attemptOneTimePasswordSignIn(context.request(), account.emailAddress, oneTimePassword);

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, oneTimePassword),
    ).rejects.toThrow(new FailedPreconditionError("Missing one time password"));
});

test("null last failed login attempt time continues to keep the account locked", async () => {
    const account = await createTestAccount();

    await regenerateOneTimePasswordSignIn(account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX1"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX2"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX3"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX4"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX5"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX6"),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));

    {
        const accountEmailAddressItem = await AccountsTable.getItem({
            partitionType: "AccountEmailAddress",
            sortRangeType: "Attributes",
            emailAddress: account.emailAddress,
        });
        assert(accountEmailAddressItem?.oneTimePasswordSignInState);

        await AccountsTable.putItem(
            {
                ...accountEmailAddressItem,
                lockVersion: accountEmailAddressItem.lockVersion + 1,
                oneTimePasswordSignInState: {
                    ...accountEmailAddressItem.oneTimePasswordSignInState,
                    lastFailedAttemptTime: null,
                },
            },
            {
                condition: {
                    lockVersion: accountEmailAddressItem.lockVersion,
                },
            },
        );
    }

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX7"),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));
});

test("last failed login attempt time more than 24 hours in the past will allow more attempts to unlock the account", async () => {
    const account = await createTestAccount();

    await regenerateOneTimePasswordSignIn(account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX1"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX2"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX3"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX4"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX5"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX6"),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));

    await rewindOneTimePasswordSignInStateTime(account.emailAddress, 25);

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX7"),
    ).rejects.toThrow(new PermissionDeniedError("Missing one time password"));

    await regenerateOneTimePasswordSignIn(account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX8"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX9"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));
});

test("last failed login attempt time more than 24 hours in the past will not allow unlocking the account with the old generated password", async () => {
    const account = await createTestAccount();

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(account.emailAddress);
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX1"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX2"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX3"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX4"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX5"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX6"),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, oneTimePassword),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));

    await rewindOneTimePasswordSignInStateTime(account.emailAddress, 25);

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, oneTimePassword),
    ).rejects.toThrow(new PermissionDeniedError("Missing one time password"));

    await regenerateOneTimePasswordSignIn(account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, oneTimePassword),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));
});

test("last failed login attempt time more than 24 hours in the past will allow unlocking the account with a new generated password", async () => {
    const account = await createTestAccount();

    await regenerateOneTimePasswordSignIn(account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX1"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX2"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX3"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX4"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX5"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX6"),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));

    await rewindOneTimePasswordSignInStateTime(account.emailAddress, 25);

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(account.emailAddress);
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    await attemptOneTimePasswordSignIn(context.request(), account.emailAddress, oneTimePassword);
});

test("last failed login attempt time less than 24 hours in the past will keep the account locked", async () => {
    const account = await createTestAccount();

    await regenerateOneTimePasswordSignIn(account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX1"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX2"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX3"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX4"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX5"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX6"),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));

    await rewindOneTimePasswordSignInStateTime(account.emailAddress, 23);

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX7"),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await expect(regenerateOneTimePasswordSignIn(account.emailAddress)).rejects.toThrow(
            new PermissionDeniedError("Account email address is locked"),
        );
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(0);
});

test("regenerating one time password does not unlock an account", async () => {
    const account = await createTestAccount();

    await regenerateOneTimePasswordSignIn(account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX1"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX2"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX3"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX4"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX5"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX6"),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await expect(regenerateOneTimePasswordSignIn(account.emailAddress)).rejects.toThrow(
            new PermissionDeniedError("Account email address is locked"),
        );
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(0);
});

test("regenerating one time password does not reset the login attempt counter", async () => {
    const account = await createTestAccount();

    await regenerateOneTimePasswordSignIn(account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX1"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX2"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX3"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await regenerateOneTimePasswordSignIn(account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX4"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX5"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX6"),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));
});

test("can not concurrently brute force login attempts", async () => {
    const account = await createTestAccount();

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(account.emailAddress);
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    const results = await Promise.allSettled([
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXX01"),
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXX02"),
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXX03"),
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXX04"),
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXX05"),
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXX06"),
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXX07"),
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXX08"),
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXX09"),
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXX10"),
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXX11"),
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXX12"),
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXX13"),
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXX14"),
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXX15"),
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXX16"),
    ]);

    expect(
        results
            .map(result => {
                assert(result.status === "rejected");
                return `${result.reason.name}: ${result.reason.message}`;
            })
            .sort(),
    ).toEqual([
        "PermissionDeniedError: Account email address is locked",
        "PermissionDeniedError: Account email address is locked",
        "PermissionDeniedError: Account email address is locked",
        "PermissionDeniedError: Account email address is locked",
        "PermissionDeniedError: Account email address is locked",
        "PermissionDeniedError: Account email address is locked",
        "PermissionDeniedError: Account email address is locked",
        "PermissionDeniedError: Account email address is locked",
        "PermissionDeniedError: Account email address is locked",
        "PermissionDeniedError: Account email address is locked",
        "PermissionDeniedError: Account email address is locked",
        "PermissionDeniedError: Incorrect one time password",
        "PermissionDeniedError: Incorrect one time password",
        "PermissionDeniedError: Incorrect one time password",
        "PermissionDeniedError: Incorrect one time password",
        "PermissionDeniedError: Incorrect one time password",
    ]);

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, oneTimePassword),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));
});

test("attempted login with incorrect password does not verify account email address", async () => {
    const account = await createTestAccount();

    await regenerateOneTimePasswordSignIn(account.emailAddress);

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: false,
        oneTimePassword: expect.any(String),
    });

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXXX"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: false,
        oneTimePassword: expect.any(String),
    });
});

test("login with correct password verifies account email address", async () => {
    const account = await createTestAccount();

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(account.emailAddress);
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: false,
        oneTimePassword: expect.any(String),
    });

    await attemptOneTimePasswordSignIn(context.request(), account.emailAddress, oneTimePassword);

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: true,
        oneTimePassword: null,
    });
});

test("multiple incorrect password logins will lock the account and not verify email address", async () => {
    const account = await createTestAccount();

    await regenerateOneTimePasswordSignIn(account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX1"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX2"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX3"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX4"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX5"),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context.request(), account.emailAddress, "XXXXX6"),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: false,
        oneTimePassword: expect.any(String),
    });
});

test("login with correct password does not verify account email address if email address already verified", async () => {
    const account = await createTestAccount({isEmailAddressVerified: true});

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(account.emailAddress);
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: true,
        oneTimePassword: expect.any(String),
    });

    await attemptOneTimePasswordSignIn(context.request(), account.emailAddress, oneTimePassword);

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: true,
        oneTimePassword: null,
    });
});

test("generates one time passwords that are six characters long", () => {
    for (let i = 0; i < 1_000; i++) {
        expect(generateOneTimePassword().length).toEqual(6);
    }
});
