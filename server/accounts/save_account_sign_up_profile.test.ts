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
import {validateEmailAddress} from "~/server/emails/email_address.js";
import {acceptSpaceAccountInvite} from "~/server/spaces/accept_space_account_invite.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {FailedPreconditionError, PermissionDeniedError} from "~/shared/error/error.js";
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

test("finishing sign up for a fresh account updates account", async () => {
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
    expect(accountItemAfterFinish.hasNotSignedUp).toBeUndefined();
});

test("finishing sign up for an account with a pending invite", async () => {
    const space = await TestSpace.create(context);
    const admin = await space.createSession({role: "Admin"});
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    await space.inviteEmailAddress(admin.action(), emailAddress);

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
    expect(accountItemAfterFinish.hasNotSignedUp).toBeUndefined();
});

test("cannot finish sign up twice", async () => {
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    await signUpAccountWithEmailAddress(context.unknownAnonymousAction(), emailAddress);

    const accountEmailAddressItem = await getAccountEmailAddressForTest(context, emailAddress);
    const accountId = accountEmailAddressItem.accountId;

    await saveAccountSignUpProfile(context.withCache(), {
        accountId,
        name: "First Finish",
        reactionCharacter: {type: "Cat", variant: "Grey"},
    });

    await expect(
        saveAccountSignUpProfile(context.withCache(), {
            accountId,
            name: "Second Finish",
            reactionCharacter: {type: "Cat", variant: "Pink"},
        }),
    ).rejects.toThrow(new FailedPreconditionError("Account has already finished signing up"));
});

test("cannot finish sign up after joining a space", async () => {
    const space = await TestSpace.create(context);
    const admin = await space.createSession({role: "Admin"});
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    await space.inviteEmailAddress(admin.action(), emailAddress);

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
            "Can only finish account sign up when the account hasn’t joined any spaces (the account may have pending invites)",
        ),
    );
});

test("finish account sign up then sign in", async () => {
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.unknownAnonymousAction(), emailAddress);
    });

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    const accountEmailAddressItem = await getAccountEmailAddressForTest(context, emailAddress);
    const accountId = accountEmailAddressItem.accountId;

    await saveAccountSignUpProfile(context.withCache(), {
        accountId,
        name: "Complete User",
        reactionCharacter: {type: "Frog", variant: "Green"},
    });

    const {sessionId} = await attemptOneTimePasswordSignIn(
        context,
        emailAddress,
        oneTimePassword,
        sessionInfo,
    );

    const accountItemAfterSignIn = await getAccountItem(context.withCache(), accountId);

    expect(sessionId).toEqual(expect.any(String));
    expect(accountItemAfterSignIn).toMatchObject({
        name: "Complete User",
        reactionCharacter: {type: "Frog", variant: "Green"},
    });
    expect(accountItemAfterSignIn.hasNotSignedUp).toBeUndefined();
});

test("finish account sign up with pending invite then accept invite", async () => {
    const space = await TestSpace.create(context);
    const admin = await space.createSession({role: "Admin"});
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    await space.inviteEmailAddress(admin.action(), emailAddress);

    const accountEmailAddressItem = await getAccountEmailAddressForTest(context, emailAddress);
    const accountId = accountEmailAddressItem.accountId;

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.unknownAnonymousAction(), emailAddress);
    });

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    await saveAccountSignUpProfile(context.withCache(), {
        accountId,
        name: "Invited Complete User",
        reactionCharacter: {type: "Tree", variant: "Green"},
    });

    const {sessionId} = await attemptOneTimePasswordSignIn(
        context,
        emailAddress,
        oneTimePassword,
        sessionInfo,
    );

    const sessionContext = context.action({sessionId, accountId});

    await acceptSpaceAccountInvite(sessionContext, space.id);

    const accountItemAfterJoin = await getAccountItem(context.withCache(), accountId);

    expect(accountItemAfterJoin).toMatchObject({
        name: "Invited Complete User",
        reactionCharacter: {type: "Tree", variant: "Green"},
    });
    expect(accountItemAfterJoin.hasNotSignedUp).toBeUndefined();
});

test("name version increments when finishing sign up", async () => {
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

test("invited account can finish sign up without calling signUpAccountWithEmailAddress first", async () => {
    const space = await TestSpace.create(context);
    const admin = await space.createSession({role: "Admin"});
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    await space.inviteEmailAddress(admin.action(), emailAddress);

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
    expect(accountItem.hasNotSignedUp).toBeUndefined();
});

test("finishing sign up with non-existent account fails", async () => {
    await expect(
        saveAccountSignUpProfile(context.withCache(), {
            accountId: generateId(),
            name: "Should Fail",
            reactionCharacter: {type: "Cat", variant: "Grey"},
        }),
    ).rejects.toThrow();
});

test("race condition: accepting invite while finishing sign up causes retry and error", async () => {
    const space = await TestSpace.create(context);
    const admin = await space.createSession({role: "Admin"});
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    await space.inviteEmailAddress(admin.action(), emailAddress);

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
