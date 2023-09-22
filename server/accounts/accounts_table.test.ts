import {subHours} from "date-fns";
import {
    attemptOneTimePasswordSignIn,
    captureOneTimePasswordSignInEmailsForTest,
    generateOneTimePassword,
    getAccountsTableForTest,
    regenerateOneTimePasswordSignIn,
} from "~/server/accounts/accounts_table.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {EmailAddress, validateEmailAddress} from "~/server/emails/email_address.js";
import {getAccountIfExists} from "~/server/spaces/spaces_table.js";
import {FailedPreconditionError, PermissionDeniedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";

const context = createTestContext();
const space1 = createTestSpace(context);
const space2 = createTestSpace(context);
const space1Session1 = createTestSession(context, space1);
const space1Session2 = createTestSession(context, space1);
const space1Session3 = createTestSession(context, space1);
const space2Session1 = createTestSession(context, space2);
const space2Session2 = createTestSession(context, space2);
const space2Session3 = createTestSession(context, space2);

const AccountsTable = getAccountsTableForTest();

async function createTestAccount({
    isEmailAddressVerified = false,
}: {isEmailAddressVerified?: boolean} = {}) {
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
            isVerified: isEmailAddressVerified,
        }),
    ]);

    return {
        id: accountId,
        emailAddress,
    };
}

async function getAccountEmailAddressItemForExpect(account: {
    id: AccountId;
    emailAddress: EmailAddress;
}) {
    const accountEmailAddressItem = await AccountsTable.getItemIfExists(context, {
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

async function getAccountEmailAddressItemUpdateLockVersionForExpect(account: {
    id: AccountId;
    emailAddress: EmailAddress;
}) {
    const accountEmailAddressItem = await AccountsTable.getItemIfExists(context, {
        partitionType: "AccountEmailAddress",
        sortRangeType: "Attributes",
        emailAddress: account.emailAddress,
    });

    expect(accountEmailAddressItem).not.toEqual(null);
    assert(accountEmailAddressItem);

    expect(accountEmailAddressItem.accountId).toEqual(account.id);

    return accountEmailAddressItem.updateLockVersion;
}

async function rewindOneTimePasswordSignInStateTime(emailAddress: EmailAddress, hours: number) {
    await AccountsTable.updateItem(
        context,
        {
            partitionType: "AccountEmailAddress",
            sortRangeType: "Attributes",
            emailAddress,
        },
        accountEmailAddressItem => {
            assert(accountEmailAddressItem?.oneTimePasswordSignInState);

            return {
                ...accountEmailAddressItem,
                oneTimePasswordSignInState: {
                    ...accountEmailAddressItem.oneTimePasswordSignInState,
                    generatedTime: subHours(
                        accountEmailAddressItem.oneTimePasswordSignInState.generatedTime,
                        hours,
                    ),
                    lastFailedAttemptTime: accountEmailAddressItem.oneTimePasswordSignInState
                        .lastFailedAttemptTime
                        ? subHours(
                              accountEmailAddressItem.oneTimePasswordSignInState
                                  .lastFailedAttemptTime,
                              hours,
                          )
                        : null,
                },
            };
        },
    );
}

const sessionInfo = {
    ipAddress: null,
    userAgent: null,
};

test("generates a one time password login hash", async () => {
    const account = await createTestAccount();

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: false,
        oneTimePassword: null,
    });

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(
            context.unauthenticatedAction(),
            account.emailAddress,
        );
    });

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: false,
        oneTimePassword: oneTimePasswordEmails[0]?.oneTimePassword,
    });
});

test("regenerating one time password updates the lock version", async () => {
    const account = await createTestAccount();

    expect(await getAccountEmailAddressItemUpdateLockVersionForExpect(account)).toEqual(undefined);

    await regenerateOneTimePasswordSignIn(context.unauthenticatedAction(), account.emailAddress);

    expect(await getAccountEmailAddressItemUpdateLockVersionForExpect(account)).toEqual(1);

    await regenerateOneTimePasswordSignIn(context.unauthenticatedAction(), account.emailAddress);

    expect(await getAccountEmailAddressItemUpdateLockVersionForExpect(account)).toEqual(2);

    await regenerateOneTimePasswordSignIn(context.unauthenticatedAction(), account.emailAddress);

    expect(await getAccountEmailAddressItemUpdateLockVersionForExpect(account)).toEqual(3);
});

test("regenerates the one time password login hash even if there was one already", async () => {
    const account = await createTestAccount();

    const oneTimePasswordEmails1 = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(
            context.unauthenticatedAction(),
            account.emailAddress,
        );
    });

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: false,
        oneTimePassword: oneTimePasswordEmails1[0]?.oneTimePassword,
    });

    const oneTimePasswordEmails2 = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(
            context.unauthenticatedAction(),
            account.emailAddress,
        );
    });

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: false,
        oneTimePassword: oneTimePasswordEmails2[0]?.oneTimePassword,
    });
});

test("attempted login fails when account has no password", async () => {
    const account = await createTestAccount();

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXXX", sessionInfo),
    ).rejects.toThrow(new FailedPreconditionError("Missing one time password"));
});

test("attempted login with wrong password fails when account has password", async () => {
    const account = await createTestAccount();

    await regenerateOneTimePasswordSignIn(context.unauthenticatedAction(), account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXXX", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));
});

test("attempted login with correct password succeeds", async () => {
    const account = await createTestAccount();

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(
            context.unauthenticatedAction(),
            account.emailAddress,
        );
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    await attemptOneTimePasswordSignIn(context, account.emailAddress, oneTimePassword, sessionInfo);
});

test("attempted login (success and failure) increments the update lock version", async () => {
    const account = await createTestAccount();

    expect(await getAccountEmailAddressItemUpdateLockVersionForExpect(account)).toEqual(undefined);

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXXX", sessionInfo),
    ).rejects.toThrow(new FailedPreconditionError("Missing one time password"));

    expect(await getAccountEmailAddressItemUpdateLockVersionForExpect(account)).toEqual(undefined);

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(
            context.unauthenticatedAction(),
            account.emailAddress,
        );
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    expect(await getAccountEmailAddressItemUpdateLockVersionForExpect(account)).toEqual(1);

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXXX", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    expect(await getAccountEmailAddressItemUpdateLockVersionForExpect(account)).toEqual(2);

    await attemptOneTimePasswordSignIn(context, account.emailAddress, oneTimePassword, sessionInfo);

    expect(await getAccountEmailAddressItemUpdateLockVersionForExpect(account)).toEqual(3);
});

test("attempted correct password expires after a short window of time", async () => {
    const account = await createTestAccount();

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(
            context.unauthenticatedAction(),
            account.emailAddress,
        );
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    await rewindOneTimePasswordSignInStateTime(account.emailAddress, 2);

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, oneTimePassword, sessionInfo),
    ).rejects.toThrow(new FailedPreconditionError("Missing one time password"));
});

test("attempted login with old correct password fails", async () => {
    const account = await createTestAccount();

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(
            context.unauthenticatedAction(),
            account.emailAddress,
        );
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    await regenerateOneTimePasswordSignIn(context.unauthenticatedAction(), account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, oneTimePassword, sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));
});

test("multiple incorrect password logins will lock the account", async () => {
    const account = await createTestAccount();

    await regenerateOneTimePasswordSignIn(context.unauthenticatedAction(), account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX1", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX2", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX3", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX4", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX5", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX6", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));
});

test("multiple incorrect password logins will lock the account and even a correct password won’t work", async () => {
    const account = await createTestAccount();

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(
            context.unauthenticatedAction(),
            account.emailAddress,
        );
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX1", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX2", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX3", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX4", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX5", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX6", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, oneTimePassword, sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));
});

test("correct password can not be used to login twice", async () => {
    const account = await createTestAccount();

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(
            context.unauthenticatedAction(),
            account.emailAddress,
        );
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    await attemptOneTimePasswordSignIn(context, account.emailAddress, oneTimePassword, sessionInfo);

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, oneTimePassword, sessionInfo),
    ).rejects.toThrow(new FailedPreconditionError("Missing one time password"));
});

test("null last failed login attempt time continues to keep the account locked", async () => {
    const account = await createTestAccount();

    await regenerateOneTimePasswordSignIn(context.unauthenticatedAction(), account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX1", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX2", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX3", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX4", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX5", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX6", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));

    await AccountsTable.updateItem(
        context,
        {
            partitionType: "AccountEmailAddress",
            sortRangeType: "Attributes",
            emailAddress: account.emailAddress,
        },
        accountEmailAddressItem => {
            assert(accountEmailAddressItem?.oneTimePasswordSignInState);

            return {
                ...accountEmailAddressItem,
                oneTimePasswordSignInState: {
                    ...accountEmailAddressItem.oneTimePasswordSignInState,
                    lastFailedAttemptTime: null,
                },
            };
        },
    );

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX7", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));
});

test("last failed login attempt time more than 24 hours in the past will allow more attempts to unlock the account", async () => {
    const account = await createTestAccount();

    await regenerateOneTimePasswordSignIn(context.unauthenticatedAction(), account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX1", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX2", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX3", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX4", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX5", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX6", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));

    await rewindOneTimePasswordSignInStateTime(account.emailAddress, 25);

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX7", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Missing one time password"));

    await regenerateOneTimePasswordSignIn(context.unauthenticatedAction(), account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX8", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX9", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));
});

test("last failed login attempt time more than 24 hours in the past will not allow unlocking the account with the old generated password", async () => {
    const account = await createTestAccount();

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(
            context.unauthenticatedAction(),
            account.emailAddress,
        );
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX1", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX2", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX3", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX4", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX5", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX6", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, oneTimePassword, sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));

    await rewindOneTimePasswordSignInStateTime(account.emailAddress, 25);

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, oneTimePassword, sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Missing one time password"));

    await regenerateOneTimePasswordSignIn(context.unauthenticatedAction(), account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, oneTimePassword, sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));
});

test("last failed login attempt time more than 24 hours in the past will allow unlocking the account with a new generated password", async () => {
    const account = await createTestAccount();

    await regenerateOneTimePasswordSignIn(context.unauthenticatedAction(), account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX1", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX2", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX3", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX4", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX5", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX6", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));

    await rewindOneTimePasswordSignInStateTime(account.emailAddress, 25);

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(
            context.unauthenticatedAction(),
            account.emailAddress,
        );
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    await attemptOneTimePasswordSignIn(context, account.emailAddress, oneTimePassword, sessionInfo);
});

test("last failed login attempt time less than 24 hours in the past will keep the account locked", async () => {
    const account = await createTestAccount();

    await regenerateOneTimePasswordSignIn(context.unauthenticatedAction(), account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX1", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX2", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX3", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX4", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX5", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX6", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));

    await rewindOneTimePasswordSignInStateTime(account.emailAddress, 23);

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX7", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await expect(
            regenerateOneTimePasswordSignIn(context.unauthenticatedAction(), account.emailAddress),
        ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(0);
});

test("regenerating one time password does not unlock an account", async () => {
    const account = await createTestAccount();

    await regenerateOneTimePasswordSignIn(context.unauthenticatedAction(), account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX1", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX2", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX3", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX4", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX5", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX6", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await expect(
            regenerateOneTimePasswordSignIn(context.unauthenticatedAction(), account.emailAddress),
        ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(0);
});

test("regenerating one time password does not reset the login attempt counter", async () => {
    const account = await createTestAccount();

    await regenerateOneTimePasswordSignIn(context.unauthenticatedAction(), account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX1", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX2", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX3", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await regenerateOneTimePasswordSignIn(context.unauthenticatedAction(), account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX4", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX5", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX6", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));
});

test("can not concurrently brute force login attempts", async () => {
    const account = await createTestAccount();

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(
            context.unauthenticatedAction(),
            account.emailAddress,
        );
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    const results = await Promise.allSettled([
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXX01", sessionInfo),
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXX02", sessionInfo),
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXX03", sessionInfo),
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXX04", sessionInfo),
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXX05", sessionInfo),
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXX06", sessionInfo),
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXX07", sessionInfo),
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXX08", sessionInfo),
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXX09", sessionInfo),
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXX10", sessionInfo),
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXX11", sessionInfo),
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXX12", sessionInfo),
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXX13", sessionInfo),
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXX14", sessionInfo),
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXX15", sessionInfo),
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXX16", sessionInfo),
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
        attemptOneTimePasswordSignIn(context, account.emailAddress, oneTimePassword, sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));
});

test("attempted login with incorrect password does not verify account email address", async () => {
    const account = await createTestAccount();

    await regenerateOneTimePasswordSignIn(context.unauthenticatedAction(), account.emailAddress);

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: false,
        oneTimePassword: expect.any(String),
    });

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXXX", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: false,
        oneTimePassword: expect.any(String),
    });
});

test("login with correct password verifies account email address", async () => {
    const account = await createTestAccount();

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(
            context.unauthenticatedAction(),
            account.emailAddress,
        );
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: false,
        oneTimePassword: expect.any(String),
    });

    await attemptOneTimePasswordSignIn(context, account.emailAddress, oneTimePassword, sessionInfo);

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: true,
        oneTimePassword: null,
    });
});

test("multiple incorrect password logins will lock the account and not verify email address", async () => {
    const account = await createTestAccount();

    await regenerateOneTimePasswordSignIn(context.unauthenticatedAction(), account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX1", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX2", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX3", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX4", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX5", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX6", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: false,
        oneTimePassword: expect.any(String),
    });
});

test("login with correct password does not verify account email address if email address already verified", async () => {
    const account = await createTestAccount({isEmailAddressVerified: true});

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(
            context.unauthenticatedAction(),
            account.emailAddress,
        );
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: true,
        oneTimePassword: expect.any(String),
    });

    await attemptOneTimePasswordSignIn(context, account.emailAddress, oneTimePassword, sessionInfo);

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

test("can get accounts in the same space as us", async () => {
    expect(
        (
            await getAccountIfExists(
                context.action(space1Session1),
                space1.id,
                space1Session1.accountId,
            )
        )?.initialData.name,
    ).toEqual(space1Session1.account.initialData.name);

    expect(
        (
            await getAccountIfExists(
                context.action(space1Session1),
                space1.id,
                space1Session2.accountId,
            )
        )?.initialData.name,
    ).toEqual(space1Session2.account.initialData.name);

    expect(
        (
            await getAccountIfExists(
                context.action(space1Session1),
                space1.id,
                space1Session3.accountId,
            )
        )?.initialData.name,
    ).toEqual(space1Session3.account.initialData.name);
});

test("can not get accounts that don't exist", async () => {
    expect(
        await getAccountIfExists(context.action(space1Session1), space1.id, generateId()),
    ).toEqual(null);
});

test("can not get accounts in a different space than us", async () => {
    expect(
        await getAccountIfExists(
            context.action(space1Session1),
            space1.id,
            space2Session1.accountId,
        ),
    ).toEqual(null);

    expect(
        await getAccountIfExists(
            context.action(space1Session1),
            space1.id,
            space2Session2.accountId,
        ),
    ).toEqual(null);

    expect(
        await getAccountIfExists(
            context.action(space1Session1),
            space1.id,
            space2Session3.accountId,
        ),
    ).toEqual(null);
});

test("can not get accounts through a space we don't have access to", async () => {
    await expect(() =>
        getAccountIfExists(context.action(space1Session1), space2.id, generateId()),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(() =>
        getAccountIfExists(context.action(space1Session1), space2.id, space2Session1.accountId),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(() =>
        getAccountIfExists(context.action(space1Session1), space2.id, space2Session2.accountId),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(() =>
        getAccountIfExists(context.action(space1Session1), space2.id, space2Session3.accountId),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can not get accounts through a space we don't have access to even if we have access to the accounts through a different space", async () => {
    await expect(() =>
        getAccountIfExists(context.action(space1Session1), space2.id, space1Session1.accountId),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(() =>
        getAccountIfExists(context.action(space1Session1), space2.id, space1Session2.accountId),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(() =>
        getAccountIfExists(context.action(space1Session1), space2.id, space1Session3.accountId),
    ).rejects.toThrow(PermissionDeniedError);
});
