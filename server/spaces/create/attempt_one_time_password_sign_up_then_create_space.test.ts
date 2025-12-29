import {attemptOneTimePasswordSignIn} from "~/server/accounts/attempt_one_time_password_sign_in.js";
import {captureOneTimePasswordSignInEmailsForTest} from "~/server/accounts/capture_one_time_password_sign_in_emails_for_test.js";
import {getAccountEmailAddressForTest} from "~/server/accounts/create_account_for_test.js";
// eslint-disable-next-line no-internal-imports
import {getAccountItem} from "~/server/accounts/internal/get_account_item.js";
import {regenerateOneTimePasswordSignIn} from "~/server/accounts/regenerate_one_time_password_sign_in.js";
import {saveAccountSignUpProfile} from "~/server/accounts/save_account_sign_up_profile.js";
import {signUpAccountWithEmailAddress} from "~/server/accounts/sign_up_account_with_email_address.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {validateEmailAddress} from "~/server/emails/email_address.js";
import {acceptSpaceAccountInvite} from "~/server/spaces/accept_space_account_invite.js";
import {attemptOneTimePasswordSignUpThenCreateSpace} from "~/server/spaces/create/attempt_one_time_password_sign_up_then_create_space.js";
import {getAccountSpaceIdsForTest} from "~/server/spaces/get_account_space_ids_for_test.js";
import {getSpaceAccountItemIfExists} from "~/server/spaces/internal/get_space_account_item.js";
import {getSpaceItemIfExists} from "~/server/spaces/internal/get_space_item.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {FailedPreconditionError, PermissionDeniedError} from "~/shared/error/error.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.js";
import {generateId} from "~/shared/id/id.js";

const context = createTestContext({
    spacesInjection,
    searchInjection: {
        dangerouslyFavoriteSearchEntityWithoutAuthorization: asyncNoop,
        dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization: asyncNoop,
    },
    tasksInjection: {
        internalGetUpdateOurAccountNameTaskTransactionEntries: () => [],
    },
});

const sessionInfo = {
    ipAddress: null,
    userAgent: null,
};

test("sign up with correct password creates personal space", async () => {
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.anonymousAction(), emailAddress);
    });

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId} = await getAccountEmailAddressForTest(context, emailAddress);

    await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        emailAddress,
        oneTimePassword,
        sessionInfo,
    );

    const spaceIds = await getAccountSpaceIdsForTest(context, accountId);

    expect(spaceIds.size).toEqual(1);
});

test("sign up creates space with correct name based on account", async () => {
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.anonymousAction(), emailAddress);
    });

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId} = await getAccountEmailAddressForTest(context, emailAddress);

    await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        emailAddress,
        oneTimePassword,
        sessionInfo,
    );

    const spaceIds = await getAccountSpaceIdsForTest(context, accountId);
    expect(spaceIds.size).toEqual(1);

    const spaceId = Array.from(spaceIds)[0]!;
    const spaceItem = await getSpaceItemIfExists(context.withCache(), spaceId);

    expect(spaceItem).toMatchObject({
        name: expect.stringContaining("\u2019s Space"),
    });
});

test("account becomes owner of created space", async () => {
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.anonymousAction(), emailAddress);
    });

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId} = await getAccountEmailAddressForTest(context, emailAddress);

    await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        emailAddress,
        oneTimePassword,
        sessionInfo,
    );

    const spaceIds = await getAccountSpaceIdsForTest(context, accountId);
    const spaceId = Array.from(spaceIds)[0]!;

    const spaceAccountItem = await getSpaceAccountItemIfExists(
        context.withCache(),
        spaceId,
        accountId,
    );

    expect(spaceAccountItem).toMatchObject({
        role: "Owner",
    });
});

test("incorrect password does not create space", async () => {
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.anonymousAction(), emailAddress);
    });

    const {accountId} = await getAccountEmailAddressForTest(context, emailAddress);

    await expect(
        attemptOneTimePasswordSignUpThenCreateSpace(
            context.anonymousAction(),
            emailAddress,
            "XXXXXX",
            sessionInfo,
        ),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    const spaceIds = await getAccountSpaceIdsForTest(context, accountId);

    expect(spaceIds.size).toEqual(0);
});

test("missing password does not create space", async () => {
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    await signUpAccountWithEmailAddress(context.anonymousAction(), emailAddress);

    const {accountId} = await getAccountEmailAddressForTest(context, emailAddress);

    await expect(
        attemptOneTimePasswordSignUpThenCreateSpace(
            context.anonymousAction(),
            emailAddress,
            "XXXXXX",
            sessionInfo,
        ),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    const spaceIds = await getAccountSpaceIdsForTest(context, accountId);

    expect(spaceIds.size).toEqual(0);
});

test("account saved sign up profile then finish signing up does create space", async () => {
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.anonymousAction(), emailAddress);
    });

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId} = await getAccountEmailAddressForTest(context, emailAddress);

    await saveAccountSignUpProfile(context.withCache(), {
        accountId,
        name: "Anthony Mose",
        reactionCharacter: {type: "Cat", variant: "Grey"},
    });

    await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        emailAddress,
        oneTimePassword,
        sessionInfo,
    );

    const spaceIds = await getAccountSpaceIdsForTest(context, accountId);

    expect(spaceIds.size).toEqual(1);
});

test("can’t use password twice to create multiple spaces", async () => {
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.anonymousAction(), emailAddress);
    });

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        emailAddress,
        oneTimePassword,
        sessionInfo,
    );

    await expect(
        attemptOneTimePasswordSignUpThenCreateSpace(
            context.anonymousAction(),
            emailAddress,
            oneTimePassword,
            sessionInfo,
        ),
    ).rejects.toThrow(new FailedPreconditionError("Missing one time password"));
});

test("locked account does not create space", async () => {
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.anonymousAction(), emailAddress);
    });

    const {accountId} = await getAccountEmailAddressForTest(context, emailAddress);

    await expect(
        attemptOneTimePasswordSignUpThenCreateSpace(
            context.anonymousAction(),
            emailAddress,
            "XXXXX1",
            sessionInfo,
        ),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignUpThenCreateSpace(
            context.anonymousAction(),
            emailAddress,
            "XXXXX2",
            sessionInfo,
        ),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignUpThenCreateSpace(
            context.anonymousAction(),
            emailAddress,
            "XXXXX3",
            sessionInfo,
        ),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignUpThenCreateSpace(
            context.anonymousAction(),
            emailAddress,
            "XXXXX4",
            sessionInfo,
        ),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignUpThenCreateSpace(
            context.anonymousAction(),
            emailAddress,
            "XXXXX5",
            sessionInfo,
        ),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignUpThenCreateSpace(
            context.anonymousAction(),
            emailAddress,
            "XXXXX6",
            sessionInfo,
        ),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));

    const spaceIds = await getAccountSpaceIdsForTest(context, accountId);

    expect(spaceIds.size).toEqual(0);
});

test("space name is truncated when account name is too long", async () => {
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.anonymousAction(), emailAddress);
    });

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId} = await getAccountEmailAddressForTest(context, emailAddress);

    const longName = "a".repeat(50);

    await saveAccountSignUpProfile(context.withCache(), {
        accountId,
        name: longName,
        reactionCharacter: {type: "Cat", variant: "Grey"},
    });

    await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        emailAddress,
        oneTimePassword,
        sessionInfo,
    );

    const spaceIds = await getAccountSpaceIdsForTest(context, accountId);
    const spaceId = Array.from(spaceIds)[0]!;

    const spaceItem = await getSpaceItemIfExists(context.withCache(), spaceId);

    expect(spaceItem).toMatchObject({
        name: `${"a".repeat(42)}\u2019s Space`,
    });
});

test("sign up with existing session creates space only once", async () => {
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.anonymousAction(), emailAddress);
    });

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId} = await getAccountEmailAddressForTest(context, emailAddress);

    expect((await getAccountSpaceIdsForTest(context, accountId)).size).toEqual(0);

    await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        emailAddress,
        oneTimePassword,
        sessionInfo,
    );

    expect((await getAccountSpaceIdsForTest(context, accountId)).size).toEqual(1);

    const oneTimePasswordEmails2 = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(context.anonymousAction(), emailAddress);
    });

    const newOneTimePassword = oneTimePasswordEmails2[0]!.oneTimePassword;

    await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        emailAddress,
        newOneTimePassword,
        sessionInfo,
    );

    expect((await getAccountSpaceIdsForTest(context, accountId)).size).toEqual(1);
});

test("expired password does not create space", async () => {
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.anonymousAction(), emailAddress);
    });

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId} = await getAccountEmailAddressForTest(context, emailAddress);

    await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(context.anonymousAction(), emailAddress);
    });

    await expect(
        attemptOneTimePasswordSignUpThenCreateSpace(
            context.anonymousAction(),
            emailAddress,
            oneTimePassword,
            sessionInfo,
        ),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    const spaceIds = await getAccountSpaceIdsForTest(context, accountId);

    expect(spaceIds.size).toEqual(0);
});

test("sign in then save sign up profile then finish signing up does create space", async () => {
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.anonymousAction(), emailAddress);
    });

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId} = await getAccountEmailAddressForTest(context, emailAddress);

    await attemptOneTimePasswordSignIn(context, emailAddress, oneTimePassword, sessionInfo);

    await saveAccountSignUpProfile(context.withCache(), {
        accountId,
        name: "Test User",
        reactionCharacter: {type: "Cat", variant: "Grey"},
    });

    const oneTimePasswordEmails2 = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(context.anonymousAction(), emailAddress);
    });

    const newOneTimePassword = oneTimePasswordEmails2[0]!.oneTimePassword;

    await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        emailAddress,
        newOneTimePassword,
        sessionInfo,
    );

    const spaceIds = await getAccountSpaceIdsForTest(context, accountId);

    expect(spaceIds.size).toEqual(1);
});

describe("saveAccountSignUpProfile", () => {
    test("cannot save sign up profile after finishing sign up", async () => {
        const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

        const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
            await signUpAccountWithEmailAddress(context.unknownAnonymousAction(), emailAddress);
        });

        const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

        const accountEmailAddressItem = await getAccountEmailAddressForTest(context, emailAddress);
        const accountId = accountEmailAddressItem.accountId;

        await saveAccountSignUpProfile(context.withCache(), {
            accountId,
            name: "First Finish",
            reactionCharacter: {type: "Cat", variant: "Grey"},
        });

        await saveAccountSignUpProfile(context.withCache(), {
            accountId,
            name: "Second Finish",
            reactionCharacter: {type: "Cat", variant: "Yellow"},
        });

        await attemptOneTimePasswordSignUpThenCreateSpace(
            context.anonymousAction(),
            emailAddress,
            oneTimePassword,
            sessionInfo,
        );

        await expect(
            saveAccountSignUpProfile(context.withCache(), {
                accountId,
                name: "Third Finish",
                reactionCharacter: {type: "Cat", variant: "Pink"},
            }),
        ).rejects.toThrow(new FailedPreconditionError("Account has already finished signing up"));
    });

    test("save account sign up profile then sign in", async () => {
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

        const {sessionId} = await attemptOneTimePasswordSignUpThenCreateSpace(
            context.anonymousAction(),
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

    test("save account sign up profile with pending invite then accept invite", async () => {
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

        const {sessionId} = await attemptOneTimePasswordSignUpThenCreateSpace(
            context.anonymousAction(),
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
});

describe("signUpAccountWithEmailAddress", () => {
    test("attempting to sign up after finishing sign up fails", async () => {
        const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

        const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
            await signUpAccountWithEmailAddress(context.unknownAnonymousAction(), emailAddress);
        });

        const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

        const accountEmailAddressItem = await getAccountEmailAddressForTest(context, emailAddress);

        await saveAccountSignUpProfile(context.withCache(), {
            accountId: accountEmailAddressItem.accountId,
            name: "Test User",
            reactionCharacter: {type: "Cat", variant: "Grey"},
        });

        await attemptOneTimePasswordSignUpThenCreateSpace(
            context.anonymousAction(),
            emailAddress,
            oneTimePassword,
            sessionInfo,
        );

        await expect(
            signUpAccountWithEmailAddress(context.unknownAnonymousAction(), emailAddress),
        ).rejects.toThrow(new FailedPreconditionError("Email address has already signed up"));
    });
});
