import {attemptOneTimePasswordSignIn} from "~/server/accounts/attempt_one_time_password_sign_in.js";
import {captureOneTimePasswordSignInEmailsForTest} from "~/server/accounts/capture_one_time_password_sign_in_emails_for_test.js";
import {
    createAccountEmailAddressForTest,
    createAccountForTest,
    getAccountEmailAddressForTest,
} from "~/server/accounts/create_account_for_test.js";
import {getAppleReviewerAccountPasswordForTest} from "~/server/accounts/internal/actually_regenerate_one_time_password_sign_in.js";
import {regenerateOneTimePasswordSignIn} from "~/server/accounts/regenerate_one_time_password_sign_in.js";
import {rewindAccountEmailAddressOneTimePasswordSignInStateTimeForTest} from "~/server/accounts/rewind_account_email_address_one_time_password_sign_in_state_time_for_test.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {FailedPreconditionError, PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {EmailAddress, validateEmailAddress} from "~/shared/helpers/string/email_address.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

const appleReviewerAccountPassword = getAppleReviewerAccountPasswordForTest();

const context = createTestContext({
    tasksInjection: {
        internalGetUpdateOurAccountNameTaskTransactionEntries: () => [],
    },
});

async function createTestAccount({
    isEmailAddressVerified = false,
}: {isEmailAddressVerified?: boolean} = {}) {
    const accountId = generateId<AccountId>();
    const emailAddress = validateEmailAddress(`test@${accountId}.test.cyberworlds.dev`);

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

test("multiple incorrect password logins will lock the account and even a correct password won\u2019t work", async () => {
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
test("can\u2019t login with apple reviewer\u2019s password", async () => {
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
