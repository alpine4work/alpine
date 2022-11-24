import {subHours} from "date-fns";
import {
    attemptOneTimePasswordSignIn,
    captureOneTimePasswordSignInEmailsForTest,
    getAccountsTableForTest,
    regenerateOneTimePasswordSignIn,
} from "~/server/dynamo/accounts_table";
import {DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {assert} from "~/shared/helpers/control/assert";
import {Id, generateId} from "~/shared/id/id";

jest.setTimeout(10 * 1000);

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
        expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
            type: "RegeneratedOneTimePassword",
        });
    });

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: false,
        oneTimePassword: oneTimePasswordEmails[0]?.oneTimePassword,
    });
});

test("regenerates the one time password login hash even if there was one already", async () => {
    const account = await createTestAccount();

    const oneTimePasswordEmails1 = await captureOneTimePasswordSignInEmailsForTest(async () => {
        expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
            type: "RegeneratedOneTimePassword",
        });
    });

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: false,
        oneTimePassword: oneTimePasswordEmails1[0]?.oneTimePassword,
    });

    const oneTimePasswordEmails2 = await captureOneTimePasswordSignInEmailsForTest(async () => {
        expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
            type: "RegeneratedOneTimePassword",
        });
    });

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: false,
        oneTimePassword: oneTimePasswordEmails2[0]?.oneTimePassword,
    });
});

test("attempted login fails when account has no password", async () => {
    const account = await createTestAccount();

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXXX")).toEqual({
        type: "MissingOneTimePassword",
    });
});

test("attempted login with wrong password fails when account has password", async () => {
    const account = await createTestAccount();

    expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
        type: "RegeneratedOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXXX")).toEqual({
        type: "IncorrectOneTimePassword",
    });
});

test("attempted login with correct password succeeds", async () => {
    const account = await createTestAccount();

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
            type: "RegeneratedOneTimePassword",
        });
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, oneTimePassword)).toEqual({
        type: "CorrectOneTimePassword",
    });
});

test("attempted correct password expires after a short window of time", async () => {
    const account = await createTestAccount();

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
            type: "RegeneratedOneTimePassword",
        });
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    await rewindOneTimePasswordSignInStateTime(account.emailAddress, 2);

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, oneTimePassword)).toEqual({
        type: "MissingOneTimePassword",
    });
});

test("attempted login with old correct password fails", async () => {
    const account = await createTestAccount();

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
            type: "RegeneratedOneTimePassword",
        });
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
        type: "RegeneratedOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, oneTimePassword)).toEqual({
        type: "IncorrectOneTimePassword",
    });
});

test("multiple incorrect password logins will lock the account", async () => {
    const account = await createTestAccount();

    expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
        type: "RegeneratedOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX1")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX2")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX3")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX4")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX5")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX6")).toEqual({
        type: "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
        hoursUntilRegenerateOneTimePasswordUnlocked: 24,
    });
});

test("multiple incorrect password logins will lock the account and even a correct password won’t work", async () => {
    const account = await createTestAccount();

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
            type: "RegeneratedOneTimePassword",
        });
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX1")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX2")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX3")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX4")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX5")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX6")).toEqual({
        type: "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
        hoursUntilRegenerateOneTimePasswordUnlocked: 24,
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, oneTimePassword)).toEqual({
        type: "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
        hoursUntilRegenerateOneTimePasswordUnlocked: 24,
    });
});

test("correct password can not be used to login twice", async () => {
    const account = await createTestAccount();

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
            type: "RegeneratedOneTimePassword",
        });
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, oneTimePassword)).toEqual({
        type: "CorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, oneTimePassword)).toEqual({
        type: "MissingOneTimePassword",
    });
});

test("null last failed login attempt time continues to keep the account locked", async () => {
    const account = await createTestAccount();

    expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
        type: "RegeneratedOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX1")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX2")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX3")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX4")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX5")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX6")).toEqual({
        type: "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
        hoursUntilRegenerateOneTimePasswordUnlocked: 24,
    });

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

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX7")).toEqual({
        type: "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
        hoursUntilRegenerateOneTimePasswordUnlocked: 24,
    });
});

test("last failed login attempt time more than 24 hours in the past will allow more attempts to unlock the account", async () => {
    const account = await createTestAccount();

    expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
        type: "RegeneratedOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX1")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX2")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX3")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX4")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX5")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX6")).toEqual({
        type: "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
        hoursUntilRegenerateOneTimePasswordUnlocked: 24,
    });

    await rewindOneTimePasswordSignInStateTime(account.emailAddress, 25);

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX7")).toEqual({
        type: "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
        hoursUntilRegenerateOneTimePasswordUnlocked: 0,
    });

    expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
        type: "RegeneratedOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX8")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX9")).toEqual({
        type: "IncorrectOneTimePassword",
    });
});

test("last failed login attempt time more than 24 hours in the past will not allow unlocking the account with the old generated password", async () => {
    const account = await createTestAccount();

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
            type: "RegeneratedOneTimePassword",
        });
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX1")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX2")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX3")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX4")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX5")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX6")).toEqual({
        type: "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
        hoursUntilRegenerateOneTimePasswordUnlocked: 24,
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, oneTimePassword)).toEqual({
        type: "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
        hoursUntilRegenerateOneTimePasswordUnlocked: 24,
    });

    await rewindOneTimePasswordSignInStateTime(account.emailAddress, 25);

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, oneTimePassword)).toEqual({
        type: "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
        hoursUntilRegenerateOneTimePasswordUnlocked: 0,
    });

    expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
        type: "RegeneratedOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, oneTimePassword)).toEqual({
        type: "IncorrectOneTimePassword",
    });
});

test("last failed login attempt time more than 24 hours in the past will allow unlocking the account with a new generated password", async () => {
    const account = await createTestAccount();

    expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
        type: "RegeneratedOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX1")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX2")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX3")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX4")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX5")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX6")).toEqual({
        type: "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
        hoursUntilRegenerateOneTimePasswordUnlocked: 24,
    });

    await rewindOneTimePasswordSignInStateTime(account.emailAddress, 25);

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
            type: "RegeneratedOneTimePassword",
        });
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, oneTimePassword)).toEqual({
        type: "CorrectOneTimePassword",
    });
});

test("last failed login attempt time less than 24 hours in the past will keep the account locked", async () => {
    const account = await createTestAccount();

    expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
        type: "RegeneratedOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX1")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX2")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX3")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX4")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX5")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX6")).toEqual({
        type: "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
        hoursUntilRegenerateOneTimePasswordUnlocked: 24,
    });

    await rewindOneTimePasswordSignInStateTime(account.emailAddress, 23);

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX7")).toEqual({
        type: "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
        hoursUntilRegenerateOneTimePasswordUnlocked: 1,
    });

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
            type: "AccountEmailAddressLocked",
            hoursUntilUnlocked: 1,
        });
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(0);
});

test("regenerating one time password does not unlock an account", async () => {
    const account = await createTestAccount();

    expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
        type: "RegeneratedOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX1")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX2")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX3")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX4")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX5")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX6")).toEqual({
        type: "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
        hoursUntilRegenerateOneTimePasswordUnlocked: 24,
    });

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
            type: "AccountEmailAddressLocked",
            hoursUntilUnlocked: 24,
        });
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(0);
});

test("regenerating one time password does not reset the login attempt counter", async () => {
    const account = await createTestAccount();

    expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
        type: "RegeneratedOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX1")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX2")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX3")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
        type: "RegeneratedOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX4")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX5")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX6")).toEqual({
        type: "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
        hoursUntilRegenerateOneTimePasswordUnlocked: 24,
    });
});

test("can not concurrently brute force login attempts", async () => {
    const account = await createTestAccount();

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
            type: "RegeneratedOneTimePassword",
        });
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    const results = await runAllPromises([
        attemptOneTimePasswordSignIn(account.emailAddress, "XXXX01"),
        attemptOneTimePasswordSignIn(account.emailAddress, "XXXX02"),
        attemptOneTimePasswordSignIn(account.emailAddress, "XXXX03"),
        attemptOneTimePasswordSignIn(account.emailAddress, "XXXX04"),
        attemptOneTimePasswordSignIn(account.emailAddress, "XXXX05"),
        attemptOneTimePasswordSignIn(account.emailAddress, "XXXX06"),
        attemptOneTimePasswordSignIn(account.emailAddress, "XXXX07"),
        attemptOneTimePasswordSignIn(account.emailAddress, "XXXX08"),
        attemptOneTimePasswordSignIn(account.emailAddress, "XXXX09"),
        attemptOneTimePasswordSignIn(account.emailAddress, "XXXX10"),
        attemptOneTimePasswordSignIn(account.emailAddress, "XXXX11"),
        attemptOneTimePasswordSignIn(account.emailAddress, "XXXX12"),
        attemptOneTimePasswordSignIn(account.emailAddress, "XXXX13"),
        attemptOneTimePasswordSignIn(account.emailAddress, "XXXX14"),
        attemptOneTimePasswordSignIn(account.emailAddress, "XXXX15"),
        attemptOneTimePasswordSignIn(account.emailAddress, "XXXX16"),
    ]);

    expect(results.map(result => result.type).sort()).toEqual([
        "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
        "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
        "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
        "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
        "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
        "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
        "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
        "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
        "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
        "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
        "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
        "IncorrectOneTimePassword",
        "IncorrectOneTimePassword",
        "IncorrectOneTimePassword",
        "IncorrectOneTimePassword",
        "IncorrectOneTimePassword",
    ]);

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, oneTimePassword)).toEqual({
        type: "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
        hoursUntilRegenerateOneTimePasswordUnlocked: 24,
    });
});

test("attempted login with incorrect password does not verify account email address", async () => {
    const account = await createTestAccount();

    expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
        type: "RegeneratedOneTimePassword",
    });

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: false,
        oneTimePassword: expect.any(String),
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXXX")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: false,
        oneTimePassword: expect.any(String),
    });
});

test("login with correct password verifies account email address", async () => {
    const account = await createTestAccount();

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
            type: "RegeneratedOneTimePassword",
        });
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: false,
        oneTimePassword: expect.any(String),
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, oneTimePassword)).toEqual({
        type: "CorrectOneTimePassword",
    });

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: true,
        oneTimePassword: null,
    });
});

test("multiple incorrect password logins will lock the account and not verify email address", async () => {
    const account = await createTestAccount();

    expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
        type: "RegeneratedOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX1")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX2")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX3")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX4")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX5")).toEqual({
        type: "IncorrectOneTimePassword",
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, "XXXXX6")).toEqual({
        type: "AccountEmailAddressLockedUntilRegenerateOneTimePassword",
        hoursUntilRegenerateOneTimePasswordUnlocked: 24,
    });

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: false,
        oneTimePassword: expect.any(String),
    });
});

test("login with correct password does not verify account email address if email address already verified", async () => {
    const account = await createTestAccount({isEmailAddressVerified: true});

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        expect(await regenerateOneTimePasswordSignIn(account.emailAddress)).toEqual({
            type: "RegeneratedOneTimePassword",
        });
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: true,
        oneTimePassword: expect.any(String),
    });

    expect(await attemptOneTimePasswordSignIn(account.emailAddress, oneTimePassword)).toEqual({
        type: "CorrectOneTimePassword",
    });

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: true,
        oneTimePassword: null,
    });
});
