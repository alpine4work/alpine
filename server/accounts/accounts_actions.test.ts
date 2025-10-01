import {
    appleReviewerAccountEmailAddress,
    attemptOneTimePasswordSignIn,
    authorizeInternalAccess,
    captureOneTimePasswordSignInEmailsForTest,
    createAccountEmailAddressForTest,
    createAccountForTest,
    generateOneTimePassword,
    getAccountByEmailAddressAsAdmin,
    getAccountByIdAsAdmin,
    getAccountEmailAddressForTest,
    getAccountSettingsForTest,
    getAppleReviewerAccountPasswordForTest,
    getOurLastOpenedSpaceId,
    regenerateOneTimePasswordSignIn,
    rewindAccountEmailAddressOneTimePasswordSignInStateTimeForTest,
    updateOurLastOpenedSpaceId,
} from "~/server/accounts/accounts_actions.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {EmailAddress, validateEmailAddress} from "~/server/emails/email_address.js";
import {getAccountIfExists, removeSpaceAccount} from "~/server/spaces/spaces_actions.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {
    FailedPreconditionError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";

const appleReviewerAccountPassword = getAppleReviewerAccountPasswordForTest();

const context = createTestContext({
    spacesInjection,
    tasksInjection: {
        internalGetUpdateOurAccountNameTaskTransactionEntries: () => [],
    },
});

async function createTestAccount({
    isEmailAddressVerified = false,
}: {isEmailAddressVerified?: boolean} = {}) {
    const accountId = generateId<AccountId>();
    const emailAddress = await validateEmailAddress(
        context,
        `test@${accountId}.test.cyberworlds.dev`,
    );

    await createAccountForTest(context, {id: accountId, name: "Test"});

    await createAccountEmailAddressForTest(context, {
        accountId,
        emailAddress,
        isEmailAddressVerified,
    });

    return {
        id: accountId,
        emailAddress,
    };
}

async function getAccountEmailAddressItemForExpect(account: {
    id: AccountId;
    emailAddress: EmailAddress;
}) {
    const accountEmailAddressItem = await getAccountEmailAddressForTest(
        context,
        account.emailAddress,
    );

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
    const accountEmailAddressItem = await getAccountEmailAddressForTest(
        context,
        account.emailAddress,
    );

    expect(accountEmailAddressItem).not.toEqual(null);
    assert(accountEmailAddressItem);

    expect(accountEmailAddressItem.accountId).toEqual(account.id);

    return accountEmailAddressItem.updateLockVersion;
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
            context.unknownAnonymousAction(),
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

    await regenerateOneTimePasswordSignIn(context.unknownAnonymousAction(), account.emailAddress);

    expect(await getAccountEmailAddressItemUpdateLockVersionForExpect(account)).toEqual(1);

    await regenerateOneTimePasswordSignIn(context.unknownAnonymousAction(), account.emailAddress);

    expect(await getAccountEmailAddressItemUpdateLockVersionForExpect(account)).toEqual(2);

    await regenerateOneTimePasswordSignIn(context.unknownAnonymousAction(), account.emailAddress);

    expect(await getAccountEmailAddressItemUpdateLockVersionForExpect(account)).toEqual(3);
});

test("regenerates the one time password login hash even if there was one already", async () => {
    const account = await createTestAccount();

    const oneTimePasswordEmails1 = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(
            context.unknownAnonymousAction(),
            account.emailAddress,
        );
    });

    expect(await getAccountEmailAddressItemForExpect(account)).toEqual({
        isVerified: false,
        oneTimePassword: oneTimePasswordEmails1[0]?.oneTimePassword,
    });

    const oneTimePasswordEmails2 = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(
            context.unknownAnonymousAction(),
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

    await regenerateOneTimePasswordSignIn(context.unknownAnonymousAction(), account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXXX", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));
});

test("attempted login with correct password succeeds", async () => {
    const account = await createTestAccount();

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(
            context.unknownAnonymousAction(),
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
            context.unknownAnonymousAction(),
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
            context.unknownAnonymousAction(),
            account.emailAddress,
        );
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    await rewindAccountEmailAddressOneTimePasswordSignInStateTimeForTest(
        context,
        account.emailAddress,
        2,
    );

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, oneTimePassword, sessionInfo),
    ).rejects.toThrow(new FailedPreconditionError("Missing one time password"));
});

test("attempted login with old correct password fails", async () => {
    const account = await createTestAccount();

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(
            context.unknownAnonymousAction(),
            account.emailAddress,
        );
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    await regenerateOneTimePasswordSignIn(context.unknownAnonymousAction(), account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, oneTimePassword, sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));
});

test("multiple incorrect password logins will lock the account", async () => {
    const account = await createTestAccount();

    await regenerateOneTimePasswordSignIn(context.unknownAnonymousAction(), account.emailAddress);

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
            context.unknownAnonymousAction(),
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
            context.unknownAnonymousAction(),
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

test("last failed login attempt time more than 24 hours in the past will allow more attempts to unlock the account", async () => {
    const account = await createTestAccount();

    await regenerateOneTimePasswordSignIn(context.unknownAnonymousAction(), account.emailAddress);

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

    await rewindAccountEmailAddressOneTimePasswordSignInStateTimeForTest(
        context,
        account.emailAddress,
        25,
    );

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX7", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Missing one time password"));

    await regenerateOneTimePasswordSignIn(context.unknownAnonymousAction(), account.emailAddress);

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
            context.unknownAnonymousAction(),
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

    await rewindAccountEmailAddressOneTimePasswordSignInStateTimeForTest(
        context,
        account.emailAddress,
        25,
    );

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, oneTimePassword, sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Missing one time password"));

    await regenerateOneTimePasswordSignIn(context.unknownAnonymousAction(), account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, oneTimePassword, sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));
});

test("last failed login attempt time more than 24 hours in the past will allow unlocking the account with a new generated password", async () => {
    const account = await createTestAccount();

    await regenerateOneTimePasswordSignIn(context.unknownAnonymousAction(), account.emailAddress);

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

    await rewindAccountEmailAddressOneTimePasswordSignInStateTimeForTest(
        context,
        account.emailAddress,
        25,
    );

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(
            context.unknownAnonymousAction(),
            account.emailAddress,
        );
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    await attemptOneTimePasswordSignIn(context, account.emailAddress, oneTimePassword, sessionInfo);
});

test("last failed login attempt time less than 24 hours in the past will keep the account locked", async () => {
    const account = await createTestAccount();

    await regenerateOneTimePasswordSignIn(context.unknownAnonymousAction(), account.emailAddress);

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

    await rewindAccountEmailAddressOneTimePasswordSignInStateTimeForTest(
        context,
        account.emailAddress,
        23,
    );

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX7", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await expect(
            regenerateOneTimePasswordSignIn(context.unknownAnonymousAction(), account.emailAddress),
        ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(0);
});

test("regenerating one time password does not unlock an account", async () => {
    const account = await createTestAccount();

    await regenerateOneTimePasswordSignIn(context.unknownAnonymousAction(), account.emailAddress);

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
            regenerateOneTimePasswordSignIn(context.unknownAnonymousAction(), account.emailAddress),
        ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(0);
});

test("regenerating one time password does not reset the login attempt counter", async () => {
    const account = await createTestAccount();

    await regenerateOneTimePasswordSignIn(context.unknownAnonymousAction(), account.emailAddress);

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX1", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX2", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignIn(context, account.emailAddress, "XXXXX3", sessionInfo),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await regenerateOneTimePasswordSignIn(context.unknownAnonymousAction(), account.emailAddress);

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
            context.unknownAnonymousAction(),
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

    await regenerateOneTimePasswordSignIn(context.unknownAnonymousAction(), account.emailAddress);

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
            context.unknownAnonymousAction(),
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

    await regenerateOneTimePasswordSignIn(context.unknownAnonymousAction(), account.emailAddress);

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
            context.unknownAnonymousAction(),
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
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    expect(
        (await getAccountIfExists(session1.action(), space.id, session1.account.id))?.initialData
            .name,
    ).toEqual(session1.account.initialName);

    expect(
        (await getAccountIfExists(session1.action(), space.id, session2.account.id))?.initialData
            .name,
    ).toEqual(session2.account.initialName);

    expect(
        (await getAccountIfExists(session1.action(), space.id, session3.account.id))?.initialData
            .name,
    ).toEqual(session3.account.initialName);
});

test("can not get accounts that don’t exist", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    expect(await getAccountIfExists(session.action(), space.id, generateId())).toEqual(null);
});

test("can not get accounts in a different space than us", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);
    const space1Session1 = await space1.createSession();
    const [space2Session1, space2Session2, space2Session3] = await space2.createSessions(3);

    expect(
        await getAccountIfExists(space1Session1.action(), space1.id, space2Session1.account.id),
    ).toEqual(null);

    expect(
        await getAccountIfExists(space1Session1.action(), space1.id, space2Session2.account.id),
    ).toEqual(null);

    expect(
        await getAccountIfExists(space1Session1.action(), space1.id, space2Session3.account.id),
    ).toEqual(null);
});

test("can not get accounts through a space we don’t have access to", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);
    const space1Session1 = await space1.createSession();
    const [space2Session1, space2Session2, space2Session3] = await space2.createSessions(3);

    await expect(() =>
        getAccountIfExists(space1Session1.action(), space2.id, generateId()),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(() =>
        getAccountIfExists(space1Session1.action(), space2.id, space2Session1.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(() =>
        getAccountIfExists(space1Session1.action(), space2.id, space2Session2.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(() =>
        getAccountIfExists(space1Session1.action(), space2.id, space2Session3.account.id),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can not get accounts through a space we don’t have access to even if we have access to the accounts through a different space", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);
    const [space1Session1, space1Session2, space1Session3] = await space1.createSessions(3);

    await expect(() =>
        getAccountIfExists(space1Session1.action(), space2.id, space1Session1.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(() =>
        getAccountIfExists(space1Session1.action(), space2.id, space1Session2.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(() =>
        getAccountIfExists(space1Session1.action(), space2.id, space1Session3.account.id),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can get any account by id as admin", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);
    const space3 = await TestSpace.create(context);

    const session1 = await space1.createSession();
    const session2 = await space2.createSession();
    const session3 = await space3.createSession();
    const session4a = await space1.createSession();
    const session4b = await space2.createSession(session4a.account);

    const adminSession = await space1.createSession({hasInternalAccess: true});

    await expect(getAccountByIdAsAdmin(adminSession.action(), generateId())).rejects.toThrow(
        NotFoundError,
    );

    await expect(
        getAccountByIdAsAdmin(adminSession.action(), adminSession.account.id),
    ).resolves.toEqual(await adminSession.account.get());
    await expect(
        getAccountByIdAsAdmin(adminSession.action(), session1.account.id),
    ).resolves.toEqual(await session1.account.get());
    await expect(
        getAccountByIdAsAdmin(adminSession.action(), session2.account.id),
    ).resolves.toEqual(await session2.account.get());
    await expect(
        getAccountByIdAsAdmin(adminSession.action(), session3.account.id),
    ).resolves.toEqual(await session3.account.get());
    await expect(
        getAccountByIdAsAdmin(adminSession.action(), session4a.account.id),
    ).resolves.toEqual(await session4a.account.get());
    await expect(
        getAccountByIdAsAdmin(adminSession.action(), session4b.account.id),
    ).resolves.toEqual(await session4a.account.get());

    for (const session of [session1, session2, session3, session4a, session4b]) {
        await expect(
            getAccountByIdAsAdmin(session.action(), adminSession.account.id),
        ).rejects.toThrow(PermissionDeniedError);
        await expect(getAccountByIdAsAdmin(session.action(), session1.account.id)).rejects.toThrow(
            PermissionDeniedError,
        );
        await expect(getAccountByIdAsAdmin(session.action(), session2.account.id)).rejects.toThrow(
            PermissionDeniedError,
        );
        await expect(getAccountByIdAsAdmin(session.action(), session3.account.id)).rejects.toThrow(
            PermissionDeniedError,
        );
        await expect(getAccountByIdAsAdmin(session.action(), session4a.account.id)).rejects.toThrow(
            PermissionDeniedError,
        );
        await expect(getAccountByIdAsAdmin(session.action(), session4b.account.id)).rejects.toThrow(
            PermissionDeniedError,
        );
    }

    await expect(
        getAccountByIdAsAdmin(adminSession.action(), session1.account.id),
    ).resolves.toEqual(await session1.account.get());
});

test("can get any account by email address as admin", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);
    const space3 = await TestSpace.create(context);

    const session1 = await space1.createSession();
    const session2 = await space2.createSession();
    const session3 = await space3.createSession();
    const session4a = await space1.createSession();
    const session4b = await space2.createSession(session4a.account);

    const emailAddress1 = await session1.account.createEmailAddress();
    const emailAddress3a = await session3.account.createEmailAddress();
    const emailAddress3b = await session3.account.createEmailAddress();
    const emailAddress4 = await session4a.account.createEmailAddress();

    const adminSession = await space1.createSession({hasInternalAccess: true});
    const adminEmailAddress = await adminSession.account.createEmailAddress();

    await expect(
        getAccountByEmailAddressAsAdmin(adminSession.action(), session1.account.id),
    ).rejects.toThrow(InvalidArgumentError);

    await expect(
        getAccountByEmailAddressAsAdmin(
            adminSession.action(),
            `account.${generateId()}@test.cyberworlds.dev`,
        ),
    ).rejects.toThrow(NotFoundError);

    await expect(
        getAccountByEmailAddressAsAdmin(adminSession.action(), adminEmailAddress),
    ).resolves.toEqual(await adminSession.account.get());
    await expect(
        getAccountByEmailAddressAsAdmin(adminSession.action(), emailAddress1),
    ).resolves.toEqual(await session1.account.get());
    await expect(
        getAccountByEmailAddressAsAdmin(adminSession.action(), emailAddress3a),
    ).resolves.toEqual(await session3.account.get());
    await expect(
        getAccountByEmailAddressAsAdmin(adminSession.action(), emailAddress3b),
    ).resolves.toEqual(await session3.account.get());
    await expect(
        getAccountByEmailAddressAsAdmin(adminSession.action(), emailAddress4),
    ).resolves.toEqual(await session4a.account.get());
    await expect(
        getAccountByEmailAddressAsAdmin(adminSession.action(), emailAddress4),
    ).resolves.toEqual(await session4b.account.get());

    for (const session of [session1, session2, session3, session4a, session4b]) {
        await expect(
            getAccountByEmailAddressAsAdmin(session.action(), adminEmailAddress),
        ).rejects.toThrow(PermissionDeniedError);
        await expect(
            getAccountByEmailAddressAsAdmin(session.action(), emailAddress1),
        ).rejects.toThrow(PermissionDeniedError);
        await expect(
            getAccountByEmailAddressAsAdmin(session.action(), emailAddress3a),
        ).rejects.toThrow(PermissionDeniedError);
        await expect(
            getAccountByEmailAddressAsAdmin(session.action(), emailAddress3b),
        ).rejects.toThrow(PermissionDeniedError);
        await expect(
            getAccountByEmailAddressAsAdmin(session.action(), emailAddress4),
        ).rejects.toThrow(PermissionDeniedError);
        await expect(
            getAccountByEmailAddressAsAdmin(session.action(), emailAddress4),
        ).rejects.toThrow(PermissionDeniedError);
    }

    await expect(
        getAccountByEmailAddressAsAdmin(adminSession.action(), emailAddress3b),
    ).resolves.toEqual(await session3.account.get());
});

test("can’t login with apple reviewer’s password", async () => {
    const account = await createTestAccount();

    expect(await getAccountEmailAddressItemUpdateLockVersionForExpect(account)).toEqual(undefined);

    await expect(
        attemptOneTimePasswordSignIn(
            context,
            account.emailAddress,
            appleReviewerAccountPassword,
            sessionInfo,
        ),
    ).rejects.toThrow(new FailedPreconditionError("Missing one time password"));

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(
            context.unknownAnonymousAction(),
            account.emailAddress,
        );
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    await expect(
        attemptOneTimePasswordSignIn(
            context,
            account.emailAddress,
            appleReviewerAccountPassword,
            sessionInfo,
        ),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await attemptOneTimePasswordSignIn(context, account.emailAddress, oneTimePassword, sessionInfo);
});

test("apple reviewer always has the same password", async () => {
    const account = await TestAccount.create(context);

    await account.createEmailAddress(appleReviewerAccountEmailAddress);

    await expect(
        attemptOneTimePasswordSignIn(
            context,
            appleReviewerAccountEmailAddress,
            "XXXXXX",
            sessionInfo,
        ),
    ).rejects.toThrow(new FailedPreconditionError("Missing one time password"));

    await expect(
        attemptOneTimePasswordSignIn(
            context,
            appleReviewerAccountEmailAddress,
            appleReviewerAccountPassword,
            sessionInfo,
        ),
    ).rejects.toThrow(new FailedPreconditionError("Missing one time password"));

    const oneTimePasswordLoginEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(
            context.unknownAnonymousAction(),
            appleReviewerAccountEmailAddress,
        );
    });

    expect(oneTimePasswordLoginEmails.length).toEqual(1);
    const oneTimePassword = oneTimePasswordLoginEmails[0]!.oneTimePassword;

    expect(oneTimePassword).toEqual(appleReviewerAccountPassword);

    await expect(
        attemptOneTimePasswordSignIn(
            context,
            appleReviewerAccountEmailAddress,
            "XXXXXX",
            sessionInfo,
        ),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await attemptOneTimePasswordSignIn(
        context,
        appleReviewerAccountEmailAddress,
        oneTimePassword,
        sessionInfo,
    );
});

test("can authorize internal access", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession({hasInternalAccess: true});
    const account1 = session1.account;
    const session2 = await space.createSession();
    const account2 = await TestAccount.create(context);

    await authorizeInternalAccess(session1.action());

    await expect(authorizeInternalAccess(session2.action())).rejects.toThrow(
        "Account does not have internal access",
    );

    await expect(authorizeInternalAccess(space.systemAction())).rejects.toThrow(
        "System actor does not have internal access",
    );

    await expect(authorizeInternalAccess(context.anonymousAction())).rejects.toThrow(
        "Unauthenticated session",
    );

    await expect(
        authorizeInternalAccess(context.impersonatedAccountAction(space.id, account1.id)),
    ).rejects.toThrow("Impersonated account actor does not have internal access");

    await expect(
        authorizeInternalAccess(context.impersonatedAccountAction(space.id, account2.id)),
    ).rejects.toThrow("Impersonated account actor does not have internal access");
});

describe("updateOurLastOpenedSpaceId()", () => {
    test("should allow updating the lastOpenedSpaceId for the current session", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);

        const session = await space1.createSession();
        await space2.addAccount(session);

        await updateOurLastOpenedSpaceId(session.action(), space1.id);

        const result1 = await getAccountSettingsForTest(session.action(), session.account.id);
        expect(result1.lastOpenedSpaceId).toBe(space1.id);

        await updateOurLastOpenedSpaceId(session.action(), space2.id);

        const result2 = await getAccountSettingsForTest(session.action(), session.account.id);
        expect(result2.lastOpenedSpaceId).toBe(space2.id);
    });

    test("does not allow updating the lastOpenedSpaceId to a space the session in not a member of", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);

        const session = await space1.createSession();

        await expect(updateOurLastOpenedSpaceId(session.action(), space2.id)).rejects.toThrow(
            new PermissionDeniedError("You don’t have access to this space."),
        );
    });

    test("does not allow updating the lastOpenedSpaceId to a space the session is invited to", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);
        const space2OwnerSession = await space2.createSession({role: "Owner"});

        const session = await space1.createSession();
        const email = await session.account.createEmailAddress();

        await space2.inviteEmailAddress(space2OwnerSession.action(), email);

        await expect(updateOurLastOpenedSpaceId(session.action(), space2.id)).rejects.toThrow(
            new PermissionDeniedError("You don’t have access to this space."),
        );
    });

    test("does not allow updating the lastOpenedSpaceId to a space the session is removed from", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);
        const space2OwnerSession = await space2.createSession({role: "Owner"});

        const session = await space1.createSession();
        await space2.addAccount(session);

        await removeSpaceAccount(space2OwnerSession.action(), {
            spaceId: space2.id,
            accountId: session.account.id,
        });

        await expect(updateOurLastOpenedSpaceId(session.action(), space2.id)).rejects.toThrow(
            new PermissionDeniedError("You don’t have access to this space."),
        );
    });
});

describe("getOurLastOpenedSpaceId()", () => {
    test("should return the correct spaceId for a space we have access to", async () => {
        const space1 = await TestSpace.create(context);
        const session = await space1.createSession();

        await updateOurLastOpenedSpaceId(session.action(), space1.id);

        const result = await getOurLastOpenedSpaceId(session.action());
        expect(result).toBe(space1.id);
    });

    test("defaults when the lastOpenedSpaceId is set to an account we’re invited to", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);
        const space2OwnerSession = await space2.createSession({role: "Owner"});
        const session = await space1.createSession();
        const email = await session.account.createEmailAddress();

        // Add our account and update the space ID
        await space2.addAccount(session);
        await updateOurLastOpenedSpaceId(session.action(), space2.id);

        // Remove the account and re-invite it
        await removeSpaceAccount(space2OwnerSession.action(), {
            spaceId: space2.id,
            accountId: session.account.id,
        });
        await space2.inviteEmailAddress(space2OwnerSession.action(), email);

        // Should default to our first space
        const result = await getOurLastOpenedSpaceId(session.action());
        expect(result).toBe(space1.id);
    });

    test("defaults when the lastOpenedSpaceId is set to an account we’re removed from", async () => {
        const space1 = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);
        const space2OwnerSession = await space2.createSession({role: "Owner"});
        const session = await space1.createSession();

        // Add our account and update the space ID
        await space2.addAccount(session);
        await updateOurLastOpenedSpaceId(session.action(), space2.id);

        // Remove the account and re-invite it
        await removeSpaceAccount(space2OwnerSession.action(), {
            spaceId: space2.id,
            accountId: session.account.id,
        });

        // Should default to our first space
        const result = await getOurLastOpenedSpaceId(session.action());
        expect(result).toBe(space1.id);
    });
});
