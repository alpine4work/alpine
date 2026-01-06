import {appleReviewerAccountEmailAddress} from "~/server/accounts/apple_reviewer_account_email_address.js";
import {attemptOneTimePasswordSignIn} from "~/server/accounts/attempt_one_time_password_sign_in.js";
import {
    createAccountEmailAddressForTest,
    createAccountForTest,
    getAccountEmailAddressForTest,
} from "~/server/accounts/create_account_for_test.js";
import {
    captureOneTimePasswordSignInEmailsForTest,
    getAppleReviewerAccountPasswordForTest,
    regenerateOneTimePasswordSignIn,
} from "~/server/accounts/regenerate_one_time_password_sign_in.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {EmailAddress, validateEmailAddress} from "~/server/emails/email_address.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {FailedPreconditionError, PermissionDeniedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";

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
