import {attemptOneTimePasswordSignIn} from "~/server/accounts/attempt_one_time_password_sign_in.js";
import {captureOneTimePasswordSignInEmailsForTest} from "~/server/accounts/capture_one_time_password_sign_in_emails_for_test.js";
import {getAccountEmailAddressForTest} from "~/server/accounts/create_account_for_test.js";
import {dangerouslyGetAccountAndWithFinishSignUpTransactionEntryIfExistsWithoutAuthorization} from "~/server/accounts/dangerously_get_account_if_exists_without_authorization.js";
import {regenerateOneTimePasswordSignIn} from "~/server/accounts/regenerate_one_time_password_sign_in.js";
import {saveAccountSignUpProfile} from "~/server/accounts/save_account_sign_up_profile.js";
import {signUpAccountWithEmailAddress} from "~/server/accounts/sign_up_account_with_email_address.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {NoopEmailContextModule} from "~/server/emails/noop_email_context_module.js";
import {forumInjection} from "~/server/forum/data/forum_injection.js";
import {searchInjection} from "~/server/search/data/index/search_injection.js";
import {acceptSpaceAccountInvite} from "~/server/spaces/accept_space_account_invite.js";
import {attemptOneTimePasswordSignUpThenCreateSpace} from "~/server/spaces/create/attempt_one_time_password_sign_up_then_create_space.js";
import {withChatGptBotIdForTest} from "~/server/spaces/create/internal/create_space_welcome_package_transaction_entries.js";
import {getAccountSpaceIdsForTest} from "~/server/spaces/get_account_space_ids_for_test.js";
import {getSpaceAutoAddAccountsFromEmailDomains} from "~/server/spaces/get_space_auto_add_accounts_from_email_domains.js";
import {getSpaceAccountItem} from "~/server/spaces/internal/get_space_account_item.js";
import {getSpaceItem} from "~/server/spaces/internal/get_space_item.js";
import {SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {
    FailedPreconditionError,
    InternalError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {iterableFind} from "~/shared/helpers/iterable/iterable_find.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {isEmailAddressValid, validateEmailAddress} from "~/shared/helpers/string/email_address.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {getUnstableReactionCharacterForNewAccountId} from "~/shared/reactions/get_unstable_reaction_character_for_new_account_id.js";
import {SearchAffinityEntityId} from "~/shared/search/search_entity_id.js";

const addSearchAffinityEntityPoints = import.meta.jest.fn(
    searchInjection.dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization.bind(null),
);

const context = createTestContext({
    forumInjection,
    spacesInjection,
    searchInjection: {
        ...searchInjection,
        dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization: addSearchAffinityEntityPoints,
    },
    tasksInjection: {
        internalGetUpdateOurAccountNameTaskTransactionEntries: () => [],
    },
});

class TestFailingEmailContextModule extends NoopEmailContextModule {
    public override async send() {
        throw new InternalError("Test invite send failure");
    }

    public override fork() {
        return new TestFailingEmailContextModule();
    }
}

function generatePersonalTestEmailAddress() {
    const emailAddress = `test.${generateId()}@gmail.com`;
    assert(isEmailAddressValid(emailAddress));
    return emailAddress;
}

function generateWorkTestEmailDomain() {
    return `company-${generateId()}.com`;
}

const emailAddressCountByDomain = new Map<string, number>();

function generateWorkTestEmailAddress(emailDomain: string) {
    const emailAddressNumber = emailAddressCountByDomain.get(emailDomain) ?? 1;
    emailAddressCountByDomain.set(emailDomain, emailAddressNumber + 1);
    const emailAddress = `test.${emailAddressNumber}@${emailDomain}`;
    assert(isEmailAddressValid(emailAddress));
    return emailAddress;
}

function testPersonalSignUp(options?: {name?: string}) {
    return testSignUp({...options, emailAddress: generatePersonalTestEmailAddress()});
}

async function testWorkSignUp(options?: {name?: string}) {
    const emailDomain = generateWorkTestEmailDomain();
    const emailAddress = generateWorkTestEmailAddress(emailDomain);

    const result = await testSignUp({...options, emailAddress});

    return {
        ...result,
        emailDomain,
    };
}

async function testAnotherWorkSignUp(emailDomain: string, options?: {name?: string}) {
    const emailAddress = generateWorkTestEmailAddress(emailDomain);
    return testSignUp({...options, emailAddress});
}

async function testSignUp(options: {name?: string; emailAddress: string}) {
    const [chatGptBot, {accountId, emailAddress, oneTimePassword}] = await runAllPromises([
        TestBot.create(context),
        testSignUpUntilAttemptOneTimePasswordSignUp(options),
    ]);

    const {sessionId, openSpaceId} = await withChatGptBotIdForTest(chatGptBot.id, () => {
        return attemptOneTimePasswordSignUpThenCreateSpace(context.unknownAnonymousAction(), {
            emailAddress: emailAddress,
            oneTimePassword: oneTimePassword,
            inviteEmailAddresses: [],
            ipAddress: null,
            userAgent: null,
        });
    });
    assert(openSpaceId);

    const [session, space] = await runAllPromises([
        TestSession.get(context, sessionId),
        TestSpace.get(context, openSpaceId),
    ]);

    assert(session.account.id === accountId);

    return {
        session: await TestSpaceSession.forSpace(session, space),
        emailAddress,
        chatGptBot,
    };
}

function testPersonalSignUpUntilAttemptOneTimePasswordSignUp(options?: {name?: string}) {
    return testSignUpUntilAttemptOneTimePasswordSignUp({
        ...options,
        emailAddress: generatePersonalTestEmailAddress(),
    });
}

async function testSignUpUntilAttemptOneTimePasswordSignUp({
    name = TestAccount.getNewName(),
    emailAddress,
}: {
    name?: string;
    emailAddress: string;
}) {
    const validatedEmailAddress = validateEmailAddress(emailAddress);

    let accountId: AccountId | undefined;

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        accountId = await signUpAccountWithEmailAddress(
            context.anonymousAction(),
            validatedEmailAddress,
        );
    });

    assert(accountId);

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    await saveAccountSignUpProfile(context.anonymousAction(), {
        accountId,
        name,
        reactionCharacter: getUnstableReactionCharacterForNewAccountId(accountId),
    });

    return {accountId, emailAddress: validatedEmailAddress, oneTimePassword};
}

async function expectSpaceAccountWithInvitePendingState(emailAddress: string, spaceId: SpaceId) {
    const accountId = await getAccountIdForTestEmailAddress(emailAddress);

    expect(
        await SpacesTable.getItem(context.withCache(), {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId,
            accountId,
        }),
    ).toMatchObject({
        role: "Member",
        state: expect.objectContaining({type: "InvitePending"}),
    });
}

async function expectMissingSpaceAccount(emailAddress: string, spaceId: SpaceId) {
    const accountId = await getAccountIdForTestEmailAddress(emailAddress);

    expect(
        await SpacesTable.getItemIfExists(
            context.withCache(),
            {
                partitionType: "Space",
                sortRangeType: "Account",
                spaceId,
                accountId,
            },
            {consistency: "Strong"},
        ),
    ).toBeNull();
}

async function getAccountIdForTestEmailAddress(emailAddress: string) {
    const {accountId} = await getAccountEmailAddressForTest(
        context,
        validateEmailAddress(emailAddress),
    );
    return accountId;
}

async function getAutoAddAccountsFromEmailDomainSpaceId(emailDomain: string) {
    const item = await SpacesTable.getItem(
        context,
        {
            partitionType: "AutoAddAccountsFromEmailDomain",
            sortRangeType: "Space",
            emailDomain,
        },
        {consistency: "Strong"},
    );
    return item.spaceId;
}

test("sign up with correct password creates personal space", async () => {
    const {accountId, emailAddress, oneTimePassword} =
        await testPersonalSignUpUntilAttemptOneTimePasswordSignUp();

    await attemptOneTimePasswordSignUpThenCreateSpace(context.unknownAnonymousAction(), {
        emailAddress: emailAddress,
        oneTimePassword: oneTimePassword,
        inviteEmailAddresses: [],
        ipAddress: null,
        userAgent: null,
    });

    expect((await getAccountSpaceIdsForTest(context, accountId)).size).toEqual(1);
});

test("sign up with correct password creates personal space without saving profile", async () => {
    const emailAddress = validateEmailAddress(generatePersonalTestEmailAddress());

    let accountId: AccountId | undefined;

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        accountId = await signUpAccountWithEmailAddress(context.anonymousAction(), emailAddress);
    });

    assert(accountId);

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    await attemptOneTimePasswordSignUpThenCreateSpace(context.unknownAnonymousAction(), {
        emailAddress: emailAddress,
        oneTimePassword: oneTimePassword,
        inviteEmailAddresses: [],
        ipAddress: null,
        userAgent: null,
    });

    expect((await getAccountSpaceIdsForTest(context, accountId)).size).toEqual(1);
});

test("sign up creates space with correct name based on account", async () => {
    const {accountId, emailAddress, oneTimePassword} =
        await testPersonalSignUpUntilAttemptOneTimePasswordSignUp({name: "Anthony Mose"});

    await attemptOneTimePasswordSignUpThenCreateSpace(context.unknownAnonymousAction(), {
        emailAddress: emailAddress,
        oneTimePassword: oneTimePassword,
        inviteEmailAddresses: [],
        ipAddress: null,
        userAgent: null,
    });

    const spaceIds = await getAccountSpaceIdsForTest(context, accountId);
    expect(spaceIds.size).toEqual(1);

    const spaceId = Array.from(spaceIds)[0]!;

    expect(await getSpaceItem(context.withCache(), spaceId)).toMatchObject({
        name: "Anthony\u2019s Space",
    });
});

test("account becomes owner of created space", async () => {
    const {accountId, emailAddress, oneTimePassword} =
        await testPersonalSignUpUntilAttemptOneTimePasswordSignUp();

    await attemptOneTimePasswordSignUpThenCreateSpace(context.unknownAnonymousAction(), {
        emailAddress: emailAddress,
        oneTimePassword: oneTimePassword,
        inviteEmailAddresses: [],
        ipAddress: null,
        userAgent: null,
    });

    const spaceIds = await getAccountSpaceIdsForTest(context, accountId);
    const spaceId = Array.from(spaceIds)[0]!;

    expect(await getSpaceAccountItem(context.withCache(), spaceId, accountId)).toMatchObject({
        role: "Owner",
    });
});

test("incorrect password does not create space", async () => {
    const {accountId, emailAddress} = await testPersonalSignUpUntilAttemptOneTimePasswordSignUp();

    await expect(
        attemptOneTimePasswordSignUpThenCreateSpace(context.unknownAnonymousAction(), {
            emailAddress: emailAddress,
            oneTimePassword: "XXXXXX",
            inviteEmailAddresses: [],
            ipAddress: null,
            userAgent: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    expect((await getAccountSpaceIdsForTest(context, accountId)).size).toEqual(0);
});

test("can\u2019t use password twice to create multiple spaces", async () => {
    const {emailAddress, oneTimePassword} =
        await testPersonalSignUpUntilAttemptOneTimePasswordSignUp();

    await attemptOneTimePasswordSignUpThenCreateSpace(context.unknownAnonymousAction(), {
        emailAddress: emailAddress,
        oneTimePassword: oneTimePassword,
        inviteEmailAddresses: [],
        ipAddress: null,
        userAgent: null,
    });

    await expect(
        attemptOneTimePasswordSignUpThenCreateSpace(context.unknownAnonymousAction(), {
            emailAddress: emailAddress,
            oneTimePassword: oneTimePassword,
            inviteEmailAddresses: [],
            ipAddress: null,
            userAgent: null,
        }),
    ).rejects.toThrow(new FailedPreconditionError("Missing one time password"));
});

test("locked account does not create space", async () => {
    const {accountId, emailAddress, oneTimePassword} =
        await testPersonalSignUpUntilAttemptOneTimePasswordSignUp();

    await expect(
        attemptOneTimePasswordSignUpThenCreateSpace(context.unknownAnonymousAction(), {
            emailAddress: emailAddress,
            oneTimePassword: "XXXXX1",
            inviteEmailAddresses: [],
            ipAddress: null,
            userAgent: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignUpThenCreateSpace(context.unknownAnonymousAction(), {
            emailAddress: emailAddress,
            oneTimePassword: "XXXXX2",
            inviteEmailAddresses: [],
            ipAddress: null,
            userAgent: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignUpThenCreateSpace(context.unknownAnonymousAction(), {
            emailAddress: emailAddress,
            oneTimePassword: "XXXXX3",
            inviteEmailAddresses: [],
            ipAddress: null,
            userAgent: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignUpThenCreateSpace(context.unknownAnonymousAction(), {
            emailAddress: emailAddress,
            oneTimePassword: "XXXXX4",
            inviteEmailAddresses: [],
            ipAddress: null,
            userAgent: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignUpThenCreateSpace(context.unknownAnonymousAction(), {
            emailAddress: emailAddress,
            oneTimePassword: "XXXXX5",
            inviteEmailAddresses: [],
            ipAddress: null,
            userAgent: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    await expect(
        attemptOneTimePasswordSignUpThenCreateSpace(context.unknownAnonymousAction(), {
            emailAddress: emailAddress,
            oneTimePassword: "XXXXX6",
            inviteEmailAddresses: [],
            ipAddress: null,
            userAgent: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));

    await expect(
        attemptOneTimePasswordSignUpThenCreateSpace(context.unknownAnonymousAction(), {
            emailAddress: emailAddress,
            oneTimePassword: oneTimePassword,
            inviteEmailAddresses: [],
            ipAddress: null,
            userAgent: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Account email address is locked"));

    expect((await getAccountSpaceIdsForTest(context, accountId)).size).toEqual(0);
});

test("space name is truncated when account name is too long", async () => {
    const {accountId, emailAddress, oneTimePassword} =
        await testPersonalSignUpUntilAttemptOneTimePasswordSignUp({
            name: "a".repeat(50),
        });

    await attemptOneTimePasswordSignUpThenCreateSpace(context.unknownAnonymousAction(), {
        emailAddress: emailAddress,
        oneTimePassword: oneTimePassword,
        inviteEmailAddresses: [],
        ipAddress: null,
        userAgent: null,
    });

    const spaceIds = await getAccountSpaceIdsForTest(context, accountId);
    const spaceId = Array.from(spaceIds)[0]!;

    expect(await getSpaceItem(context.withCache(), spaceId)).toMatchObject({
        name: `${"a".repeat(42)}\u2019s Space`,
    });
});

test("sign up with existing session cannot finish sign up twice", async () => {
    const {accountId, emailAddress, oneTimePassword} =
        await testPersonalSignUpUntilAttemptOneTimePasswordSignUp();

    expect((await getAccountSpaceIdsForTest(context, accountId)).size).toEqual(0);

    await attemptOneTimePasswordSignUpThenCreateSpace(context.unknownAnonymousAction(), {
        emailAddress: emailAddress,
        oneTimePassword: oneTimePassword,
        inviteEmailAddresses: [],
        ipAddress: null,
        userAgent: null,
    });

    expect((await getAccountSpaceIdsForTest(context, accountId)).size).toEqual(1);

    const oneTimePasswordEmails2 = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(context.anonymousAction(), emailAddress);
    });

    const newOneTimePassword = oneTimePasswordEmails2[0]!.oneTimePassword;

    await expect(
        attemptOneTimePasswordSignUpThenCreateSpace(context.unknownAnonymousAction(), {
            emailAddress: emailAddress,
            oneTimePassword: newOneTimePassword,
            inviteEmailAddresses: [],
            ipAddress: null,
            userAgent: null,
        }),
    ).rejects.toThrow(new FailedPreconditionError("Account has already signed up"));

    expect((await getAccountSpaceIdsForTest(context, accountId)).size).toEqual(1);
});

test("expired password does not create space", async () => {
    const {accountId, emailAddress, oneTimePassword} =
        await testPersonalSignUpUntilAttemptOneTimePasswordSignUp();

    await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(context.anonymousAction(), emailAddress);
    });

    await expect(
        attemptOneTimePasswordSignUpThenCreateSpace(context.unknownAnonymousAction(), {
            emailAddress: emailAddress,
            oneTimePassword: oneTimePassword,
            inviteEmailAddresses: [],
            ipAddress: null,
            userAgent: null,
        }),
    ).rejects.toThrow(new PermissionDeniedError("Incorrect one time password"));

    expect((await getAccountSpaceIdsForTest(context, accountId)).size).toEqual(0);
});

test("sign in then save sign up profile then finish signing up does create space", async () => {
    const emailAddress = validateEmailAddress(`test.${generateId()}@gmail.com`);

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.anonymousAction(), emailAddress);
    });

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    const {accountId} = await getAccountEmailAddressForTest(context, emailAddress);

    await attemptOneTimePasswordSignIn(context, emailAddress, oneTimePassword, {
        ipAddress: null,
        userAgent: null,
    });

    await saveAccountSignUpProfile(context.withCache(), {
        accountId,
        name: "Test User",
        reactionCharacter: {type: "Cat", variant: "Grey"},
    });

    const oneTimePasswordEmails2 = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await regenerateOneTimePasswordSignIn(context.anonymousAction(), emailAddress);
    });

    const newOneTimePassword = oneTimePasswordEmails2[0]!.oneTimePassword;

    await attemptOneTimePasswordSignUpThenCreateSpace(context.unknownAnonymousAction(), {
        emailAddress: emailAddress,
        oneTimePassword: newOneTimePassword,
        inviteEmailAddresses: [],
        ipAddress: null,
        userAgent: null,
    });

    expect((await getAccountSpaceIdsForTest(context, accountId)).size).toEqual(1);
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

    await attemptOneTimePasswordSignUpThenCreateSpace(context.unknownAnonymousAction(), {
        emailAddress: emailAddress,
        oneTimePassword: oneTimePassword,
        inviteEmailAddresses: [],
        ipAddress: null,
        userAgent: null,
    });

    expect((await getAccountSpaceIdsForTest(context, accountId)).size).toEqual(2);
});

test("first user with company email becomes owner of both spaces", async () => {
    const {session} = await testWorkSignUp();

    const spaceIds = Array.from(await getAccountSpaceIdsForTest(context, session.account.id));
    expect(spaceIds.length).toEqual(2);

    expect(
        await getSpaceAccountItem(context.withCache(), spaceIds[0]!, session.account.id),
    ).toMatchObject({
        role: "Owner",
    });

    expect(
        await getSpaceAccountItem(context.withCache(), spaceIds[1]!, session.account.id),
    ).toMatchObject({
        role: "Owner",
    });
});

test("first user company space is named with @ prefix", async () => {
    const {session, emailDomain} = await testWorkSignUp();

    expect(await getSpaceItem(context.withCache(), session.space.id)).toMatchObject({
        name: `@${emailDomain}`,
    });
});

test("second user with same email domain is auto-added to company space as member", async () => {
    const {session: firstSession, emailDomain} = await testWorkSignUp();
    const {session: secondSession} = await testAnotherWorkSignUp(emailDomain);

    const secondUserSpaceIds = await getAccountSpaceIdsForTest(context, secondSession.account.id);

    expect(secondUserSpaceIds.has(firstSession.space.id)).toEqual(true);

    expect(
        await getSpaceAccountItem(
            context.withCache(),
            firstSession.space.id,
            secondSession.account.id,
        ),
    ).toMatchObject({
        role: "Member",
    });
});

test("second user also creates personal space", async () => {
    const {session: firstSession, emailDomain} = await testWorkSignUp();

    const {session: secondSession} = await testAnotherWorkSignUp(emailDomain, {
        name: "Anthony Mose",
    });

    const secondUserSpaceIds = await getAccountSpaceIdsForTest(context, secondSession.account.id);
    expect(secondUserSpaceIds.size).toEqual(2);

    const personalSpaceId = assertExists(
        Array.from(secondUserSpaceIds).find(spaceId => spaceId !== firstSession.space.id),
    );

    expect(await getSpaceItem(context.withCache(), personalSpaceId)).toMatchObject({
        name: "Anthony\u2019s Space",
    });
});

test("second user is active in company space without invite", async () => {
    const {session: firstSession, emailDomain} = await testWorkSignUp();
    const {session: secondSession} = await testAnotherWorkSignUp(emailDomain);

    expect(
        await getSpaceAccountItem(
            context.withCache(),
            firstSession.space.id,
            secondSession.account.id,
        ),
    ).toMatchObject({
        state: expect.objectContaining({
            type: "Active",
        }),
    });
});

test("second user opens company space by default", async () => {
    const {session: firstSession, emailDomain} = await testWorkSignUp();
    const {session: secondSession} = await testAnotherWorkSignUp(emailDomain);

    expect(secondSession.space.id).toEqual(firstSession.space.id);
});

test("third user also gets auto-added to company space", async () => {
    const {session: firstSession, emailDomain} = await testWorkSignUp();
    await testAnotherWorkSignUp(emailDomain);
    const {session: thirdSession} = await testAnotherWorkSignUp(emailDomain);

    expect(
        await getSpaceAccountItem(
            context.withCache(),
            firstSession.space.id,
            thirdSession.account.id,
        ),
    ).toMatchObject({
        role: "Member",
    });
});

test("when auto-add is disabled user creates only personal space", async () => {
    const {session: firstSession, emailDomain} = await testWorkSignUp();

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

    const {session: secondSession} = await testAnotherWorkSignUp(emailDomain);

    const secondUserSpaceIds = await getAccountSpaceIdsForTest(context, secondSession.account.id);

    expect(secondUserSpaceIds.size).toEqual(1);
    expect(secondUserSpaceIds.has(firstSession.space.id)).toEqual(false);
});

test("email domain extraction is case insensitive", async () => {
    const {session: firstSession, emailDomain} = await testWorkSignUp();

    const {session: secondSession} = await testSignUp({
        emailAddress: `test.2@${emailDomain.toUpperCase()}`,
    });

    expect(firstSession.space.id).toEqual(secondSession.space.id);
});

test("attempting to sign up again after finishing sign up fails", async () => {
    const {emailAddress} = await testPersonalSignUp();

    await expect(
        signUpAccountWithEmailAddress(context.anonymousAction(), emailAddress),
    ).rejects.toThrow(new FailedPreconditionError("Email address has already signed up"));
});

test("cannot save sign up profile after finishing sign up", async () => {
    const emailAddress = validateEmailAddress(generatePersonalTestEmailAddress());

    let accountId: AccountId | undefined;

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        accountId = await signUpAccountWithEmailAddress(context.anonymousAction(), emailAddress);
    });

    assert(accountId);

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    await saveAccountSignUpProfile(context.anonymousAction(), {
        accountId,
        name: "Anthony Mose 1",
        reactionCharacter: getUnstableReactionCharacterForNewAccountId(accountId),
    });

    await saveAccountSignUpProfile(context.anonymousAction(), {
        accountId,
        name: "Anthony Mose 2",
        reactionCharacter: getUnstableReactionCharacterForNewAccountId(accountId),
    });

    await attemptOneTimePasswordSignUpThenCreateSpace(context.unknownAnonymousAction(), {
        emailAddress: emailAddress,
        oneTimePassword: oneTimePassword,
        inviteEmailAddresses: [],
        ipAddress: null,
        userAgent: null,
    });

    await expect(
        saveAccountSignUpProfile(context.anonymousAction(), {
            accountId,
            name: "Anthony Mose 3",
            reactionCharacter: {type: "Cat", variant: "Pink"},
        }),
    ).rejects.toThrow(new FailedPreconditionError("Account has already finished signing up"));
});

test("save account sign up profile then sign in", async () => {
    const emailAddress = validateEmailAddress(generatePersonalTestEmailAddress());

    let accountId: AccountId | undefined;

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        accountId = await signUpAccountWithEmailAddress(context.anonymousAction(), emailAddress);
    });

    assert(accountId);

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    await saveAccountSignUpProfile(context.anonymousAction(), {
        accountId,
        name: "Anthony Mose 1",
        reactionCharacter: getUnstableReactionCharacterForNewAccountId(accountId),
    });

    await attemptOneTimePasswordSignIn(context.anonymousAction(), emailAddress, oneTimePassword, {
        ipAddress: null,
        userAgent: null,
    });

    const accountAfterSignIn = assertExists(
        await dangerouslyGetAccountAndWithFinishSignUpTransactionEntryIfExistsWithoutAuthorization(
            context.withCache(),
            accountId,
        ),
    );

    expect(accountAfterSignIn.account.initialData).toMatchObject({
        name: "Anthony Mose 1",
    });
    expect(accountAfterSignIn.finishSignUpTransactionEntry).not.toBeNull();

    await saveAccountSignUpProfile(context.anonymousAction(), {
        accountId,
        name: "Anthony Mose 2",
        reactionCharacter: getUnstableReactionCharacterForNewAccountId(accountId),
    });
});

test("save account sign up profile after signing in and accepting invite but before finishing signing up", async () => {
    const space = await TestSpace.create(context);
    const admin = await space.createSession({role: "Admin"});
    const emailAddress = validateEmailAddress(generatePersonalTestEmailAddress());

    await admin.inviteEmailAddress(emailAddress);

    const accountEmailAddressItem = await getAccountEmailAddressForTest(context, emailAddress);
    const accountId = accountEmailAddressItem.accountId;

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.anonymousAction(), emailAddress);
    });

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    await saveAccountSignUpProfile(context.withCache(), {
        accountId,
        name: "Anthony Mose 1",
        reactionCharacter: getUnstableReactionCharacterForNewAccountId(accountId),
    });

    const {sessionId} = await attemptOneTimePasswordSignIn(
        context.anonymousAction(),
        emailAddress,
        oneTimePassword,
        {ipAddress: null, userAgent: null},
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
        name: "Anthony Mose 1",
    });
    expect(accountAfterJoin.finishSignUpTransactionEntry).not.toBeNull();

    await expect(
        saveAccountSignUpProfile(context.anonymousAction(), {
            accountId,
            name: "Anthony Mose 2",
            reactionCharacter: getUnstableReactionCharacterForNewAccountId(accountId),
        }),
    ).rejects.toThrow(
        new FailedPreconditionError(
            "Can only finish account sign up when the account hasn\u2019t joined any spaces (the account may have pending invites)",
        ),
    );
});

test("invite account to space without accepting", async () => {
    const {session: session1} = await testWorkSignUp();

    const emailAddress2 = generatePersonalTestEmailAddress();
    await session1.inviteEmailAddress(emailAddress2);

    const {session: session2} = await testSignUp({emailAddress: emailAddress2});

    const spaceIds = await getAccountSpaceIdsForTest(context, session2.account.id);
    expect(spaceIds.size).toEqual(1);
    expect(spaceIds.has(session1.space.id)).toEqual(false);
});

test("invite account to space and accept invite", async () => {
    const {session: session1} = await testWorkSignUp();

    const emailAddress2 = generatePersonalTestEmailAddress();
    await session1.inviteEmailAddress(emailAddress2);

    const {session: session2} = await testSignUp({emailAddress: emailAddress2});

    await acceptSpaceAccountInvite(session2.action(), session1.space.id);

    const spaceIds = await getAccountSpaceIdsForTest(context, session2.account.id);
    expect(spaceIds.size).toEqual(2);
    expect(spaceIds.has(session1.space.id)).toEqual(true);
});

test("invite account to work space that would be auto-added to space", async () => {
    const {session: session1, emailDomain} = await testWorkSignUp();

    const emailAddress2 = generateWorkTestEmailAddress(emailDomain);
    await session1.inviteEmailAddress(emailAddress2);

    const {session: session2} = await testSignUp({emailAddress: emailAddress2});

    const spaceIds = await getAccountSpaceIdsForTest(context, session2.account.id);
    expect(spaceIds.size).toEqual(2);
    expect(spaceIds.has(session1.space.id)).toEqual(true);
});

test("invited account to space that would be auto-added to space can\u2019t accept invite after being auto added", async () => {
    const {session: session1, emailDomain} = await testWorkSignUp();

    const emailAddress2 = generateWorkTestEmailAddress(emailDomain);
    await session1.inviteEmailAddress(emailAddress2);

    const {session: session2} = await testSignUp({emailAddress: emailAddress2});

    await expect(acceptSpaceAccountInvite(session2.action(), session1.space.id)).rejects.toThrow(
        new FailedPreconditionError("Account invitation is not in pending state"),
    );
});

describe("Invite email addresses after sign up", () => {
    test("when account is not auto-added invites are sent to personal space", async () => {
        const {accountId, emailAddress, oneTimePassword} =
            await testPersonalSignUpUntilAttemptOneTimePasswordSignUp();
        const inviteEmailAddressFromGenericDomain = generatePersonalTestEmailAddress();
        const inviteEmailAddressFromWorkDomain = generateWorkTestEmailAddress(
            generateWorkTestEmailDomain(),
        );

        const {openSpaceId} = await attemptOneTimePasswordSignUpThenCreateSpace(
            context.unknownAnonymousAction(),
            {
                emailAddress,
                oneTimePassword,
                inviteEmailAddresses: [
                    inviteEmailAddressFromGenericDomain,
                    inviteEmailAddressFromWorkDomain,
                ],
                ipAddress: null,
                userAgent: null,
            },
        );

        await ProcessContextModule.waitForTestTasks();

        const spaceIds = await getAccountSpaceIdsForTest(context, accountId);
        expect(spaceIds.size).toEqual(1);

        const personalSpaceId = assertExists(Array.from(spaceIds)[0]);
        expect(openSpaceId).toEqual(personalSpaceId);
        await expectSpaceAccountWithInvitePendingState(
            inviteEmailAddressFromGenericDomain,
            personalSpaceId,
        );
        await expectSpaceAccountWithInvitePendingState(
            inviteEmailAddressFromWorkDomain,
            personalSpaceId,
        );
    });

    test("when creating auto-add space same-domain invites go to the auto-add space", async () => {
        const emailDomain = generateWorkTestEmailDomain();
        const {accountId, emailAddress, oneTimePassword} =
            await testSignUpUntilAttemptOneTimePasswordSignUp({
                emailAddress: generateWorkTestEmailAddress(emailDomain),
            });
        const inviteEmailAddressWithSameDomain = generateWorkTestEmailAddress(emailDomain);

        const {openSpaceId} = await attemptOneTimePasswordSignUpThenCreateSpace(
            context.unknownAnonymousAction(),
            {
                emailAddress,
                oneTimePassword,
                inviteEmailAddresses: [inviteEmailAddressWithSameDomain],
                ipAddress: null,
                userAgent: null,
            },
        );

        await ProcessContextModule.waitForTestTasks();

        const spaceIds = await getAccountSpaceIdsForTest(context, accountId);
        expect(spaceIds.size).toEqual(2);

        const autoAddSpaceId = openSpaceId;
        expect(spaceIds.has(autoAddSpaceId)).toEqual(true);
        expect(autoAddSpaceId).toEqual(await getAutoAddAccountsFromEmailDomainSpaceId(emailDomain));

        const personalSpaceId = assertExists(
            iterableFind(spaceIds, spaceId => spaceId !== autoAddSpaceId),
        );

        await expectSpaceAccountWithInvitePendingState(
            inviteEmailAddressWithSameDomain,
            autoAddSpaceId,
        );
        await expectMissingSpaceAccount(inviteEmailAddressWithSameDomain, personalSpaceId);
    });

    test("when creating auto-add space different-domain invites go to personal space", async () => {
        const emailDomain = generateWorkTestEmailDomain();
        const {accountId, emailAddress, oneTimePassword} =
            await testSignUpUntilAttemptOneTimePasswordSignUp({
                emailAddress: generateWorkTestEmailAddress(emailDomain),
            });
        const inviteEmailAddressWithDifferentDomain = generatePersonalTestEmailAddress();

        const {openSpaceId} = await attemptOneTimePasswordSignUpThenCreateSpace(
            context.unknownAnonymousAction(),
            {
                emailAddress,
                oneTimePassword,
                inviteEmailAddresses: [inviteEmailAddressWithDifferentDomain],
                ipAddress: null,
                userAgent: null,
            },
        );

        await ProcessContextModule.waitForTestTasks();

        const spaceIds = await getAccountSpaceIdsForTest(context, accountId);
        expect(spaceIds.size).toEqual(2);

        const personalSpaceId = openSpaceId;
        expect(spaceIds.has(personalSpaceId)).toEqual(true);

        const autoAddSpaceId = assertExists(
            iterableFind(spaceIds, spaceId => spaceId !== personalSpaceId),
        );
        expect(autoAddSpaceId).toEqual(await getAutoAddAccountsFromEmailDomainSpaceId(emailDomain));

        await expectSpaceAccountWithInvitePendingState(
            inviteEmailAddressWithDifferentDomain,
            personalSpaceId,
        );
        await expectMissingSpaceAccount(inviteEmailAddressWithDifferentDomain, autoAddSpaceId);
    });

    test("when creating auto-add space split invites go to both spaces", async () => {
        const emailDomain = generateWorkTestEmailDomain();
        const {accountId, emailAddress, oneTimePassword} =
            await testSignUpUntilAttemptOneTimePasswordSignUp({
                emailAddress: generateWorkTestEmailAddress(emailDomain),
            });
        const inviteEmailAddressWithSameDomain = generateWorkTestEmailAddress(emailDomain);
        const inviteEmailAddressWithDifferentDomain = generatePersonalTestEmailAddress();

        const {openSpaceId} = await attemptOneTimePasswordSignUpThenCreateSpace(
            context.unknownAnonymousAction(),
            {
                emailAddress,
                oneTimePassword,
                inviteEmailAddresses: [
                    inviteEmailAddressWithSameDomain,
                    inviteEmailAddressWithDifferentDomain,
                ],
                ipAddress: null,
                userAgent: null,
            },
        );

        await ProcessContextModule.waitForTestTasks();

        const spaceIds = await getAccountSpaceIdsForTest(context, accountId);
        expect(spaceIds.size).toEqual(2);

        const autoAddSpaceId = openSpaceId;
        expect(spaceIds.has(autoAddSpaceId)).toEqual(true);
        expect(autoAddSpaceId).toEqual(await getAutoAddAccountsFromEmailDomainSpaceId(emailDomain));

        const personalSpaceId = assertExists(
            iterableFind(spaceIds, spaceId => spaceId !== autoAddSpaceId),
        );

        await expectSpaceAccountWithInvitePendingState(
            inviteEmailAddressWithSameDomain,
            autoAddSpaceId,
        );
        await expectSpaceAccountWithInvitePendingState(
            inviteEmailAddressWithDifferentDomain,
            personalSpaceId,
        );
    });

    test("when member of auto-add space same-domain invites go to auto-add space", async () => {
        const {session: firstSession, emailDomain} = await testWorkSignUp();
        const {emailAddress, oneTimePassword} = await testSignUpUntilAttemptOneTimePasswordSignUp({
            emailAddress: generateWorkTestEmailAddress(emailDomain),
        });
        const inviteEmailAddressWithSameDomain = generateWorkTestEmailAddress(emailDomain);

        const {openSpaceId} = await attemptOneTimePasswordSignUpThenCreateSpace(
            context.unknownAnonymousAction(),
            {
                emailAddress,
                oneTimePassword,
                inviteEmailAddresses: [inviteEmailAddressWithSameDomain],
                ipAddress: null,
                userAgent: null,
            },
        );

        await ProcessContextModule.waitForTestTasks();

        expect(openSpaceId).toEqual(firstSession.space.id);

        const accountEmailAddressItem = await getAccountEmailAddressForTest(
            context,
            validateEmailAddress(emailAddress),
        );

        expect(
            await getSpaceAccountItem(
                context.withCache(),
                firstSession.space.id,
                firstSession.account.id,
            ),
        ).toMatchObject({role: "Owner"});

        expect(
            await getSpaceAccountItem(
                context.withCache(),
                firstSession.space.id,
                accountEmailAddressItem.accountId,
            ),
        ).toMatchObject({role: "Member"});

        const spaceIds = await getAccountSpaceIdsForTest(
            context,
            accountEmailAddressItem.accountId,
        );
        expect(spaceIds.has(firstSession.space.id)).toEqual(true);
        expect(spaceIds.size).toEqual(2);
        const personalSpaceId = assertExists(
            iterableFind(spaceIds, spaceId => spaceId !== firstSession.space.id),
        );

        await expectSpaceAccountWithInvitePendingState(
            inviteEmailAddressWithSameDomain,
            firstSession.space.id,
        );
        await expectMissingSpaceAccount(inviteEmailAddressWithSameDomain, personalSpaceId);
    });

    test("when member of auto-add space invites different-domain email the invite goes to personal space", async () => {
        const {session: firstSession, emailDomain} = await testWorkSignUp();
        const {emailAddress, oneTimePassword} = await testSignUpUntilAttemptOneTimePasswordSignUp({
            emailAddress: generateWorkTestEmailAddress(emailDomain),
        });
        const inviteEmailAddressWithDifferentDomain = generatePersonalTestEmailAddress();

        const {openSpaceId} = await attemptOneTimePasswordSignUpThenCreateSpace(
            context.unknownAnonymousAction(),
            {
                emailAddress,
                oneTimePassword,
                inviteEmailAddresses: [inviteEmailAddressWithDifferentDomain],
                ipAddress: null,
                userAgent: null,
            },
        );

        await ProcessContextModule.waitForTestTasks();

        expect(openSpaceId).not.toEqual(firstSession.space.id);

        const accountEmailAddressItem = await getAccountEmailAddressForTest(
            context,
            validateEmailAddress(emailAddress),
        );
        const spaceIds = await getAccountSpaceIdsForTest(
            context,
            accountEmailAddressItem.accountId,
        );
        const personalSpaceId = assertExists(
            iterableFind(spaceIds, spaceId => spaceId !== firstSession.space.id),
        );

        expect(openSpaceId).toEqual(personalSpaceId);

        await expectSpaceAccountWithInvitePendingState(
            inviteEmailAddressWithDifferentDomain,
            personalSpaceId,
        );
        await expectMissingSpaceAccount(
            inviteEmailAddressWithDifferentDomain,
            firstSession.space.id,
        );
    });

    test("when member of auto-add space split invites go to both spaces", async () => {
        const {session: firstSession, emailDomain} = await testWorkSignUp();
        const {emailAddress, oneTimePassword} = await testSignUpUntilAttemptOneTimePasswordSignUp({
            emailAddress: generateWorkTestEmailAddress(emailDomain),
        });
        const inviteEmailAddressWithSameDomain = generateWorkTestEmailAddress(emailDomain);
        const inviteEmailAddressWithDifferentDomain = generatePersonalTestEmailAddress();

        const {openSpaceId} = await attemptOneTimePasswordSignUpThenCreateSpace(
            context.unknownAnonymousAction(),
            {
                emailAddress,
                oneTimePassword,
                inviteEmailAddresses: [
                    inviteEmailAddressWithSameDomain,
                    inviteEmailAddressWithDifferentDomain,
                ],
                ipAddress: null,
                userAgent: null,
            },
        );

        await ProcessContextModule.waitForTestTasks();

        expect(openSpaceId).toEqual(firstSession.space.id);

        const accountEmailAddressItem = await getAccountEmailAddressForTest(
            context,
            validateEmailAddress(emailAddress),
        );
        const spaceIds = await getAccountSpaceIdsForTest(
            context,
            accountEmailAddressItem.accountId,
        );
        const personalSpaceId = assertExists(
            iterableFind(spaceIds, spaceId => spaceId !== firstSession.space.id),
        );

        await expectSpaceAccountWithInvitePendingState(
            inviteEmailAddressWithSameDomain,
            firstSession.space.id,
        );
        await expectMissingSpaceAccount(inviteEmailAddressWithSameDomain, personalSpaceId);
        await expectSpaceAccountWithInvitePendingState(
            inviteEmailAddressWithDifferentDomain,
            personalSpaceId,
        );
        await expectMissingSpaceAccount(
            inviteEmailAddressWithDifferentDomain,
            firstSession.space.id,
        );
    });

    test("when auto-add is disabled same-domain invites fall back to personal space", async () => {
        const {session: firstSession, emailDomain} = await testWorkSignUp();

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

        const {emailAddress, oneTimePassword} = await testSignUpUntilAttemptOneTimePasswordSignUp({
            emailAddress: generateWorkTestEmailAddress(emailDomain),
        });
        const inviteEmailAddressWithSameDomain = generateWorkTestEmailAddress(emailDomain);

        const {openSpaceId} = await attemptOneTimePasswordSignUpThenCreateSpace(
            context.unknownAnonymousAction(),
            {
                emailAddress,
                oneTimePassword,
                inviteEmailAddresses: [inviteEmailAddressWithSameDomain],
                ipAddress: null,
                userAgent: null,
            },
        );

        await ProcessContextModule.waitForTestTasks();

        const accountEmailAddressItem = await getAccountEmailAddressForTest(
            context,
            validateEmailAddress(emailAddress),
        );
        const spaceIds = await getAccountSpaceIdsForTest(
            context,
            accountEmailAddressItem.accountId,
        );
        expect(spaceIds.size).toEqual(1);

        const personalSpaceId = assertExists(Array.from(spaceIds)[0]);
        expect(openSpaceId).toEqual(personalSpaceId);
        await expectSpaceAccountWithInvitePendingState(
            inviteEmailAddressWithSameDomain,
            personalSpaceId,
        );
        await expectMissingSpaceAccount(inviteEmailAddressWithSameDomain, firstSession.space.id);
    });

    test("invite email failures are escalated from waitUntil tasks", async () => {
        const {emailAddress, oneTimePassword} =
            await testPersonalSignUpUntilAttemptOneTimePasswordSignUp();
        const inviteEmailAddress = generatePersonalTestEmailAddress();

        await attemptOneTimePasswordSignUpThenCreateSpace(
            context.unknownAnonymousAction().clone({
                email: new TestFailingEmailContextModule(),
            }),
            {
                emailAddress: emailAddress,
                oneTimePassword: oneTimePassword,
                inviteEmailAddresses: [validateEmailAddress(inviteEmailAddress)],
                ipAddress: null,
                userAgent: null,
            },
        );

        await expect(ProcessContextModule.waitForTestTasks()).rejects.toThrow(
            "Couldn\u2019t invite email addresses after sign up",
        );
    });
});

describe("Welcome package", () => {
    function getSearchAffinityEntityPointCalls() {
        const callsBySpaceIdByAccountId = new DefaultMap<
            AccountId,
            DefaultMap<
                SpaceId,
                Array<{
                    accountId: AccountId;
                    spaceId: SpaceId;
                    entityId: SearchAffinityEntityId;
                    points: number;
                }>
            >
        >(() => new DefaultMap(() => []));

        for (const call of addSearchAffinityEntityPoints.mock.calls) {
            callsBySpaceIdByAccountId
                .getOrSetDefault(call[1].accountId)
                .getOrSetDefault(call[1].spaceId)
                .push(call[1]);
        }

        return Object.fromEntries(
            mapIterable(callsBySpaceIdByAccountId, ([accountId, callsBySpaceId]) => [
                accountId,
                Object.fromEntries(
                    mapIterable(callsBySpaceId, ([spaceId, calls]) => [
                        spaceId,
                        calls
                            .map(call => omitObject(call, ["spaceId", "accountId"]))
                            .sort((a, b) => b.points - a.points),
                    ]),
                ),
            ]),
        );
    }

    test("applies welcome package to new personal space", async () => {
        const {session} = await testPersonalSignUp();

        const item = await SpacesTable.getItem(context, {
            partitionType: "Space",
            sortRangeType: "WelcomePackage",
            spaceId: session.space.id,
        });

        expect(getSearchAffinityEntityPointCalls()).toEqual({
            [session.account.id]: {
                [session.space.id]: [
                    {entityId: `Channel:${item.generalChannelId}`, points: 3},
                    {entityId: `Channel:${item.randomChannelId}`, points: 2.999},
                    {entityId: `Account:${item.chatGptBotAccountId}`, points: 2.998},
                ],
            },
        });
    });

    test("applies welcome package to new personal and new work space", async () => {
        const {session} = await testWorkSignUp();

        const spaceIds = await getAccountSpaceIdsForTest(context, session.account.id);
        const personalSpaceId = assertExists(
            iterableFind(spaceIds, spaceId => spaceId !== session.space.id),
        );

        const [workItem, personalItem] = await runAllPromises([
            SpacesTable.getItem(context, {
                partitionType: "Space",
                sortRangeType: "WelcomePackage",
                spaceId: session.space.id,
            }),
            SpacesTable.getItem(context, {
                partitionType: "Space",
                sortRangeType: "WelcomePackage",
                spaceId: personalSpaceId,
            }),
        ]);

        expect(getSearchAffinityEntityPointCalls()).toEqual({
            [session.account.id]: {
                [session.space.id]: [
                    {entityId: `Channel:${workItem.generalChannelId}`, points: 3},
                    {entityId: `Channel:${workItem.randomChannelId}`, points: 2.999},
                    {entityId: `Account:${workItem.chatGptBotAccountId}`, points: 2.998},
                ],
                [personalSpaceId]: [
                    {entityId: `Channel:${personalItem.generalChannelId}`, points: 3},
                    {entityId: `Channel:${personalItem.randomChannelId}`, points: 2.999},
                    {entityId: `Account:${personalItem.chatGptBotAccountId}`, points: 2.998},
                ],
            },
        });
    });

    test("applies welcome package and suggested accounts to second account in work space", async () => {
        const {session: session1, emailDomain} = await testWorkSignUp();

        addSearchAffinityEntityPoints.mockClear();

        const {session} = await testAnotherWorkSignUp(emailDomain);

        const spaceIds = await getAccountSpaceIdsForTest(context, session.account.id);
        const personalSpaceId = assertExists(
            iterableFind(spaceIds, spaceId => spaceId !== session.space.id),
        );

        const [workItem, personalItem] = await runAllPromises([
            SpacesTable.getItem(context, {
                partitionType: "Space",
                sortRangeType: "WelcomePackage",
                spaceId: session.space.id,
            }),
            SpacesTable.getItem(context, {
                partitionType: "Space",
                sortRangeType: "WelcomePackage",
                spaceId: personalSpaceId,
            }),
        ]);

        expect(getSearchAffinityEntityPointCalls()).toEqual({
            [session.account.id]: {
                [session.space.id]: [
                    {entityId: `Channel:${workItem.generalChannelId}`, points: 3},
                    {entityId: `Channel:${workItem.randomChannelId}`, points: 2.999},
                    {entityId: `Account:${workItem.chatGptBotAccountId}`, points: 2.998},
                    {entityId: `Account:${session1.account.id}`, points: 2.997},
                ],
                [personalSpaceId]: [
                    {entityId: `Channel:${personalItem.generalChannelId}`, points: 3},
                    {entityId: `Channel:${personalItem.randomChannelId}`, points: 2.999},
                    {entityId: `Account:${personalItem.chatGptBotAccountId}`, points: 2.998},
                ],
            },
        });
    });

    test("applies welcome package and suggested accounts to third account in work space", async () => {
        const {session: session1, emailDomain} = await testWorkSignUp();
        const {session: session2} = await testAnotherWorkSignUp(emailDomain);

        addSearchAffinityEntityPoints.mockClear();

        const {session} = await testAnotherWorkSignUp(emailDomain);

        const spaceIds = await getAccountSpaceIdsForTest(context, session.account.id);
        const personalSpaceId = assertExists(
            iterableFind(spaceIds, spaceId => spaceId !== session.space.id),
        );

        const [workItem, personalItem] = await runAllPromises([
            SpacesTable.getItem(context, {
                partitionType: "Space",
                sortRangeType: "WelcomePackage",
                spaceId: session.space.id,
            }),
            SpacesTable.getItem(context, {
                partitionType: "Space",
                sortRangeType: "WelcomePackage",
                spaceId: personalSpaceId,
            }),
        ]);

        expect(getSearchAffinityEntityPointCalls()).toEqual({
            [session.account.id]: {
                [session.space.id]: [
                    {entityId: `Channel:${workItem.generalChannelId}`, points: 3},
                    {entityId: `Channel:${workItem.randomChannelId}`, points: 2.999},
                    {entityId: `Account:${workItem.chatGptBotAccountId}`, points: 2.998},
                    {entityId: `Account:${session1.account.id}`, points: 2.997},
                    {entityId: `Account:${session2.account.id}`, points: 2.996},
                ],
                [personalSpaceId]: [
                    {entityId: `Channel:${personalItem.generalChannelId}`, points: 3},
                    {entityId: `Channel:${personalItem.randomChannelId}`, points: 2.999},
                    {entityId: `Account:${personalItem.chatGptBotAccountId}`, points: 2.998},
                ],
            },
        });
    });

    test("applies welcome package and suggested accounts to fifth account in work space", async () => {
        const {session: session1, emailDomain} = await testWorkSignUp();
        const {session: session2} = await testAnotherWorkSignUp(emailDomain);
        const {session: session3} = await testAnotherWorkSignUp(emailDomain);
        const {session: session4} = await testAnotherWorkSignUp(emailDomain);

        addSearchAffinityEntityPoints.mockClear();

        const {session} = await testAnotherWorkSignUp(emailDomain);

        const spaceIds = await getAccountSpaceIdsForTest(context, session.account.id);
        const personalSpaceId = assertExists(
            iterableFind(spaceIds, spaceId => spaceId !== session.space.id),
        );

        const [workItem, personalItem] = await runAllPromises([
            SpacesTable.getItem(context, {
                partitionType: "Space",
                sortRangeType: "WelcomePackage",
                spaceId: session.space.id,
            }),
            SpacesTable.getItem(context, {
                partitionType: "Space",
                sortRangeType: "WelcomePackage",
                spaceId: personalSpaceId,
            }),
        ]);

        expect(getSearchAffinityEntityPointCalls()).toEqual({
            [session.account.id]: {
                [session.space.id]: [
                    {entityId: `Channel:${workItem.generalChannelId}`, points: 3},
                    {entityId: `Channel:${workItem.randomChannelId}`, points: 2.999},
                    {entityId: `Account:${workItem.chatGptBotAccountId}`, points: 2.998},
                    {entityId: `Account:${session1.account.id}`, points: 2.997},
                    {entityId: `Account:${session2.account.id}`, points: 2.996},
                    {entityId: `Account:${session3.account.id}`, points: 2.995},
                    {entityId: `Account:${session4.account.id}`, points: 2.994},
                ],
                [personalSpaceId]: [
                    {entityId: `Channel:${personalItem.generalChannelId}`, points: 3},
                    {entityId: `Channel:${personalItem.randomChannelId}`, points: 2.999},
                    {entityId: `Account:${personalItem.chatGptBotAccountId}`, points: 2.998},
                ],
            },
        });
    });

    test("applies welcome package and suggested accounts to tenth account in work space", async () => {
        const {session: session1, emailDomain} = await testWorkSignUp();
        const {session: session2} = await testAnotherWorkSignUp(emailDomain);
        const {session: session3} = await testAnotherWorkSignUp(emailDomain);
        const {session: session4} = await testAnotherWorkSignUp(emailDomain);
        const {session: session5} = await testAnotherWorkSignUp(emailDomain);
        await testAnotherWorkSignUp(emailDomain);
        await testAnotherWorkSignUp(emailDomain);
        await testAnotherWorkSignUp(emailDomain);
        await testAnotherWorkSignUp(emailDomain);

        addSearchAffinityEntityPoints.mockClear();

        const {session} = await testAnotherWorkSignUp(emailDomain);

        const spaceIds = await getAccountSpaceIdsForTest(context, session.account.id);
        const personalSpaceId = assertExists(
            iterableFind(spaceIds, spaceId => spaceId !== session.space.id),
        );

        const [workItem, personalItem] = await runAllPromises([
            SpacesTable.getItem(context, {
                partitionType: "Space",
                sortRangeType: "WelcomePackage",
                spaceId: session.space.id,
            }),
            SpacesTable.getItem(context, {
                partitionType: "Space",
                sortRangeType: "WelcomePackage",
                spaceId: personalSpaceId,
            }),
        ]);

        expect(getSearchAffinityEntityPointCalls()).toEqual({
            [session.account.id]: {
                [session.space.id]: [
                    {entityId: `Channel:${workItem.generalChannelId}`, points: 3},
                    {entityId: `Channel:${workItem.randomChannelId}`, points: 2.999},
                    {entityId: `Account:${workItem.chatGptBotAccountId}`, points: 2.998},
                    {entityId: `Account:${session1.account.id}`, points: 2.997},
                    {entityId: `Account:${session2.account.id}`, points: 2.996},
                    {entityId: `Account:${session3.account.id}`, points: 2.995},
                    {entityId: `Account:${session4.account.id}`, points: 2.994},
                    {entityId: `Account:${session5.account.id}`, points: 2.993},
                ],
                [personalSpaceId]: [
                    {entityId: `Channel:${personalItem.generalChannelId}`, points: 3},
                    {entityId: `Channel:${personalItem.randomChannelId}`, points: 2.999},
                    {entityId: `Account:${personalItem.chatGptBotAccountId}`, points: 2.998},
                ],
            },
        });
    });

    test("applies welcome package for second account invited to space", async () => {
        const {session: inviterSession} = await testPersonalSignUp();

        addSearchAffinityEntityPoints.mockClear();

        const emailAddress = generatePersonalTestEmailAddress();

        await inviterSession.inviteEmailAddress(emailAddress);

        const {session} = await testSignUp({emailAddress});

        await acceptSpaceAccountInvite(session.action(), inviterSession.space.id);

        const [inviterItem, personalItem] = await runAllPromises([
            SpacesTable.getItem(context, {
                partitionType: "Space",
                sortRangeType: "WelcomePackage",
                spaceId: inviterSession.space.id,
            }),
            SpacesTable.getItem(context, {
                partitionType: "Space",
                sortRangeType: "WelcomePackage",
                spaceId: session.space.id,
            }),
        ]);

        expect(getSearchAffinityEntityPointCalls()).toEqual({
            [session.account.id]: {
                [inviterSession.space.id]: [
                    {entityId: `Channel:${inviterItem.generalChannelId}`, points: 3},
                    {entityId: `Channel:${inviterItem.randomChannelId}`, points: 2.999},
                    {entityId: `Account:${inviterItem.chatGptBotAccountId}`, points: 2.998},
                    {entityId: `Account:${inviterSession.account.id}`, points: 2.997},
                ],
                [session.space.id]: [
                    {entityId: `Channel:${personalItem.generalChannelId}`, points: 3},
                    {entityId: `Channel:${personalItem.randomChannelId}`, points: 2.999},
                    {entityId: `Account:${personalItem.chatGptBotAccountId}`, points: 2.998},
                ],
            },
        });
    });

    test("applies welcome package for second account invited to space when accepting invite", async () => {
        const {session: inviterSession} = await testPersonalSignUp();

        const emailAddress = generatePersonalTestEmailAddress();

        await inviterSession.inviteEmailAddress(emailAddress);

        const {session} = await testSignUp({emailAddress});

        addSearchAffinityEntityPoints.mockClear();

        await acceptSpaceAccountInvite(session.action(), inviterSession.space.id);

        const inviterItem = await SpacesTable.getItem(context, {
            partitionType: "Space",
            sortRangeType: "WelcomePackage",
            spaceId: inviterSession.space.id,
        });

        expect(getSearchAffinityEntityPointCalls()).toEqual({
            [session.account.id]: {
                [inviterSession.space.id]: [
                    {entityId: `Channel:${inviterItem.generalChannelId}`, points: 3},
                    {entityId: `Channel:${inviterItem.randomChannelId}`, points: 2.999},
                    {entityId: `Account:${inviterItem.chatGptBotAccountId}`, points: 2.998},
                    {entityId: `Account:${inviterSession.account.id}`, points: 2.997},
                ],
            },
        });
    });

    test("applies welcome package for third account invited to space", async () => {
        const {session: inviterSession} = await testPersonalSignUp();

        const invitedEmailAddress1 = generatePersonalTestEmailAddress();
        await inviterSession.inviteEmailAddress(invitedEmailAddress1);
        const {session: invitedSession1} = await testSignUp({emailAddress: invitedEmailAddress1});
        await acceptSpaceAccountInvite(invitedSession1.action(), inviterSession.space.id);

        addSearchAffinityEntityPoints.mockClear();

        const emailAddress = generatePersonalTestEmailAddress();

        await inviterSession.inviteEmailAddress(emailAddress);

        const {session} = await testSignUp({emailAddress});

        await acceptSpaceAccountInvite(session.action(), inviterSession.space.id);

        const [inviterItem, personalItem] = await runAllPromises([
            SpacesTable.getItem(context, {
                partitionType: "Space",
                sortRangeType: "WelcomePackage",
                spaceId: inviterSession.space.id,
            }),
            SpacesTable.getItem(context, {
                partitionType: "Space",
                sortRangeType: "WelcomePackage",
                spaceId: session.space.id,
            }),
        ]);

        expect(getSearchAffinityEntityPointCalls()).toEqual({
            [session.account.id]: {
                [inviterSession.space.id]: [
                    {entityId: `Channel:${inviterItem.generalChannelId}`, points: 3},
                    {entityId: `Channel:${inviterItem.randomChannelId}`, points: 2.999},
                    {entityId: `Account:${inviterItem.chatGptBotAccountId}`, points: 2.998},
                    {entityId: `Account:${inviterSession.account.id}`, points: 2.997},
                    {entityId: `Account:${invitedSession1.account.id}`, points: 2.996},
                ],
                [session.space.id]: [
                    {entityId: `Channel:${personalItem.generalChannelId}`, points: 3},
                    {entityId: `Channel:${personalItem.randomChannelId}`, points: 2.999},
                    {entityId: `Account:${personalItem.chatGptBotAccountId}`, points: 2.998},
                ],
            },
        });
    });

    test("applies welcome package for fifth account invited to space", async () => {
        const {session: inviterSession} = await testPersonalSignUp();

        const invitedEmailAddress1 = generatePersonalTestEmailAddress();
        await inviterSession.inviteEmailAddress(invitedEmailAddress1);
        const {session: invitedSession1} = await testSignUp({emailAddress: invitedEmailAddress1});
        await acceptSpaceAccountInvite(invitedSession1.action(), inviterSession.space.id);

        const invitedEmailAddress2 = generatePersonalTestEmailAddress();
        await inviterSession.inviteEmailAddress(invitedEmailAddress2);
        const {session: invitedSession2} = await testSignUp({emailAddress: invitedEmailAddress2});
        await acceptSpaceAccountInvite(invitedSession2.action(), inviterSession.space.id);

        const invitedEmailAddress3 = generatePersonalTestEmailAddress();
        await inviterSession.inviteEmailAddress(invitedEmailAddress3);
        const {session: invitedSession3} = await testSignUp({emailAddress: invitedEmailAddress3});
        await acceptSpaceAccountInvite(invitedSession3.action(), inviterSession.space.id);

        addSearchAffinityEntityPoints.mockClear();

        const emailAddress = generatePersonalTestEmailAddress();

        await inviterSession.inviteEmailAddress(emailAddress);

        const {session} = await testSignUp({emailAddress});

        await acceptSpaceAccountInvite(session.action(), inviterSession.space.id);

        const [inviterItem, personalItem] = await runAllPromises([
            SpacesTable.getItem(context, {
                partitionType: "Space",
                sortRangeType: "WelcomePackage",
                spaceId: inviterSession.space.id,
            }),
            SpacesTable.getItem(context, {
                partitionType: "Space",
                sortRangeType: "WelcomePackage",
                spaceId: session.space.id,
            }),
        ]);

        expect(getSearchAffinityEntityPointCalls()).toEqual({
            [session.account.id]: {
                [inviterSession.space.id]: [
                    {entityId: `Channel:${inviterItem.generalChannelId}`, points: 3},
                    {entityId: `Channel:${inviterItem.randomChannelId}`, points: 2.999},
                    {entityId: `Account:${inviterItem.chatGptBotAccountId}`, points: 2.998},
                    {entityId: `Account:${inviterSession.account.id}`, points: 2.997},
                    {entityId: `Account:${invitedSession1.account.id}`, points: 2.996},
                    {entityId: `Account:${invitedSession2.account.id}`, points: 2.995},
                    {entityId: `Account:${invitedSession3.account.id}`, points: 2.994},
                ],
                [session.space.id]: [
                    {entityId: `Channel:${personalItem.generalChannelId}`, points: 3},
                    {entityId: `Channel:${personalItem.randomChannelId}`, points: 2.999},
                    {entityId: `Account:${personalItem.chatGptBotAccountId}`, points: 2.998},
                ],
            },
        });
    });
});

test("work space has auto-add email domain enabled", async () => {
    const {session, emailDomain} = await testWorkSignUp();

    expect(
        await getSpaceAutoAddAccountsFromEmailDomains(session.action(), session.space.id),
    ).toEqual([{emailDomain, isEnabled: true}]);
});

test("personal space has no auto-add email domains", async () => {
    const {session} = await testPersonalSignUp();

    expect(
        await getSpaceAutoAddAccountsFromEmailDomains(session.action(), session.space.id),
    ).toEqual([]);
});

test("work space auto-add email domain can be disabled", async () => {
    const {session, emailDomain} = await testWorkSignUp();

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

    expect(
        await getSpaceAutoAddAccountsFromEmailDomains(session.action(), session.space.id),
    ).toEqual([{emailDomain, isEnabled: false}]);
});

test("cannot get auto-add email domains without space access", async () => {
    const {session: session1} = await testWorkSignUp();
    const {session: session2} = await testPersonalSignUp();

    await expect(
        getSpaceAutoAddAccountsFromEmailDomains(session2.action(), session1.space.id),
    ).rejects.toThrow(PermissionDeniedError);
});
