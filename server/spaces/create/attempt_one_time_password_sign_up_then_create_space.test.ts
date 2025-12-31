import {attemptOneTimePasswordSignIn} from "~/server/accounts/attempt_one_time_password_sign_in.js";
import {captureOneTimePasswordSignInEmailsForTest} from "~/server/accounts/capture_one_time_password_sign_in_emails_for_test.js";
import {getAccountEmailAddressForTest} from "~/server/accounts/create_account_for_test.js";
import {dangerouslyGetAccountAndWithFinishSignUpTransactionEntryIfExistsWithoutAuthorization} from "~/server/accounts/dangerously_get_account_if_exists_without_authorization.js";
import {regenerateOneTimePasswordSignIn} from "~/server/accounts/regenerate_one_time_password_sign_in.js";
import {saveAccountSignUpProfile} from "~/server/accounts/save_account_sign_up_profile.js";
import {signUpAccountWithEmailAddress} from "~/server/accounts/sign_up_account_with_email_address.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {validateEmailAddress} from "~/server/emails/email_address.js";
import {expensivelyGetChannelsInSpaceForTest} from "~/server/forum/data/expensively_get_channels_in_space_for_test.js";
import {forumInjection} from "~/server/forum/data/forum_injection.js";
import {searchInjection} from "~/server/search/data/index/search_injection.js";
import {acceptSpaceAccountInvite} from "~/server/spaces/accept_space_account_invite.js";
import {attemptOneTimePasswordSignUpThenCreateSpace} from "~/server/spaces/create/attempt_one_time_password_sign_up_then_create_space.js";
import {getAccountSpaceIdsForTest} from "~/server/spaces/get_account_space_ids_for_test.js";
import {getSpaceAccountItem} from "~/server/spaces/internal/get_space_account_item.js";
import {getSpaceItem, getSpaceItemIfExists} from "~/server/spaces/internal/get_space_item.js";
import {SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {inviteEmailAddressesToSpace} from "~/server/spaces/invite_email_addresses_to_space.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {FailedPreconditionError, PermissionDeniedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";

const dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization = import.meta.jest.fn(
    searchInjection.dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization.bind(null),
);

const context = createTestContext({
    forumInjection,
    spacesInjection,
    searchInjection: {
        ...searchInjection,
        dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization,
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
    const emailAddress = validateEmailAddress(`test.${generateId()}@gmail.com`);

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
    const emailAddress = validateEmailAddress(`test.${generateId()}@gmail.com`);

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

    const spaceAccountItem = await getSpaceAccountItem(context.withCache(), spaceId, accountId);

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
    const emailAddress = validateEmailAddress(`test.${generateId()}@gmail.com`);

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
    const emailAddress = validateEmailAddress(`test.${generateId()}@gmail.com`);

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
    const emailAddress = validateEmailAddress(`test.${generateId()}@gmail.com`);

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

test("first user with company email creates personal space and company space", async () => {
    const emailDomain = `company-${generateId()}.com`;
    const emailAddress = validateEmailAddress(`john@${emailDomain}`);

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.anonymousAction(), emailAddress);
    });

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId} = await getAccountEmailAddressForTest(context, emailAddress);

    await saveAccountSignUpProfile(context.withCache(), {
        accountId,
        name: "John Smith",
        reactionCharacter: {type: "Cat", variant: "Grey"},
    });

    await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        emailAddress,
        oneTimePassword,
        sessionInfo,
    );

    const spaceIds = await getAccountSpaceIdsForTest(context, accountId);

    expect(spaceIds.size).toEqual(2);
});

test("first user with company email becomes owner of both spaces", async () => {
    const emailDomain = `company-${generateId()}.com`;
    const emailAddress = validateEmailAddress(`john@${emailDomain}`);

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.anonymousAction(), emailAddress);
    });

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId} = await getAccountEmailAddressForTest(context, emailAddress);

    await saveAccountSignUpProfile(context.withCache(), {
        accountId,
        name: "John Smith",
        reactionCharacter: {type: "Cat", variant: "Grey"},
    });

    await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        emailAddress,
        oneTimePassword,
        sessionInfo,
    );

    const spaceIds = await getAccountSpaceIdsForTest(context, accountId);
    const spaceIdArray = Array.from(spaceIds);

    for (const spaceId of spaceIdArray) {
        const spaceAccountItem = await getSpaceAccountItem(context.withCache(), spaceId, accountId);

        expect(spaceAccountItem).toMatchObject({
            role: "Owner",
        });
    }
});

test("first user company space is named with @ prefix", async () => {
    const emailDomain = `company-${generateId()}.com`;
    const emailAddress = validateEmailAddress(`john@${emailDomain}`);

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.anonymousAction(), emailAddress);
    });

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId} = await getAccountEmailAddressForTest(context, emailAddress);

    await saveAccountSignUpProfile(context.withCache(), {
        accountId,
        name: "John Smith",
        reactionCharacter: {type: "Cat", variant: "Grey"},
    });

    const {openSpaceId} = await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        emailAddress,
        oneTimePassword,
        sessionInfo,
    );

    const companySpaceItem = await getSpaceItemIfExists(context.withCache(), openSpaceId!);

    expect(companySpaceItem).toMatchObject({
        name: `@${emailDomain}`,
    });
});

test("first user opens company space by default", async () => {
    const emailDomain = `company-${generateId()}.com`;
    const emailAddress = validateEmailAddress(`john@${emailDomain}`);

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.anonymousAction(), emailAddress);
    });

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId} = await getAccountEmailAddressForTest(context, emailAddress);

    await saveAccountSignUpProfile(context.withCache(), {
        accountId,
        name: "John Smith",
        reactionCharacter: {type: "Cat", variant: "Grey"},
    });

    const {openSpaceId} = await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        emailAddress,
        oneTimePassword,
        sessionInfo,
    );

    const companySpaceItem = await getSpaceItem(context.withCache(), openSpaceId!);

    expect(companySpaceItem.name).toEqual(`@${emailDomain}`);
});

test("second user with same email domain is auto-added to company space as member", async () => {
    const emailDomain = `company-${generateId()}.com`;
    const firstEmailAddress = validateEmailAddress(`john@${emailDomain}`);

    const firstOneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.anonymousAction(), firstEmailAddress);
    });

    const firstOneTimePassword = firstOneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId: firstAccountId} = await getAccountEmailAddressForTest(
        context,
        firstEmailAddress,
    );

    await saveAccountSignUpProfile(context.withCache(), {
        accountId: firstAccountId,
        name: "John Smith",
        reactionCharacter: {type: "Cat", variant: "Grey"},
    });

    const {openSpaceId: companySpaceId} = await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        firstEmailAddress,
        firstOneTimePassword,
        sessionInfo,
    );

    assert(companySpaceId);

    const secondEmailAddress = validateEmailAddress(`sarah@${emailDomain}`);

    const secondOneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(
        async () => {
            await signUpAccountWithEmailAddress(context.anonymousAction(), secondEmailAddress);
        },
    );

    const secondOneTimePassword = secondOneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId: secondAccountId} = await getAccountEmailAddressForTest(
        context,
        secondEmailAddress,
    );

    await saveAccountSignUpProfile(context.withCache(), {
        accountId: secondAccountId,
        name: "Sarah Johnson",
        reactionCharacter: {type: "Pigeon", variant: "Brown"},
    });

    await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        secondEmailAddress,
        secondOneTimePassword,
        sessionInfo,
    );

    const secondUserSpaceIds = await getAccountSpaceIdsForTest(context, secondAccountId);

    expect(secondUserSpaceIds.has(companySpaceId)).toEqual(true);

    const spaceAccountItem = await getSpaceAccountItem(
        context.withCache(),
        companySpaceId,
        secondAccountId,
    );

    expect(spaceAccountItem).toMatchObject({
        role: "Member",
    });
});

test("second user also creates personal space", async () => {
    const emailDomain = `company-${generateId()}.com`;
    const firstEmailAddress = validateEmailAddress(`john@${emailDomain}`);

    const firstOneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.anonymousAction(), firstEmailAddress);
    });

    const firstOneTimePassword = firstOneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId: firstAccountId} = await getAccountEmailAddressForTest(
        context,
        firstEmailAddress,
    );

    await saveAccountSignUpProfile(context.withCache(), {
        accountId: firstAccountId,
        name: "John Smith",
        reactionCharacter: {type: "Cat", variant: "Grey"},
    });

    const {openSpaceId: companySpaceId} = await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        firstEmailAddress,
        firstOneTimePassword,
        sessionInfo,
    );

    assert(companySpaceId);

    const secondEmailAddress = validateEmailAddress(`sarah@${emailDomain}`);

    const secondOneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(
        async () => {
            await signUpAccountWithEmailAddress(context.anonymousAction(), secondEmailAddress);
        },
    );

    const secondOneTimePassword = secondOneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId: secondAccountId} = await getAccountEmailAddressForTest(
        context,
        secondEmailAddress,
    );

    await saveAccountSignUpProfile(context.withCache(), {
        accountId: secondAccountId,
        name: "Sarah Johnson",
        reactionCharacter: {type: "Pigeon", variant: "Brown"},
    });

    await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        secondEmailAddress,
        secondOneTimePassword,
        sessionInfo,
    );

    const secondUserSpaceIds = await getAccountSpaceIdsForTest(context, secondAccountId);

    expect(secondUserSpaceIds.size).toEqual(2);

    const personalSpaceId = assertExists(
        Array.from(secondUserSpaceIds).find(spaceId => spaceId !== companySpaceId),
    );

    const personalSpaceItem = await getSpaceItem(context.withCache(), personalSpaceId);

    expect(personalSpaceItem).toMatchObject({
        name: "Sarah’s Space",
    });
});

test("second user is active in company space without invite", async () => {
    const emailDomain = `company-${generateId()}.com`;
    const firstEmailAddress = validateEmailAddress(`john@${emailDomain}`);

    const firstOneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.anonymousAction(), firstEmailAddress);
    });

    const firstOneTimePassword = firstOneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId: firstAccountId} = await getAccountEmailAddressForTest(
        context,
        firstEmailAddress,
    );

    await saveAccountSignUpProfile(context.withCache(), {
        accountId: firstAccountId,
        name: "John Smith",
        reactionCharacter: {type: "Cat", variant: "Grey"},
    });

    const {openSpaceId: companySpaceId} = await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        firstEmailAddress,
        firstOneTimePassword,
        sessionInfo,
    );

    assert(companySpaceId);

    const secondEmailAddress = validateEmailAddress(`sarah@${emailDomain}`);

    const secondOneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(
        async () => {
            await signUpAccountWithEmailAddress(context.anonymousAction(), secondEmailAddress);
        },
    );

    const secondOneTimePassword = secondOneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId: secondAccountId} = await getAccountEmailAddressForTest(
        context,
        secondEmailAddress,
    );

    await saveAccountSignUpProfile(context.withCache(), {
        accountId: secondAccountId,
        name: "Sarah Johnson",
        reactionCharacter: {type: "Pigeon", variant: "Brown"},
    });

    await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        secondEmailAddress,
        secondOneTimePassword,
        sessionInfo,
    );

    const spaceAccountItem = await getSpaceAccountItem(
        context.withCache(),
        companySpaceId,
        secondAccountId,
    );

    expect(spaceAccountItem.state).toMatchObject({
        type: "Active",
    });
});

test("second user opens company space by default", async () => {
    const emailDomain = `company-${generateId()}.com`;
    const firstEmailAddress = validateEmailAddress(`john@${emailDomain}`);

    const firstOneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.anonymousAction(), firstEmailAddress);
    });

    const firstOneTimePassword = firstOneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId: firstAccountId} = await getAccountEmailAddressForTest(
        context,
        firstEmailAddress,
    );

    await saveAccountSignUpProfile(context.withCache(), {
        accountId: firstAccountId,
        name: "John Smith",
        reactionCharacter: {type: "Cat", variant: "Grey"},
    });

    const {openSpaceId: companySpaceId} = await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        firstEmailAddress,
        firstOneTimePassword,
        sessionInfo,
    );

    const secondEmailAddress = validateEmailAddress(`sarah@${emailDomain}`);

    const secondOneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(
        async () => {
            await signUpAccountWithEmailAddress(context.anonymousAction(), secondEmailAddress);
        },
    );

    const secondOneTimePassword = secondOneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId: secondAccountId} = await getAccountEmailAddressForTest(
        context,
        secondEmailAddress,
    );

    await saveAccountSignUpProfile(context.withCache(), {
        accountId: secondAccountId,
        name: "Sarah Johnson",
        reactionCharacter: {type: "Pigeon", variant: "Brown"},
    });

    const {openSpaceId: secondUserOpenSpaceId} = await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        secondEmailAddress,
        secondOneTimePassword,
        sessionInfo,
    );

    expect(secondUserOpenSpaceId).toEqual(companySpaceId);
});

test("third user also gets auto-added to company space", async () => {
    const emailDomain = `company-${generateId()}.com`;

    const firstEmailAddress = validateEmailAddress(`john@${emailDomain}`);
    const firstOneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.anonymousAction(), firstEmailAddress);
    });
    const {accountId: firstAccountId} = await getAccountEmailAddressForTest(
        context,
        firstEmailAddress,
    );
    await saveAccountSignUpProfile(context.withCache(), {
        accountId: firstAccountId,
        name: "John Smith",
        reactionCharacter: {type: "Cat", variant: "Grey"},
    });
    const {openSpaceId: companySpaceId} = await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        firstEmailAddress,
        firstOneTimePasswordEmails[0]!.oneTimePassword,
        sessionInfo,
    );

    assert(companySpaceId);

    const secondEmailAddress = validateEmailAddress(`sarah@${emailDomain}`);
    const secondOneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(
        async () => {
            await signUpAccountWithEmailAddress(context.anonymousAction(), secondEmailAddress);
        },
    );
    const {accountId: secondAccountId} = await getAccountEmailAddressForTest(
        context,
        secondEmailAddress,
    );
    await saveAccountSignUpProfile(context.withCache(), {
        accountId: secondAccountId,
        name: "Sarah Johnson",
        reactionCharacter: {type: "Pigeon", variant: "Brown"},
    });
    await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        secondEmailAddress,
        secondOneTimePasswordEmails[0]!.oneTimePassword,
        sessionInfo,
    );

    const thirdEmailAddress = validateEmailAddress(`mike@${emailDomain}`);
    const thirdOneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.anonymousAction(), thirdEmailAddress);
    });
    const {accountId: thirdAccountId} = await getAccountEmailAddressForTest(
        context,
        thirdEmailAddress,
    );
    await saveAccountSignUpProfile(context.withCache(), {
        accountId: thirdAccountId,
        name: "Mike Davis",
        reactionCharacter: {type: "Yeti", variant: "Brown"},
    });
    const {openSpaceId: thirdUserOpenSpaceId} = await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        thirdEmailAddress,
        thirdOneTimePasswordEmails[0]!.oneTimePassword,
        sessionInfo,
    );

    expect(thirdUserOpenSpaceId).toEqual(companySpaceId);

    const spaceAccountItem = await getSpaceAccountItem(
        context.withCache(),
        companySpaceId,
        thirdAccountId,
    );

    expect(spaceAccountItem).toMatchObject({
        role: "Member",
    });
});

test("when auto-add is disabled user creates only personal space", async () => {
    const emailDomain = `company-${generateId()}.com`;
    const firstEmailAddress = validateEmailAddress(`john@${emailDomain}`);

    const firstOneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.anonymousAction(), firstEmailAddress);
    });

    const firstOneTimePassword = firstOneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId: firstAccountId} = await getAccountEmailAddressForTest(
        context,
        firstEmailAddress,
    );

    await saveAccountSignUpProfile(context.withCache(), {
        accountId: firstAccountId,
        name: "John Smith",
        reactionCharacter: {type: "Cat", variant: "Grey"},
    });

    const {openSpaceId: companySpaceId} = await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        firstEmailAddress,
        firstOneTimePassword,
        sessionInfo,
    );

    assert(companySpaceId);

    await SpacesTable.updateItem(
        context.anonymousAction(),
        {
            partitionType: "AutoAddAccountsFromEmailDomain",
            sortRangeType: "Space",
            emailDomain,
        },
        item => {
            assert(item);
            return {...item, isEnabled: false};
        },
    );

    const secondEmailAddress = validateEmailAddress(`sarah@${emailDomain}`);

    const secondOneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(
        async () => {
            await signUpAccountWithEmailAddress(context.anonymousAction(), secondEmailAddress);
        },
    );

    const secondOneTimePassword = secondOneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId: secondAccountId} = await getAccountEmailAddressForTest(
        context,
        secondEmailAddress,
    );

    await saveAccountSignUpProfile(context.withCache(), {
        accountId: secondAccountId,
        name: "Sarah Johnson",
        reactionCharacter: {type: "Pigeon", variant: "Brown"},
    });

    await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        secondEmailAddress,
        secondOneTimePassword,
        sessionInfo,
    );

    const secondUserSpaceIds = await getAccountSpaceIdsForTest(context, secondAccountId);

    expect(secondUserSpaceIds.size).toEqual(1);
    expect(secondUserSpaceIds.has(companySpaceId)).toEqual(false);
});

test("when role is member user gets added as member", async () => {
    const emailDomain = `company-${generateId()}.com`;
    const firstEmailAddress = validateEmailAddress(`john@${emailDomain}`);

    const firstOneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.anonymousAction(), firstEmailAddress);
    });

    const firstOneTimePassword = firstOneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId: firstAccountId} = await getAccountEmailAddressForTest(
        context,
        firstEmailAddress,
    );

    await saveAccountSignUpProfile(context.withCache(), {
        accountId: firstAccountId,
        name: "John Smith",
        reactionCharacter: {type: "Cat", variant: "Grey"},
    });

    const {openSpaceId: companySpaceId} = await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        firstEmailAddress,
        firstOneTimePassword,
        sessionInfo,
    );

    assert(companySpaceId);

    await SpacesTable.updateItem(
        context.anonymousAction(),
        {
            partitionType: "AutoAddAccountsFromEmailDomain",
            sortRangeType: "Space",
            emailDomain,
        },
        item => {
            assert(item);
            return {...item, role: "Member"};
        },
    );

    const secondEmailAddress = validateEmailAddress(`sarah@${emailDomain}`);

    const secondOneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(
        async () => {
            await signUpAccountWithEmailAddress(context.anonymousAction(), secondEmailAddress);
        },
    );

    const secondOneTimePassword = secondOneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId: secondAccountId} = await getAccountEmailAddressForTest(
        context,
        secondEmailAddress,
    );

    await saveAccountSignUpProfile(context.withCache(), {
        accountId: secondAccountId,
        name: "Sarah Johnson",
        reactionCharacter: {type: "Pigeon", variant: "Brown"},
    });

    await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        secondEmailAddress,
        secondOneTimePassword,
        sessionInfo,
    );

    const spaceAccountItem = await getSpaceAccountItem(
        context.withCache(),
        companySpaceId,
        secondAccountId,
    );

    expect(spaceAccountItem).toMatchObject({
        role: "Member",
    });
});

test("generic email domain does not trigger auto-add", async () => {
    const emailAddress = validateEmailAddress(`test.${generateId()}@gmail.com`);

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.anonymousAction(), emailAddress);
    });

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId} = await getAccountEmailAddressForTest(context, emailAddress);

    await saveAccountSignUpProfile(context.withCache(), {
        accountId,
        name: "John Smith",
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

test("email domain extraction is case insensitive", async () => {
    const emailDomain = `company-${generateId()}.com`;
    const firstEmailAddress = validateEmailAddress(`john@${emailDomain.toUpperCase()}`);

    const firstOneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.anonymousAction(), firstEmailAddress);
    });

    const firstOneTimePassword = firstOneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId: firstAccountId} = await getAccountEmailAddressForTest(
        context,
        firstEmailAddress,
    );

    await saveAccountSignUpProfile(context.withCache(), {
        accountId: firstAccountId,
        name: "John Smith",
        reactionCharacter: {type: "Cat", variant: "Grey"},
    });

    const {openSpaceId: companySpaceId} = await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        firstEmailAddress,
        firstOneTimePassword,
        sessionInfo,
    );

    const secondEmailAddress = validateEmailAddress(`sarah@${emailDomain.toLowerCase()}`);

    const secondOneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(
        async () => {
            await signUpAccountWithEmailAddress(context.anonymousAction(), secondEmailAddress);
        },
    );

    const secondOneTimePassword = secondOneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId: secondAccountId} = await getAccountEmailAddressForTest(
        context,
        secondEmailAddress,
    );

    await saveAccountSignUpProfile(context.withCache(), {
        accountId: secondAccountId,
        name: "Sarah Johnson",
        reactionCharacter: {type: "Pigeon", variant: "Brown"},
    });

    const {openSpaceId: secondUserOpenSpaceId} = await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        secondEmailAddress,
        secondOneTimePassword,
        sessionInfo,
    );

    expect(secondUserOpenSpaceId).toEqual(companySpaceId);
});

test("second user with company email gets welcome package affinity points for company space", async () => {
    const emailDomain = `company-${generateId()}.com`;
    const firstEmailAddress = validateEmailAddress(`john@${emailDomain}`);

    const firstOneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.anonymousAction(), firstEmailAddress);
    });

    const firstOneTimePassword = firstOneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId: firstAccountId} = await getAccountEmailAddressForTest(
        context,
        firstEmailAddress,
    );

    await saveAccountSignUpProfile(context.withCache(), {
        accountId: firstAccountId,
        name: "John Smith",
        reactionCharacter: {type: "Cat", variant: "Grey"},
    });

    const {openSpaceId: companySpaceId} = await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        firstEmailAddress,
        firstOneTimePassword,
        sessionInfo,
    );

    assert(companySpaceId);

    const secondEmailAddress = validateEmailAddress(`sarah@${emailDomain}`);

    const secondOneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(
        async () => {
            await signUpAccountWithEmailAddress(context.anonymousAction(), secondEmailAddress);
        },
    );

    const secondOneTimePassword = secondOneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId: secondAccountId} = await getAccountEmailAddressForTest(
        context,
        secondEmailAddress,
    );

    await saveAccountSignUpProfile(context.withCache(), {
        accountId: secondAccountId,
        name: "Sarah Johnson",
        reactionCharacter: {type: "Pigeon", variant: "Brown"},
    });

    await attemptOneTimePasswordSignUpThenCreateSpace(
        context.anonymousAction(),
        secondEmailAddress,
        secondOneTimePassword,
        sessionInfo,
    );

    const companySpaceChannels = await expensivelyGetChannelsInSpaceForTest(
        context,
        companySpaceId,
    );
    const companySpaceGeneralChannel = companySpaceChannels.find(
        channel => channel.name === "General",
    );

    expect(
        dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization.mock.calls.find(
            call => call[1].accountId === secondAccountId && call[1].spaceId === companySpaceId,
        )?.[1],
    ).toMatchObject({
        entityId: `Channel:${companySpaceGeneralChannel!.id}`,
    });
});

// Some `saveAccountSignUpProfile()` tests are in this file so we can use code
// from `//server/spaces/create`.
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

        const accountAfterSignIn = assertExists(
            await dangerouslyGetAccountAndWithFinishSignUpTransactionEntryIfExistsWithoutAuthorization(
                context.withCache(),
                accountId,
            ),
        );

        expect(sessionId).toEqual(expect.any(String));
        expect(accountAfterSignIn.account.initialData).toMatchObject({
            name: "Complete User",
            reactionCharacter: {type: "Frog", variant: "Green"},
        });
        expect(accountAfterSignIn.finishSignUpTransactionEntry).toBeNull();
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

        const accountAfterJoin = assertExists(
            await dangerouslyGetAccountAndWithFinishSignUpTransactionEntryIfExistsWithoutAuthorization(
                context.withCache(),
                accountId,
            ),
        );

        expect(accountAfterJoin.account.initialData).toMatchObject({
            name: "Invited Complete User",
            reactionCharacter: {type: "Tree", variant: "Green"},
        });
        expect(accountAfterJoin.finishSignUpTransactionEntry).toBeNull();
    });
});

// Some `signUpAccountWithEmailAddress()` tests are in this file so we can use code
// from `//server/spaces/create`.
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

// Some `acceptSpaceAccountInvite()` tests are in this file so we can use code
// from `//server/spaces/create`.
describe("acceptSpaceAccountInvite", () => {
    test("accepting space invite applies welcome package affinity points when welcome package exists", async () => {
        const emailDomain = `company-${generateId()}.com`;
        const firstEmailAddress = validateEmailAddress(`john@${emailDomain}`);

        const firstOneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(
            async () => {
                await signUpAccountWithEmailAddress(context.anonymousAction(), firstEmailAddress);
            },
        );

        const firstOneTimePassword = firstOneTimePasswordEmails[0]!.oneTimePassword;

        const {accountId: firstAccountId} = await getAccountEmailAddressForTest(
            context,
            firstEmailAddress,
        );

        await saveAccountSignUpProfile(context.withCache(), {
            accountId: firstAccountId,
            name: "John Smith",
            reactionCharacter: {type: "Cat", variant: "Grey"},
        });

        const {sessionId: firstSessionId, openSpaceId: companySpaceId} =
            await attemptOneTimePasswordSignUpThenCreateSpace(
                context.anonymousAction(),
                firstEmailAddress,
                firstOneTimePassword,
                sessionInfo,
            );

        assert(companySpaceId);

        const companySpaceChannels = await expensivelyGetChannelsInSpaceForTest(
            context,
            companySpaceId,
        );
        const companySpaceGeneralChannel = assertExists(
            companySpaceChannels.find(channel => channel.name === "General"),
        );

        dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization.mockClear();

        const secondAccount = await TestAccount.create(context);
        const secondSession = await TestSession.create(secondAccount);
        const secondEmailAddress = await secondAccount.createEmailAddress();

        expect(dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization.mock.calls.length).toBe(
            0,
        );

        await inviteEmailAddressesToSpace(
            context.action({sessionId: firstSessionId, accountId: firstAccountId}),
            {
                spaceId: companySpaceId,
                emailAddresses: [secondEmailAddress],
            },
        );

        expect(dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization.mock.calls.length).toBe(
            0,
        );

        await acceptSpaceAccountInvite(secondSession.action(), companySpaceId);

        expect(
            dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization.mock.calls[0]?.[1],
        ).toMatchObject({
            spaceId: companySpaceId,
            accountId: secondAccount.id,
            entityId: `Channel:${companySpaceGeneralChannel.id}`,
        });
    });
});
