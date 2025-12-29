import {attemptOneTimePasswordSignIn} from "~/server/accounts/attempt_one_time_password_sign_in.js";
import {captureOneTimePasswordSignInEmailsForTest} from "~/server/accounts/capture_one_time_password_sign_in_emails_for_test.js";
import {getAccountEmailAddressForTest} from "~/server/accounts/create_account_for_test.js";
import {getAccountItem} from "~/server/accounts/internal/get_account_item.js";
import {saveAccountSignUpProfile} from "~/server/accounts/save_account_sign_up_profile.js";
import {signUpAccountWithEmailAddress} from "~/server/accounts/sign_up_account_with_email_address.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {validateEmailAddress} from "~/server/emails/email_address.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {generateId} from "~/shared/id/id.js";

const context = createTestContext({
    spacesInjection,
    tasksInjection: {
        internalGetUpdateOurAccountNameTaskTransactionEntries: () => [],
    },
});

const sessionInfo = {
    ipAddress: null,
    userAgent: null,
};

test("fresh sign up creates account with one time password", async () => {
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.unknownAnonymousAction(), emailAddress);
    });

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;
    const accountEmailAddressItem = await getAccountEmailAddressForTest(context, emailAddress);
    const accountItem = await getAccountItem(
        context.withCache(),
        accountEmailAddressItem.accountId,
    );

    expect(accountEmailAddressItem).toMatchObject({
        isVerified: false,
        oneTimePasswordSignInState: expect.objectContaining({
            password: oneTimePassword,
        }),
    });
    expect(accountItem).toMatchObject({
        name: emailAddress.slice(0, 50),
        hasNotSignedUp: true,
    });
});

test("sign up with pending invitation reuses existing account", async () => {
    const space = await TestSpace.create(context);
    const admin = await space.createSession({role: "Admin"});
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    await space.inviteEmailAddress(admin.action(), emailAddress);

    const accountEmailAddressItemBeforeSignUp = await getAccountEmailAddressForTest(
        context,
        emailAddress,
    );
    const accountIdFromInvite = accountEmailAddressItemBeforeSignUp.accountId;

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        const returnedAccountId = await signUpAccountWithEmailAddress(
            context.unknownAnonymousAction(),
            emailAddress,
        );
        expect(returnedAccountId).toEqual(accountIdFromInvite);
    });

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;
    const accountEmailAddressItemAfterSignUp = await getAccountEmailAddressForTest(
        context,
        emailAddress,
    );

    expect(accountEmailAddressItemAfterSignUp).toMatchObject({
        accountId: accountIdFromInvite,
        isVerified: false,
        oneTimePasswordSignInState: expect.objectContaining({
            password: oneTimePassword,
        }),
    });
});

test("sign up with pending invitation and then sign in", async () => {
    const space = await TestSpace.create(context);
    const admin = await space.createSession({role: "Admin"});
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    await space.inviteEmailAddress(admin.action(), emailAddress);

    const accountEmailAddressItemFromInvite = await getAccountEmailAddressForTest(
        context,
        emailAddress,
    );
    const accountIdFromInvite = accountEmailAddressItemFromInvite.accountId;

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.unknownAnonymousAction(), emailAddress);
    });

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    await attemptOneTimePasswordSignIn(context, emailAddress, oneTimePassword, sessionInfo);

    const accountEmailAddressItemAfterSignIn = await getAccountEmailAddressForTest(
        context,
        emailAddress,
    );

    expect(accountEmailAddressItemAfterSignIn).toMatchObject({
        isVerified: true,
        accountId: accountIdFromInvite,
    });
});

test("attempting to sign up after saving sign up profile is ok", async () => {
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    await signUpAccountWithEmailAddress(context.unknownAnonymousAction(), emailAddress);

    const accountEmailAddressItem = await getAccountEmailAddressForTest(context, emailAddress);

    await saveAccountSignUpProfile(context.withCache(), {
        accountId: accountEmailAddressItem.accountId,
        name: "Test User",
        reactionCharacter: {type: "Cat", variant: "Grey"},
    });

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.unknownAnonymousAction(), emailAddress);
    });

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    await attemptOneTimePasswordSignIn(context, emailAddress, oneTimePassword, sessionInfo);
});

test("sign in with one time password after sign up", async () => {
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.unknownAnonymousAction(), emailAddress);
    });

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    const accountEmailAddressItemBeforeSignIn = await getAccountEmailAddressForTest(
        context,
        emailAddress,
    );

    const {sessionId, sessionAccountId} = await attemptOneTimePasswordSignIn(
        context,
        emailAddress,
        oneTimePassword,
        sessionInfo,
    );

    const accountEmailAddressItemAfterSignIn = await getAccountEmailAddressForTest(
        context,
        emailAddress,
    );

    expect({sessionId, sessionAccountId}).toMatchObject({
        sessionId: expect.any(String),
        sessionAccountId: accountEmailAddressItemBeforeSignIn.accountId,
    });
    expect(accountEmailAddressItemAfterSignIn).toMatchObject({
        isVerified: true,
    });
    expect(accountEmailAddressItemAfterSignIn.oneTimePasswordSignInState).toBeUndefined();
});

test("signing up multiple times regenerates one time password", async () => {
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    const oneTimePasswordEmails1 = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.unknownAnonymousAction(), emailAddress);
    });

    const firstPassword = oneTimePasswordEmails1[0]!.oneTimePassword;

    const oneTimePasswordEmails2 = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.unknownAnonymousAction(), emailAddress);
    });

    const secondPassword = oneTimePasswordEmails2[0]!.oneTimePassword;

    await expect(
        attemptOneTimePasswordSignIn(context, emailAddress, firstPassword, sessionInfo),
    ).rejects.toThrow();

    const {sessionId} = await attemptOneTimePasswordSignIn(
        context,
        emailAddress,
        secondPassword,
        sessionInfo,
    );

    expect(firstPassword).not.toEqual(secondPassword);
    expect(sessionId).toEqual(expect.any(String));
});
