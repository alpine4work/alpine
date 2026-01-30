import {attemptOneTimePasswordSignIn} from "~/server/accounts/attempt_one_time_password_sign_in.js";
import {captureOneTimePasswordSignInEmailsForTest} from "~/server/accounts/capture_one_time_password_sign_in_emails_for_test.js";
import {getAccountEmailAddressForTest} from "~/server/accounts/create_account_for_test.js";
import {getAccountItem} from "~/server/accounts/internal/get_account_item.js";
import {
    saveAccountSignUpProfile,
    saveAccountSignUpProfileBeforeExecuteTestCheckpoint,
} from "~/server/accounts/save_account_sign_up_profile.js";
import {signUpAccountWithEmailAddress} from "~/server/accounts/sign_up_account_with_email_address.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {acceptSpaceAccountInvite} from "~/server/spaces/accept_space_account_invite.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {validateEmailAddress} from "~/shared/helpers/string/email_address.js";
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

test("saving sign up profile for a fresh account updates account", async () => {
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    await signUpAccountWithEmailAddress(context.unknownAnonymousAction(), emailAddress);

    const accountEmailAddressItem = await getAccountEmailAddressForTest(context, emailAddress);
    const accountId = accountEmailAddressItem.accountId;

    await saveAccountSignUpProfile(context.withCache(), {
        accountId,
        name: "Test User",
        reactionCharacter: {type: "Cat", variant: "Grey"},
    });

    const accountItemAfterFinish = await getAccountItem(context.withCache(), accountId);

    expect(accountItemAfterFinish).toMatchObject({
        name: "Test User",
        nameVersion: 1,
        reactionCharacter: {type: "Cat", variant: "Grey"},
    });
    expect(accountItemAfterFinish.hasNotSignedUp).toBe(true);
});

test("saving sign up profile for an account with a pending invite", async () => {
    const space = await TestSpace.create(context);
    const admin = await space.createSession({role: "Admin"});
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    await admin.inviteEmailAddress(emailAddress);

    const accountEmailAddressItem = await getAccountEmailAddressForTest(context, emailAddress);
    const accountId = accountEmailAddressItem.accountId;

    await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.unknownAnonymousAction(), emailAddress);
    });

    await saveAccountSignUpProfile(context.withCache(), {
        accountId,
        name: "Invited User",
        reactionCharacter: {type: "Cat", variant: "Pink"},
    });

    const accountItemAfterFinish = await getAccountItem(context.withCache(), accountId);

    expect(accountItemAfterFinish).toMatchObject({
        name: "Invited User",
        nameVersion: 1,
        reactionCharacter: {type: "Cat", variant: "Pink"},
    });
    expect(accountItemAfterFinish.hasNotSignedUp).toBe(true);
});

test("cannot save sign up profile after joining a space", async () => {
    const space = await TestSpace.create(context);
    const admin = await space.createSession({role: "Admin"});
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    await admin.inviteEmailAddress(emailAddress);

    const accountEmailAddressItem = await getAccountEmailAddressForTest(context, emailAddress);
    const accountId = accountEmailAddressItem.accountId;

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.unknownAnonymousAction(), emailAddress);
    });

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    const {sessionId} = await attemptOneTimePasswordSignIn(
        context,
        emailAddress,
        oneTimePassword,
        sessionInfo,
    );

    const sessionContext = context.action({sessionId, accountId});

    await acceptSpaceAccountInvite(sessionContext, space.id);

    await expect(
        saveAccountSignUpProfile(context.withCache(), {
            accountId,
            name: "Should Fail",
            reactionCharacter: {type: "Cat", variant: "Grey"},
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Can only finish account sign up when the account hasn\u2019t joined any spaces (the account may have pending invites)",
        ),
    );
});

test("name version increments when saving sign up profile", async () => {
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    await signUpAccountWithEmailAddress(context.unknownAnonymousAction(), emailAddress);

    const accountEmailAddressItem = await getAccountEmailAddressForTest(context, emailAddress);
    const accountId = accountEmailAddressItem.accountId;

    const accountItemBefore = await getAccountItem(context.withCache(), accountId);
    const nameVersionBefore = accountItemBefore.nameVersion;

    await saveAccountSignUpProfile(context.withCache(), {
        accountId,
        name: "Version Test",
        reactionCharacter: {type: "Cat", variant: "Grey"},
    });

    const accountItemAfter = await getAccountItem(context.withCache(), accountId);

    expect(accountItemAfter.nameVersion).toEqual(nameVersionBefore + 1);
});

test("invited account can save account sign up profile without calling signUpAccountWithEmailAddress first", async () => {
    const space = await TestSpace.create(context);
    const admin = await space.createSession({role: "Admin"});
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    await admin.inviteEmailAddress(emailAddress);

    const accountEmailAddressItem = await getAccountEmailAddressForTest(context, emailAddress);
    const accountId = accountEmailAddressItem.accountId;

    await saveAccountSignUpProfile(context.withCache(), {
        accountId,
        name: "Direct Finish User",
        reactionCharacter: {type: "Yeti", variant: "Blue"},
    });

    const accountItem = await getAccountItem(context.withCache(), accountId);

    expect(accountItem).toEqual(
        expect.objectContaining({
            name: "Direct Finish User",
            nameVersion: 1,
            reactionCharacter: {type: "Yeti", variant: "Blue"},
        }),
    );
    expect(accountItem.hasNotSignedUp).toBe(true);
});

test("saving sign up profile with non-existent account fails", async () => {
    await expect(
        saveAccountSignUpProfile(context.withCache(), {
            accountId: generateId(),
            name: "Should Fail",
            reactionCharacter: {type: "Cat", variant: "Grey"},
        }),
    ).rejects.toThrow();
});

test("cannot save sign up profile when account has joined space via invite even if hasNotSignedUp is true", async () => {
    const space = await TestSpace.create(context);
    const admin = await space.createSession({role: "Admin"});
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    await admin.inviteEmailAddress(emailAddress);

    const accountEmailAddressItem = await getAccountEmailAddressForTest(context, emailAddress);
    const accountId = accountEmailAddressItem.accountId;

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.unknownAnonymousAction(), emailAddress);
    });

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    const {sessionId} = await attemptOneTimePasswordSignIn(
        context,
        emailAddress,
        oneTimePassword,
        sessionInfo,
    );

    const sessionContext = context.action({sessionId, accountId});
    await acceptSpaceAccountInvite(sessionContext, space.id);

    const accountItemBeforeAttempt = await getAccountItem(context.withCache(), accountId);
    expect(accountItemBeforeAttempt.hasNotSignedUp).toBe(true);

    await expect(
        saveAccountSignUpProfile(context.withCache(), {
            accountId,
            name: "Should Fail",
            reactionCharacter: {type: "Cat", variant: "Grey"},
        }),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Can only finish account sign up when the account hasn\u2019t joined any spaces (the account may have pending invites)",
        ),
    );
});

test("race condition: accepting invite while saving sign up profile causes retry and error", async () => {
    const space = await TestSpace.create(context);
    const admin = await space.createSession({role: "Admin"});
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    await admin.inviteEmailAddress(emailAddress);

    const accountEmailAddressItem = await getAccountEmailAddressForTest(context, emailAddress);
    const accountId = accountEmailAddressItem.accountId;

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.unknownAnonymousAction(), emailAddress);
    });

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    const {sessionId} = await attemptOneTimePasswordSignIn(
        context,
        emailAddress,
        oneTimePassword,
        sessionInfo,
    );

    const pausePromise =
        saveAccountSignUpProfileBeforeExecuteTestCheckpoint.pauseForTest(accountId);

    const finishPromise = saveAccountSignUpProfile(context.withCache(), {
        accountId,
        name: "Race Condition User",
        reactionCharacter: {type: "Pigeon", variant: "Plain"},
    });

    const {unpause} = await pausePromise;

    const sessionContext = context.action({sessionId, accountId});
    await acceptSpaceAccountInvite(sessionContext, space.id);

    unpause();

    await expect(finishPromise).rejects.toThrow(PermissionDeniedError);
});
