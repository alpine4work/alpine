import {attemptOneTimePasswordSignIn} from "~/server/accounts/attempt_one_time_password_sign_in.js";
import {captureOneTimePasswordSignInEmailsForTest} from "~/server/accounts/capture_one_time_password_sign_in_emails_for_test.js";
import {saveAccountSignUpProfile} from "~/server/accounts/save_account_sign_up_profile.js";
import {signUpAccountWithEmailAddress} from "~/server/accounts/sign_up_account_with_email_address.js";
import {
    updateOurAccountName,
    updateOurAccountNameBeforeExecuteTestCheckpoint,
} from "~/server/accounts/update_our_account_name.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {acceptSpaceAccountInvite} from "~/server/spaces/accept_space_account_invite.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {backfillTaskActionTransactionHistory} from "~/server/tasks/data/backfill_task_action_transaction_history.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {testTaskClock} from "~/server/tasks/data/test_helpers/test_task_clock.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {validateEmailAddress} from "~/shared/helpers/string/email_address.js";
import {generateId} from "~/shared/id/id.js";

const context = createTestContext({
    spacesInjection,
    tasksInjection,
});

describe("backfillTaskActionTransactionHistory()", () => {
    test("commits an update name action when the account\u2019s name updates", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const newAccountName1 = generateId();
        const newAccountName2 = generateId();

        const startTime = new Date(testTaskClock.now()[0]);

        expect(
            await backfillTaskActionTransactionHistory(space.systemAction(), space.id, startTime),
        ).toEqual([]);

        expect((await session.get()).initialData.name).not.toEqual(newAccountName1);
        expect((await session.get()).initialData.name).not.toEqual(newAccountName2);

        await updateOurAccountName(session.action(), newAccountName1);

        expect((await session.get()).initialData.name).toEqual(newAccountName1);
        expect((await session.get()).initialData.name).not.toEqual(newAccountName2);

        expect(
            await backfillTaskActionTransactionHistory(space.systemAction(), space.id, startTime),
        ).toEqual([
            {
                spaceId: space.id,
                committedTime: expect.any(Date),
                actions: [
                    {
                        type: "UpdateAccountName",
                        time: expect.any(Array),
                        accountId: session.account.id,
                        accountName: newAccountName1,
                        accountNameVersion: 1,
                    },
                ],
            },
        ]);

        await updateOurAccountName(session.action(), newAccountName2);

        expect((await session.get()).initialData.name).not.toEqual(newAccountName1);
        expect((await session.get()).initialData.name).toEqual(newAccountName2);

        expect(
            await backfillTaskActionTransactionHistory(space.systemAction(), space.id, startTime),
        ).toEqual([
            {
                spaceId: space.id,
                committedTime: expect.any(Date),
                actions: [
                    {
                        type: "UpdateAccountName",
                        time: expect.any(Array),
                        accountId: session.account.id,
                        accountName: newAccountName1,
                        accountNameVersion: 1,
                    },
                ],
            },
            {
                spaceId: space.id,
                committedTime: expect.any(Date),
                actions: [
                    {
                        type: "UpdateAccountName",
                        time: expect.any(Array),
                        accountId: session.account.id,
                        accountName: newAccountName2,
                        accountNameVersion: 2,
                    },
                ],
            },
        ]);
    });

    test("doesn\u2019t an update name action when the account is in no spaces", async () => {
        const space = await TestSpace.create(context);
        const session = await TestSession.create(await TestAccount.create(context));

        const newAccountName1 = generateId();
        const newAccountName2 = generateId();

        const startTime = new Date(testTaskClock.now()[0]);

        expect(
            await backfillTaskActionTransactionHistory(space.systemAction(), space.id, startTime),
        ).toEqual([]);

        expect((await session.get()).initialData.name).not.toEqual(newAccountName1);
        expect((await session.get()).initialData.name).not.toEqual(newAccountName2);

        await updateOurAccountName(session.action(), newAccountName1);

        expect((await session.get()).initialData.name).toEqual(newAccountName1);
        expect((await session.get()).initialData.name).not.toEqual(newAccountName2);

        expect(
            await backfillTaskActionTransactionHistory(space.systemAction(), space.id, startTime),
        ).toEqual([]);

        await updateOurAccountName(session.action(), newAccountName2);

        expect((await session.get()).initialData.name).not.toEqual(newAccountName1);
        expect((await session.get()).initialData.name).toEqual(newAccountName2);

        expect(
            await backfillTaskActionTransactionHistory(space.systemAction(), space.id, startTime),
        ).toEqual([]);
    });

    test("commits an update name action when the account\u2019s name updates to every space the account is in during race condition 1", async () => {
        const space = await TestSpace.create(context);
        const session = await TestSession.create(await TestAccount.create(context));

        const newAccountName = generateId();

        const startTime = new Date(testTaskClock.now()[0]);

        expect(
            await backfillTaskActionTransactionHistory(space.systemAction(), space.id, startTime),
        ).toEqual([]);

        expect((await session.get()).initialData.name).not.toEqual(newAccountName);

        const pausePromise = updateOurAccountNameBeforeExecuteTestCheckpoint.pauseForTest(
            session.account.id,
        );

        const updatePromise = updateOurAccountName(session.action(), newAccountName);

        const {unpause} = await pausePromise;

        expect(
            await backfillTaskActionTransactionHistory(space.systemAction(), space.id, startTime),
        ).toEqual([]);

        expect((await session.get()).initialData.name).not.toEqual(newAccountName);

        await space.addAccount(session);

        unpause();
        await updatePromise;

        expect((await session.get()).initialData.name).toEqual(newAccountName);

        expect(
            await backfillTaskActionTransactionHistory(space.systemAction(), space.id, startTime),
        ).toEqual([
            {
                spaceId: space.id,
                committedTime: expect.any(Date),
                actions: [
                    {
                        type: "UpdateAccountName",
                        time: expect.any(Array),
                        accountId: session.account.id,
                        accountName: newAccountName,
                        accountNameVersion: 1,
                    },
                ],
            },
        ]);
    });

    test("commits an update name action when the account\u2019s name updates to every space the account is in during race condition 2", async () => {
        const [space1, space2] = await runAllPromises([
            TestSpace.create(context),
            TestSpace.create(context),
        ]);

        const session = await space1.createSession();

        const newAccountName = generateId();

        const startTime = new Date(testTaskClock.now()[0]);

        expect(
            await backfillTaskActionTransactionHistory(space1.systemAction(), space1.id, startTime),
        ).toEqual([]);
        expect(
            await backfillTaskActionTransactionHistory(space2.systemAction(), space2.id, startTime),
        ).toEqual([]);

        expect((await session.get()).initialData.name).not.toEqual(newAccountName);

        const pausePromise = updateOurAccountNameBeforeExecuteTestCheckpoint.pauseForTest(
            session.account.id,
        );

        const updatePromise = updateOurAccountName(session.action(), newAccountName);

        const {unpause} = await pausePromise;

        expect(
            await backfillTaskActionTransactionHistory(space1.systemAction(), space1.id, startTime),
        ).toEqual([]);
        expect(
            await backfillTaskActionTransactionHistory(space2.systemAction(), space2.id, startTime),
        ).toEqual([]);

        expect((await session.get()).initialData.name).not.toEqual(newAccountName);

        await space2.addAccount(session);

        unpause();
        await updatePromise;

        expect((await session.get()).initialData.name).toEqual(newAccountName);

        expect(
            await backfillTaskActionTransactionHistory(space1.systemAction(), space1.id, startTime),
        ).toEqual([
            {
                spaceId: space1.id,
                committedTime: expect.any(Date),
                actions: [
                    {
                        type: "UpdateAccountName",
                        time: expect.any(Array),
                        accountId: session.account.id,
                        accountName: newAccountName,
                        accountNameVersion: 1,
                    },
                ],
            },
        ]);
        expect(
            await backfillTaskActionTransactionHistory(space2.systemAction(), space2.id, startTime),
        ).toEqual([
            {
                spaceId: space2.id,
                committedTime: expect.any(Date),
                actions: [
                    {
                        type: "UpdateAccountName",
                        time: expect.any(Array),
                        accountId: session.account.id,
                        accountName: newAccountName,
                        accountNameVersion: 1,
                    },
                ],
            },
        ]);
    });

    test("commits an update name action when a new account accepts a space invite", async () => {
        const space = await TestSpace.create(context);
        const admin = await space.createSession({role: "Admin"});
        const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

        const startTime = new Date(testTaskClock.now()[0]);

        const {id: accountId} = await admin.inviteEmailAddress(emailAddress);

        const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
            await signUpAccountWithEmailAddress(context.unknownAnonymousAction(), emailAddress);
        });

        const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

        await saveAccountSignUpProfile(context.withCache(), {
            accountId,
            name: "Anthony Mose",
            reactionCharacter: {type: "Cat", variant: "Grey"},
        });

        const {sessionId} = await attemptOneTimePasswordSignIn(
            context,
            emailAddress,
            oneTimePassword,
            {
                ipAddress: null,
                userAgent: null,
            },
        );

        await acceptSpaceAccountInvite(context.action({sessionId, accountId}), space.id);

        expect(
            await backfillTaskActionTransactionHistory(space.systemAction(), space.id, startTime),
        ).toEqual([
            {
                spaceId: space.id,
                committedTime: expect.any(Date),
                actions: [
                    {
                        type: "UpdateAccountName",
                        time: expect.any(Array),
                        accountId: accountId,
                        accountName: "Anthony Mose",
                        accountNameVersion: 1,
                    },
                ],
            },
        ]);
    });

    test("commits an update name action when an existing account accepts a space invite", async () => {
        const space = await TestSpace.create(context);
        const admin = await space.createSession({role: "Admin"});
        const account = await TestAccount.create(context, {name: "Anthony Mose"});
        const emailAddress = await account.createEmailAddress();
        const {id: accountId} = account;

        const startTime = new Date(testTaskClock.now()[0]);

        await admin.inviteEmailAddress(emailAddress);

        await acceptSpaceAccountInvite((await TestSession.create(account)).action(), space.id);

        expect(
            await backfillTaskActionTransactionHistory(space.systemAction(), space.id, startTime),
        ).toEqual([
            {
                spaceId: space.id,
                committedTime: expect.any(Date),
                actions: [
                    {
                        type: "UpdateAccountName",
                        time: expect.any(Array),
                        accountId: accountId,
                        accountName: "Anthony Mose",
                        accountNameVersion: 0,
                    },
                ],
            },
        ]);
    });
});
