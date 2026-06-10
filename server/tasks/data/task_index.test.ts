import {attemptOneTimePasswordSignIn} from "~/server/accounts/attempt_one_time_password_sign_in.js";
import {captureOneTimePasswordSignInEmailsForTest} from "~/server/accounts/capture_one_time_password_sign_in_emails_for_test.js";
import {saveAccountSignUpProfile} from "~/server/accounts/save_account_sign_up_profile.js";
import {signUpAccountWithEmailAddress} from "~/server/accounts/sign_up_account_with_email_address.js";
import {updateOurAccountName} from "~/server/accounts/update_our_account_name.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {internalGetSearchAffinityEntities} from "~/server/search/data/table/search_entity_actions.js";
import {acceptSpaceAccountInvite} from "~/server/spaces/accept_space_account_invite.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {
    getTaskIndexDocIfExistsForTest,
    indexTaskActionTransactionAfterUpdateTestCheckpoint,
    indexTaskActionTransactionAssumingItsCommittedForTest,
    indexTaskActionTransactionBeforeUpdateTestCheckpoint,
    indexTaskUpdateAccountNameActionAfterUpdateTestCheckpoint,
    indexTaskUpdateAccountNameActionBeforeUpdateTestCheckpoint,
} from "~/server/tasks/data/task_index.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {testTaskClock} from "~/server/tasks/data/test_helpers/test_task_clock.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {FailedPreconditionError, PermissionDeniedError} from "~/shared/error/error.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {HybridLogicalClock} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {validateEmailAddress} from "~/shared/helpers/string/email_address.js";
import {generateId} from "~/shared/id/id.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {wordTaskTitleTestScenario} from "~/shared/tasks/test_helpers/task_title_test_scenarios.js";

const context = createTestContext({
    shouldStartOpensearch: true,
    spacesInjection,
    tasksInjection,
});

const clock = new HybridLogicalClock(unsynchronizedSystemClock);

test("can\u2019t update task from a different space", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session1 = await space.createSession();

    const taskId = generateId<TaskId>();

    await indexTaskActionTransactionAssumingItsCommittedForTest(
        context.systemAction(space.id),
        space.id,
        null,
        [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ],
    );

    await expect(
        indexTaskActionTransactionAssumingItsCommittedForTest(
            context.systemAction(otherSpace.id),
            otherSpace.id,
            null,
            [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                },
            ],
        ),
    ).rejects.toThrow(new FailedPreconditionError("Space mismatch"));

    await expect(
        indexTaskActionTransactionAssumingItsCommittedForTest(
            context.systemAction(otherSpace.id),
            space.id,
            null,
            [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                },
            ],
        ),
    ).rejects.toThrow(PermissionDeniedError);

    await indexTaskActionTransactionAssumingItsCommittedForTest(
        context.systemAction(space.id),
        space.id,
        null,
        [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: wordTaskTitleTestScenario.update0,
                },
            },
        ],
    );
});

test("can\u2019t update collection from a different space", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);

    const collectionId = generateId<TaskCollectionId>();

    await indexTaskActionTransactionAssumingItsCommittedForTest(
        context.systemAction(space.id),
        space.id,
        null,
        [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: null,
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map(),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ],
    );

    await expect(
        indexTaskActionTransactionAssumingItsCommittedForTest(
            context.systemAction(otherSpace.id),
            otherSpace.id,
            null,
            [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "UpdateName",
                        name: "New Collection Name",
                    },
                },
            ],
        ),
    ).rejects.toThrow(new FailedPreconditionError("Space mismatch"));

    await expect(
        indexTaskActionTransactionAssumingItsCommittedForTest(
            context.systemAction(otherSpace.id),
            space.id,
            null,
            [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "UpdateName",
                        name: "New Collection Name",
                    },
                },
            ],
        ),
    ).rejects.toThrow(PermissionDeniedError);

    await indexTaskActionTransactionAssumingItsCommittedForTest(
        context.systemAction(space.id),
        space.id,
        null,
        [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "UpdateName",
                    name: "New Collection Name",
                },
            },
        ],
    );
});

test("inlines creator account name in index", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const [task1, task2, task3] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session2),
    ]);

    expect(session1.account.initialName).not.toEqual(session2.account.initialName);

    expect((await task1.getIndexDoc()).creator.workingAccountName).toEqual(
        session1.account.initialName,
    );
    expect((await task1.getIndexDoc()).creator.workingAccountNameVersion).toEqual(0);

    expect((await task2.getIndexDoc()).creator.workingAccountName).toEqual(
        session1.account.initialName,
    );
    expect((await task2.getIndexDoc()).creator.workingAccountNameVersion).toEqual(0);

    expect((await task3.getIndexDoc()).creator.workingAccountName).toEqual(
        session2.account.initialName,
    );
    expect((await task3.getIndexDoc()).creator.workingAccountNameVersion).toEqual(0);
});

test("inlines closer account name in index", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const [task1, task2, task3] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session2),
    ]);

    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
    await task2.addCollection(session1, collection);

    expect(session1.account.initialName).not.toEqual(session2.account.initialName);

    expect((await task1.getIndexDoc()).status.value).toEqual({type: "Open"});
    expect((await task2.getIndexDoc()).status.value).toEqual({type: "Open"});
    expect((await task3.getIndexDoc()).status.value).toEqual({type: "Open"});

    await task1.updateStatus(session1, "Closed");
    await task2.updateStatus(session2, "Closed");
    await task3.updateStatus(session2, "Closed");

    expect((await task1.getIndexDoc()).status.value).toEqual({
        type: "Closed",
        closer: {
            accountId: session1.account.id,
            workingAccountName: session1.account.initialName,
            workingAccountNameVersion: 0,
        },
        closedTime: expect.any(TaskFilterableTime),
    });
    expect((await task2.getIndexDoc()).status.value).toEqual({
        type: "Closed",
        closer: {
            accountId: session2.account.id,
            workingAccountName: session2.account.initialName,
            workingAccountNameVersion: 0,
        },
        closedTime: expect.any(TaskFilterableTime),
    });
    expect((await task3.getIndexDoc()).status.value).toEqual({
        type: "Closed",
        closer: {
            accountId: session2.account.id,
            workingAccountName: session2.account.initialName,
            workingAccountNameVersion: 0,
        },
        closedTime: expect.any(TaskFilterableTime),
    });

    await task2.updateStatus(session1, "Closed");

    expect((await task1.getIndexDoc()).status.value).toEqual({
        type: "Closed",
        closer: {
            accountId: session1.account.id,
            workingAccountName: session1.account.initialName,
            workingAccountNameVersion: 0,
        },
        closedTime: expect.any(TaskFilterableTime),
    });
    expect((await task2.getIndexDoc()).status.value).toEqual({
        type: "Closed",
        closer: {
            accountId: session1.account.id,
            workingAccountName: session1.account.initialName,
            workingAccountNameVersion: 0,
        },
        closedTime: expect.any(TaskFilterableTime),
    });
    expect((await task3.getIndexDoc()).status.value).toEqual({
        type: "Closed",
        closer: {
            accountId: session2.account.id,
            workingAccountName: session2.account.initialName,
            workingAccountNameVersion: 0,
        },
        closedTime: expect.any(TaskFilterableTime),
    });
});

test("inlines assigner and assignee account names in index", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const [task1, task2, task3] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session2),
    ]);

    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
    await task2.addCollection(session1, collection);

    expect(session1.account.initialName).not.toEqual(session2.account.initialName);

    expect((await task1.getIndexDoc()).assignee.value).toEqual(null);
    expect((await task2.getIndexDoc()).assignee.value).toEqual(null);
    expect((await task3.getIndexDoc()).assignee.value).toEqual(null);

    await task1.updateAssignee(session1, session1);
    await task2.updateAssignee(session1, session2);
    await task3.updateAssignee(session2, session2);

    expect((await task1.getIndexDoc()).assignee.value).toEqual({
        assignee: {
            accountId: session1.account.id,
            workingAccountName: session1.account.initialName,
            workingAccountNameVersion: 0,
        },
        assigner: {
            accountId: session1.account.id,
            workingAccountName: session1.account.initialName,
            workingAccountNameVersion: 0,
        },
        assignedTime: expect.any(TaskFilterableTime),
    });
    expect((await task2.getIndexDoc()).assignee.value).toEqual({
        assignee: {
            accountId: session2.account.id,
            workingAccountName: session2.account.initialName,
            workingAccountNameVersion: 0,
        },
        assigner: {
            accountId: session1.account.id,
            workingAccountName: session1.account.initialName,
            workingAccountNameVersion: 0,
        },
        assignedTime: expect.any(TaskFilterableTime),
    });
    expect((await task3.getIndexDoc()).assignee.value).toEqual({
        assignee: {
            accountId: session2.account.id,
            workingAccountName: session2.account.initialName,
            workingAccountNameVersion: 0,
        },
        assigner: {
            accountId: session2.account.id,
            workingAccountName: session2.account.initialName,
            workingAccountNameVersion: 0,
        },
        assignedTime: expect.any(TaskFilterableTime),
    });

    await task2.updateAssignee(session2, session1);

    expect((await task1.getIndexDoc()).assignee.value).toEqual({
        assignee: {
            accountId: session1.account.id,
            workingAccountName: session1.account.initialName,
            workingAccountNameVersion: 0,
        },
        assigner: {
            accountId: session1.account.id,
            workingAccountName: session1.account.initialName,
            workingAccountNameVersion: 0,
        },
        assignedTime: expect.any(TaskFilterableTime),
    });
    expect((await task2.getIndexDoc()).assignee.value).toEqual({
        assignee: {
            accountId: session1.account.id,
            workingAccountName: session1.account.initialName,
            workingAccountNameVersion: 0,
        },
        assigner: {
            accountId: session2.account.id,
            workingAccountName: session2.account.initialName,
            workingAccountNameVersion: 0,
        },
        assignedTime: expect.any(TaskFilterableTime),
    });
    expect((await task3.getIndexDoc()).assignee.value).toEqual({
        assignee: {
            accountId: session2.account.id,
            workingAccountName: session2.account.initialName,
            workingAccountNameVersion: 0,
        },
        assigner: {
            accountId: session2.account.id,
            workingAccountName: session2.account.initialName,
            workingAccountNameVersion: 0,
        },
        assignedTime: expect.any(TaskFilterableTime),
    });
});

test("updating account name updates inlined creator account name in index", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const [task1, task2, task3] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session2),
    ]);

    await task2.delete(session1);

    const newAccountName1 = generateId();
    const newAccountName2 = generateId();

    expect(session1.account.initialName).not.toEqual(session2.account.initialName);
    expect(session1.account.initialName).not.toEqual(newAccountName1);
    expect(session1.account.initialName).not.toEqual(newAccountName2);

    expect((await task1.getIndexDoc()).creator.workingAccountName).toEqual(
        session1.account.initialName,
    );
    expect((await task1.getIndexDoc()).creator.workingAccountNameVersion).toEqual(0);

    expect((await task2.getIndexDoc()).creator.workingAccountName).toEqual(
        session1.account.initialName,
    );
    expect((await task2.getIndexDoc()).creator.workingAccountNameVersion).toEqual(0);

    expect((await task3.getIndexDoc()).creator.workingAccountName).toEqual(
        session2.account.initialName,
    );
    expect((await task3.getIndexDoc()).creator.workingAccountNameVersion).toEqual(0);

    await updateOurAccountName(session1.action(), newAccountName1);

    expect((await task1.getIndexDoc()).creator.workingAccountName).toEqual(newAccountName1);
    expect((await task1.getIndexDoc()).creator.workingAccountNameVersion).toEqual(1);

    expect((await task2.getIndexDoc()).creator.workingAccountName).toEqual(newAccountName1);
    expect((await task2.getIndexDoc()).creator.workingAccountNameVersion).toEqual(1);

    expect((await task3.getIndexDoc()).creator.workingAccountName).toEqual(
        session2.account.initialName,
    );
    expect((await task3.getIndexDoc()).creator.workingAccountNameVersion).toEqual(0);

    await updateOurAccountName(session1.action(), newAccountName2);

    expect((await task1.getIndexDoc()).creator.workingAccountName).toEqual(newAccountName2);
    expect((await task1.getIndexDoc()).creator.workingAccountNameVersion).toEqual(2);

    expect((await task2.getIndexDoc()).creator.workingAccountName).toEqual(newAccountName2);
    expect((await task2.getIndexDoc()).creator.workingAccountNameVersion).toEqual(2);

    expect((await task3.getIndexDoc()).creator.workingAccountName).toEqual(
        session2.account.initialName,
    );
    expect((await task3.getIndexDoc()).creator.workingAccountNameVersion).toEqual(0);
});

test("updating account name updates inlined closer account name in index", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const [task1, task2, task3, task4] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session2),
        TestTask.create(session2),
    ]);

    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
    await task2.addCollection(session1, collection);

    const newAccountName1 = generateId();
    const newAccountName2 = generateId();

    expect(session1.account.initialName).not.toEqual(session2.account.initialName);
    expect(session2.account.initialName).not.toEqual(newAccountName1);
    expect(session2.account.initialName).not.toEqual(newAccountName2);

    expect((await task1.getIndexDoc()).status.value).toEqual({type: "Open"});
    expect((await task2.getIndexDoc()).status.value).toEqual({type: "Open"});
    expect((await task3.getIndexDoc()).status.value).toEqual({type: "Open"});
    expect((await task4.getIndexDoc()).status.value).toEqual({type: "Open"});

    await task1.updateStatus(session1, "Closed");
    await task2.updateStatus(session2, "Closed");
    await task3.updateStatus(session2, "Closed");
    await task4.updateStatus(session2, "Closed");

    await task4.delete(session2);

    expect((await task1.getIndexDoc()).status.value).toEqual({
        type: "Closed",
        closer: {
            accountId: session1.account.id,
            workingAccountName: session1.account.initialName,
            workingAccountNameVersion: 0,
        },
        closedTime: expect.any(TaskFilterableTime),
    });
    expect((await task2.getIndexDoc()).status.value).toEqual({
        type: "Closed",
        closer: {
            accountId: session2.account.id,
            workingAccountName: session2.account.initialName,
            workingAccountNameVersion: 0,
        },
        closedTime: expect.any(TaskFilterableTime),
    });
    expect((await task3.getIndexDoc()).status.value).toEqual({
        type: "Closed",
        closer: {
            accountId: session2.account.id,
            workingAccountName: session2.account.initialName,
            workingAccountNameVersion: 0,
        },
        closedTime: expect.any(TaskFilterableTime),
    });
    expect((await task4.getIndexDoc()).status.value).toEqual({
        type: "Closed",
        closer: {
            accountId: session2.account.id,
            workingAccountName: session2.account.initialName,
            workingAccountNameVersion: 0,
        },
        closedTime: expect.any(TaskFilterableTime),
    });

    await updateOurAccountName(session2.action(), newAccountName1);

    expect((await task1.getIndexDoc()).status.value).toEqual({
        type: "Closed",
        closer: {
            accountId: session1.account.id,
            workingAccountName: session1.account.initialName,
            workingAccountNameVersion: 0,
        },
        closedTime: expect.any(TaskFilterableTime),
    });
    expect((await task2.getIndexDoc()).status.value).toEqual({
        type: "Closed",
        closer: {
            accountId: session2.account.id,
            workingAccountName: newAccountName1,
            workingAccountNameVersion: 1,
        },
        closedTime: expect.any(TaskFilterableTime),
    });
    expect((await task3.getIndexDoc()).status.value).toEqual({
        type: "Closed",
        closer: {
            accountId: session2.account.id,
            workingAccountName: newAccountName1,
            workingAccountNameVersion: 1,
        },
        closedTime: expect.any(TaskFilterableTime),
    });
    expect((await task4.getIndexDoc()).status.value).toEqual({
        type: "Closed",
        closer: {
            accountId: session2.account.id,
            workingAccountName: newAccountName1,
            workingAccountNameVersion: 1,
        },
        closedTime: expect.any(TaskFilterableTime),
    });

    await updateOurAccountName(session2.action(), newAccountName2);

    expect((await task1.getIndexDoc()).status.value).toEqual({
        type: "Closed",
        closer: {
            accountId: session1.account.id,
            workingAccountName: session1.account.initialName,
            workingAccountNameVersion: 0,
        },
        closedTime: expect.any(TaskFilterableTime),
    });
    expect((await task2.getIndexDoc()).status.value).toEqual({
        type: "Closed",
        closer: {
            accountId: session2.account.id,
            workingAccountName: newAccountName2,
            workingAccountNameVersion: 2,
        },
        closedTime: expect.any(TaskFilterableTime),
    });
    expect((await task3.getIndexDoc()).status.value).toEqual({
        type: "Closed",
        closer: {
            accountId: session2.account.id,
            workingAccountName: newAccountName2,
            workingAccountNameVersion: 2,
        },
        closedTime: expect.any(TaskFilterableTime),
    });
    expect((await task4.getIndexDoc()).status.value).toEqual({
        type: "Closed",
        closer: {
            accountId: session2.account.id,
            workingAccountName: newAccountName2,
            workingAccountNameVersion: 2,
        },
        closedTime: expect.any(TaskFilterableTime),
    });
});

test("processing account name update action only updates one space", async () => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);
    const account = await TestAccount.create(context);

    const session1 = await space1.createSession(account);
    const session2 = await space2.createSession(account);

    const [task1, task2, task3, task4] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session2),
        TestTask.create(session2),
    ]);

    await task2.delete(session1);

    const newAccountName1 = generateId();
    const newAccountName2 = generateId();

    expect(session1.account.id).toEqual(session2.account.id);
    expect(session1.account.initialName).toEqual(session2.account.initialName);
    expect(session1.account.initialName).not.toEqual(newAccountName1);
    expect(session1.account.initialName).not.toEqual(newAccountName2);

    expect((await task1.getIndexDoc()).creator).toEqual({
        accountId: account.id,
        from: null,
        workingAccountName: account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task2.getIndexDoc()).creator).toEqual({
        accountId: account.id,
        from: null,
        workingAccountName: account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task3.getIndexDoc()).creator).toEqual({
        accountId: account.id,
        from: null,
        workingAccountName: account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task4.getIndexDoc()).creator).toEqual({
        accountId: account.id,
        from: null,
        workingAccountName: account.initialName,
        workingAccountNameVersion: 0,
    });

    await indexTaskActionTransactionAssumingItsCommittedForTest(
        space1.systemAction(),
        space1.id,
        null,
        [
            {
                type: "UpdateAccountName",
                time: testTaskClock.now(),
                accountId: account.id,
                accountName: newAccountName1,
                accountNameVersion: 1,
            },
        ],
    );

    expect((await task1.getIndexDoc()).creator).toEqual({
        accountId: account.id,
        from: null,
        workingAccountName: newAccountName1,
        workingAccountNameVersion: 1,
    });
    expect((await task2.getIndexDoc()).creator).toEqual({
        accountId: account.id,
        from: null,
        workingAccountName: newAccountName1,
        workingAccountNameVersion: 1,
    });
    expect((await task3.getIndexDoc()).creator).toEqual({
        accountId: account.id,
        from: null,
        workingAccountName: account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task4.getIndexDoc()).creator).toEqual({
        accountId: account.id,
        from: null,
        workingAccountName: account.initialName,
        workingAccountNameVersion: 0,
    });

    await indexTaskActionTransactionAssumingItsCommittedForTest(
        space2.systemAction(),
        space2.id,
        null,
        [
            {
                type: "UpdateAccountName",
                time: testTaskClock.now(),
                accountId: account.id,
                accountName: newAccountName2,
                accountNameVersion: 2,
            },
        ],
    );

    expect((await task1.getIndexDoc()).creator).toEqual({
        accountId: account.id,
        from: null,
        workingAccountName: newAccountName1,
        workingAccountNameVersion: 1,
    });
    expect((await task2.getIndexDoc()).creator).toEqual({
        accountId: account.id,
        from: null,
        workingAccountName: newAccountName1,
        workingAccountNameVersion: 1,
    });
    expect((await task3.getIndexDoc()).creator).toEqual({
        accountId: account.id,
        from: null,
        workingAccountName: newAccountName2,
        workingAccountNameVersion: 2,
    });
    expect((await task4.getIndexDoc()).creator).toEqual({
        accountId: account.id,
        from: null,
        workingAccountName: newAccountName2,
        workingAccountNameVersion: 2,
    });

    await indexTaskActionTransactionAssumingItsCommittedForTest(
        space1.systemAction(),
        space1.id,
        null,
        [
            {
                type: "UpdateAccountName",
                time: testTaskClock.now(),
                accountId: account.id,
                accountName: newAccountName2,
                accountNameVersion: 2,
            },
        ],
    );

    expect((await task1.getIndexDoc()).creator).toEqual({
        accountId: account.id,
        from: null,
        workingAccountName: newAccountName2,
        workingAccountNameVersion: 2,
    });
    expect((await task2.getIndexDoc()).creator).toEqual({
        accountId: account.id,
        from: null,
        workingAccountName: newAccountName2,
        workingAccountNameVersion: 2,
    });
    expect((await task3.getIndexDoc()).creator).toEqual({
        accountId: account.id,
        from: null,
        workingAccountName: newAccountName2,
        workingAccountNameVersion: 2,
    });
    expect((await task4.getIndexDoc()).creator).toEqual({
        accountId: account.id,
        from: null,
        workingAccountName: newAccountName2,
        workingAccountNameVersion: 2,
    });

    await indexTaskActionTransactionAssumingItsCommittedForTest(
        space2.systemAction(),
        space2.id,
        null,
        [
            {
                type: "UpdateAccountName",
                time: testTaskClock.now(),
                accountId: account.id,
                accountName: newAccountName1,
                accountNameVersion: 1,
            },
        ],
    );

    expect((await task1.getIndexDoc()).creator).toEqual({
        accountId: account.id,
        from: null,
        workingAccountName: newAccountName2,
        workingAccountNameVersion: 2,
    });
    expect((await task2.getIndexDoc()).creator).toEqual({
        accountId: account.id,
        from: null,
        workingAccountName: newAccountName2,
        workingAccountNameVersion: 2,
    });
    expect((await task3.getIndexDoc()).creator).toEqual({
        accountId: account.id,
        from: null,
        workingAccountName: newAccountName2,
        workingAccountNameVersion: 2,
    });
    expect((await task4.getIndexDoc()).creator).toEqual({
        accountId: account.id,
        from: null,
        workingAccountName: newAccountName2,
        workingAccountNameVersion: 2,
    });
});

test("updating account name updates inlined assigner and assignee account names in index", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const [task1, task2, task3, task4] = await runAllPromises([
        TestTask.create(session1),
        TestTask.create(session1),
        TestTask.create(session2),
        TestTask.create(session2),
    ]);

    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);
    await task2.addCollection(session1, collection);
    await task3.addCollection(session2, collection);

    const newAccountName1 = generateId();
    const newAccountName2 = generateId();

    expect(session1.account.initialName).not.toEqual(session2.account.initialName);
    expect(session2.account.initialName).not.toEqual(newAccountName1);
    expect(session2.account.initialName).not.toEqual(newAccountName2);

    expect((await task1.getIndexDoc()).assignee.value).toEqual(null);
    expect((await task2.getIndexDoc()).assignee.value).toEqual(null);
    expect((await task3.getIndexDoc()).assignee.value).toEqual(null);

    await task1.updateAssignee(session1, session1);
    await task2.updateAssignee(session1, session2);
    await task3.updateAssignee(session2, session1);
    await task4.updateAssignee(session2, session2);

    expect((await task1.getIndexDoc()).assignee.value).toEqual({
        assignee: {
            accountId: session1.account.id,
            workingAccountName: session1.account.initialName,
            workingAccountNameVersion: 0,
        },
        assigner: {
            accountId: session1.account.id,
            workingAccountName: session1.account.initialName,
            workingAccountNameVersion: 0,
        },
        assignedTime: expect.any(TaskFilterableTime),
    });
    expect((await task2.getIndexDoc()).assignee.value).toEqual({
        assignee: {
            accountId: session2.account.id,
            workingAccountName: session2.account.initialName,
            workingAccountNameVersion: 0,
        },
        assigner: {
            accountId: session1.account.id,
            workingAccountName: session1.account.initialName,
            workingAccountNameVersion: 0,
        },
        assignedTime: expect.any(TaskFilterableTime),
    });
    expect((await task3.getIndexDoc()).assignee.value).toEqual({
        assignee: {
            accountId: session1.account.id,
            workingAccountName: session1.account.initialName,
            workingAccountNameVersion: 0,
        },
        assigner: {
            accountId: session2.account.id,
            workingAccountName: session2.account.initialName,
            workingAccountNameVersion: 0,
        },
        assignedTime: expect.any(TaskFilterableTime),
    });
    expect((await task4.getIndexDoc()).assignee.value).toEqual({
        assignee: {
            accountId: session2.account.id,
            workingAccountName: session2.account.initialName,
            workingAccountNameVersion: 0,
        },
        assigner: {
            accountId: session2.account.id,
            workingAccountName: session2.account.initialName,
            workingAccountNameVersion: 0,
        },
        assignedTime: expect.any(TaskFilterableTime),
    });

    await updateOurAccountName(session2.action(), newAccountName1);

    expect((await task1.getIndexDoc()).assignee.value).toEqual({
        assignee: {
            accountId: session1.account.id,
            workingAccountName: session1.account.initialName,
            workingAccountNameVersion: 0,
        },
        assigner: {
            accountId: session1.account.id,
            workingAccountName: session1.account.initialName,
            workingAccountNameVersion: 0,
        },
        assignedTime: expect.any(TaskFilterableTime),
    });
    expect((await task2.getIndexDoc()).assignee.value).toEqual({
        assignee: {
            accountId: session2.account.id,
            workingAccountName: newAccountName1,
            workingAccountNameVersion: 1,
        },
        assigner: {
            accountId: session1.account.id,
            workingAccountName: session1.account.initialName,
            workingAccountNameVersion: 0,
        },
        assignedTime: expect.any(TaskFilterableTime),
    });
    expect((await task3.getIndexDoc()).assignee.value).toEqual({
        assignee: {
            accountId: session1.account.id,
            workingAccountName: session1.account.initialName,
            workingAccountNameVersion: 0,
        },
        assigner: {
            accountId: session2.account.id,
            workingAccountName: newAccountName1,
            workingAccountNameVersion: 1,
        },
        assignedTime: expect.any(TaskFilterableTime),
    });
    expect((await task4.getIndexDoc()).assignee.value).toEqual({
        assignee: {
            accountId: session2.account.id,
            workingAccountName: newAccountName1,
            workingAccountNameVersion: 1,
        },
        assigner: {
            accountId: session2.account.id,
            workingAccountName: newAccountName1,
            workingAccountNameVersion: 1,
        },
        assignedTime: expect.any(TaskFilterableTime),
    });

    await updateOurAccountName(session2.action(), newAccountName2);

    expect((await task1.getIndexDoc()).assignee.value).toEqual({
        assignee: {
            accountId: session1.account.id,
            workingAccountName: session1.account.initialName,
            workingAccountNameVersion: 0,
        },
        assigner: {
            accountId: session1.account.id,
            workingAccountName: session1.account.initialName,
            workingAccountNameVersion: 0,
        },
        assignedTime: expect.any(TaskFilterableTime),
    });
    expect((await task2.getIndexDoc()).assignee.value).toEqual({
        assignee: {
            accountId: session2.account.id,
            workingAccountName: newAccountName2,
            workingAccountNameVersion: 2,
        },
        assigner: {
            accountId: session1.account.id,
            workingAccountName: session1.account.initialName,
            workingAccountNameVersion: 0,
        },
        assignedTime: expect.any(TaskFilterableTime),
    });
    expect((await task3.getIndexDoc()).assignee.value).toEqual({
        assignee: {
            accountId: session1.account.id,
            workingAccountName: session1.account.initialName,
            workingAccountNameVersion: 0,
        },
        assigner: {
            accountId: session2.account.id,
            workingAccountName: newAccountName2,
            workingAccountNameVersion: 2,
        },
        assignedTime: expect.any(TaskFilterableTime),
    });
    expect((await task4.getIndexDoc()).assignee.value).toEqual({
        assignee: {
            accountId: session2.account.id,
            workingAccountName: newAccountName2,
            workingAccountNameVersion: 2,
        },
        assigner: {
            accountId: session2.account.id,
            workingAccountName: newAccountName2,
            workingAccountNameVersion: 2,
        },
        assignedTime: expect.any(TaskFilterableTime),
    });
});

test("accepting invite for new account updates inlined assignee account name in index", async () => {
    const space = await TestSpace.create(context);
    const admin = await space.createSession({role: "Admin"});
    const emailAddress = validateEmailAddress(`test.${generateId()}@test.cyberworlds.dev`);

    const {id: accountId} = await admin.inviteEmailAddress(emailAddress);

    const task = await TestTask.create(admin);
    await task.updateAssignee(admin, accountId);

    expect((await task.getIndexDoc()).assignee.value).toMatchObject({
        assignee: {
            accountId: accountId,
            workingAccountName: emailAddress.slice(0, 50),
            workingAccountNameVersion: -1,
        },
    });

    const oneTimePasswordEmails = await captureOneTimePasswordSignInEmailsForTest(async () => {
        await signUpAccountWithEmailAddress(context.unknownAnonymousAction(), emailAddress);
    });

    const oneTimePassword = oneTimePasswordEmails[0]!.oneTimePassword;

    await saveAccountSignUpProfile(context.withCache(), {
        accountId,
        name: "Anthony Mose",
        reactionCharacter: {type: "Cat", variant: "Grey"},
    });

    const {sessionId} = await attemptOneTimePasswordSignIn(context, emailAddress, oneTimePassword, {
        ipAddress: null,
        userAgent: null,
    });

    await acceptSpaceAccountInvite(context.action({sessionId, accountId}), space.id);

    expect((await task.getIndexDoc()).assignee.value).toMatchObject({
        assignee: {
            accountId: accountId,
            workingAccountName: "Anthony Mose",
            workingAccountNameVersion: 1,
        },
    });
});

test("accepting invite for existing account updates inlined assignee account name in index", async () => {
    const space = await TestSpace.create(context);
    const admin = await space.createSession({role: "Admin"});
    const account = await TestAccount.create(context, {name: "Anthony Mose"});
    const emailAddress = await account.createEmailAddress();
    const {id: accountId} = account;

    await admin.inviteEmailAddress(emailAddress);

    const task = await TestTask.create(admin);
    await task.updateAssignee(admin, accountId);

    expect((await task.getIndexDoc()).assignee.value).toMatchObject({
        assignee: {
            accountId: accountId,
            workingAccountName: emailAddress.slice(0, 50),
            workingAccountNameVersion: -1,
        },
    });

    await acceptSpaceAccountInvite((await TestSession.create(account)).action(), space.id);

    expect((await task.getIndexDoc()).assignee.value).toMatchObject({
        assignee: {
            accountId: accountId,
            workingAccountName: "Anthony Mose",
            workingAccountNameVersion: 0,
        },
    });
});

test("if account name updates during indexing it will still be correctly updated in creator", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const newAccountName = generateId();

    expect(session.account.initialName).not.toEqual(newAccountName);

    const pausePromise1 = indexTaskActionTransactionBeforeUpdateTestCheckpoint.pauseForTest(
        space.id,
    );

    const task = await TestTask.create(session);
    const {unpause} = await pausePromise1;

    const pausePromise2 = indexTaskUpdateAccountNameActionAfterUpdateTestCheckpoint.pauseForTest(
        session.account.id,
    );
    await updateOurAccountName(session.action(), newAccountName);
    (await pausePromise2).unpause();

    expect(await getTaskIndexDocIfExistsForTest(context, space.id, task.id)).toEqual(null);

    unpause();

    expect((await task.getIndexDoc()).creator).toEqual({
        accountId: session.account.id,
        from: null,
        workingAccountName: newAccountName,
        workingAccountNameVersion: 1,
    });
});

test("if account name updates during indexing it will still be correctly update in closer", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session);

    const newAccountName = generateId();

    expect(session.account.initialName).not.toEqual(newAccountName);

    expect((await task.getIndexDoc()).creator).toEqual({
        accountId: session.account.id,
        from: null,
        workingAccountName: session.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task.getIndexDoc()).status.value).toEqual({type: "Open"});

    const pausePromise1 = indexTaskActionTransactionBeforeUpdateTestCheckpoint.pauseForTest(
        space.id,
    );

    await task.updateStatus(session, "Closed");
    const {unpause} = await pausePromise1;

    const pausePromise2 = indexTaskUpdateAccountNameActionAfterUpdateTestCheckpoint.pauseForTest(
        session.account.id,
    );
    await updateOurAccountName(session.action(), newAccountName);
    (await pausePromise2).unpause();

    expect((await getTaskIndexDocIfExistsForTest(context, space.id, task.id))?.creator).toEqual({
        accountId: session.account.id,
        from: null,
        workingAccountName: newAccountName,
        workingAccountNameVersion: 1,
    });
    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task.id))?.status.value,
    ).toEqual({type: "Open"});

    unpause();

    expect((await task.getIndexDoc()).creator).toEqual({
        accountId: session.account.id,
        from: null,
        workingAccountName: newAccountName,
        workingAccountNameVersion: 1,
    });
    expect((await task.getIndexDoc()).status.value).toEqual({
        type: "Closed",
        closer: {
            accountId: session.account.id,
            workingAccountName: newAccountName,
            workingAccountNameVersion: 1,
        },
        closedTime: expect.any(TaskFilterableTime),
    });
});

test("if account name updates during indexing it will still be correctly update in assignee and assigner", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);

    const task = await TestTask.create(session1);
    await task.addCollection(session1, collection);
    await task.updateAssignee(session1, session2);

    const newAccountName1 = generateId();
    const newAccountName2 = generateId();

    expect(session1.account.initialName).not.toEqual(session2.account.initialName);
    expect(session1.account.initialName).not.toEqual(newAccountName1);
    expect(session1.account.initialName).not.toEqual(newAccountName2);

    expect((await task.getIndexDoc()).creator).toEqual({
        accountId: session1.account.id,
        from: null,
        workingAccountName: session1.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task.getIndexDoc()).assignee.value).toEqual({
        assignee: {
            accountId: session2.account.id,
            workingAccountName: session2.account.initialName,
            workingAccountNameVersion: 0,
        },
        assigner: {
            accountId: session1.account.id,
            workingAccountName: session1.account.initialName,
            workingAccountNameVersion: 0,
        },
        assignedTime: expect.any(TaskFilterableTime),
    });

    const pausePromise1 = indexTaskActionTransactionBeforeUpdateTestCheckpoint.pauseForTest(
        space.id,
    );

    await task.updateAssignee(session2, session1);
    const {unpause} = await pausePromise1;

    const pausePromise2 = indexTaskUpdateAccountNameActionAfterUpdateTestCheckpoint.pauseForTest(
        session1.account.id,
    );
    await updateOurAccountName(session1.action(), newAccountName1);
    (await pausePromise2).unpause();

    const pausePromise3 = indexTaskUpdateAccountNameActionAfterUpdateTestCheckpoint.pauseForTest(
        session2.account.id,
    );
    await updateOurAccountName(session2.action(), newAccountName2);
    (await pausePromise3).unpause();

    expect((await getTaskIndexDocIfExistsForTest(context, space.id, task.id))?.creator).toEqual({
        accountId: session1.account.id,
        from: null,
        workingAccountName: newAccountName1,
        workingAccountNameVersion: 1,
    });
    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task.id))?.assignee.value,
    ).toEqual({
        assignee: {
            accountId: session2.account.id,
            workingAccountName: newAccountName2,
            workingAccountNameVersion: 1,
        },
        assigner: {
            accountId: session1.account.id,
            workingAccountName: newAccountName1,
            workingAccountNameVersion: 1,
        },
        assignedTime: expect.any(TaskFilterableTime),
    });

    unpause();

    expect((await task.getIndexDoc()).creator).toEqual({
        accountId: session1.account.id,
        from: null,
        workingAccountName: newAccountName1,
        workingAccountNameVersion: 1,
    });
    expect((await task.getIndexDoc()).assignee.value).toEqual({
        assignee: {
            accountId: session1.account.id,
            workingAccountName: newAccountName1,
            workingAccountNameVersion: 1,
        },
        assigner: {
            accountId: session2.account.id,
            workingAccountName: newAccountName2,
            workingAccountNameVersion: 1,
        },
        assignedTime: expect.any(TaskFilterableTime),
    });
});

test("account name update will still work when there\u2019s a version conflict", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const task = await TestTask.create(session);

    const newAccountName = generateId();

    expect(session.account.initialName).not.toEqual(newAccountName);

    expect((await task.getIndexDoc()).creator).toEqual({
        accountId: session.account.id,
        from: null,
        workingAccountName: session.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect((await task.getIndexDoc()).status.value).toEqual({type: "Open"});

    const pausePromise1 = indexTaskUpdateAccountNameActionBeforeUpdateTestCheckpoint.pauseForTest(
        session.account.id,
    );

    await updateOurAccountName(session.action(), newAccountName);

    const {unpause} = await pausePromise1;

    const pausePromise2 = indexTaskActionTransactionAfterUpdateTestCheckpoint.pauseForTest(
        space.id,
    );
    await task.updateStatus(session, "Closed");
    (await pausePromise2).unpause();

    expect((await getTaskIndexDocIfExistsForTest(context, space.id, task.id))?.creator).toEqual({
        accountId: session.account.id,
        from: null,
        workingAccountName: session.account.initialName,
        workingAccountNameVersion: 0,
    });
    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task.id))?.status.value,
    ).toEqual({
        type: "Closed",
        closer: {
            accountId: session.account.id,
            workingAccountName: newAccountName,
            workingAccountNameVersion: 1,
        },
        closedTime: expect.any(TaskFilterableTime),
    });

    unpause();
    await ProcessContextModule.waitForTestTasks();

    expect((await getTaskIndexDocIfExistsForTest(context, space.id, task.id))?.creator).toEqual({
        accountId: session.account.id,
        from: null,
        workingAccountName: newAccountName,
        workingAccountNameVersion: 1,
    });
    expect(
        (await getTaskIndexDocIfExistsForTest(context, space.id, task.id))?.status.value,
    ).toEqual({
        type: "Closed",
        closer: {
            accountId: session.account.id,
            workingAccountName: newAccountName,
            workingAccountNameVersion: 1,
        },
        closedTime: expect.any(TaskFilterableTime),
    });
});

test("updates approximate action counts", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const session3 = await space.createSession();

    const task1 = await TestTask.create(session1);
    const task2 = await TestTask.create(session2);
    const task3 = await TestTask.create(session2, {title: "Hello, world!"});

    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);

    await ProcessContextModule.waitForTestTasks();

    expect((await task1.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([[session1.account.id, {discreteActionCount: 1, continuousActionCount: 0}]]),
    );
    expect((await task2.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([[session2.account.id, {discreteActionCount: 1, continuousActionCount: 0}]]),
    );
    expect((await task3.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([[session2.account.id, {discreteActionCount: 1, continuousActionCount: 1}]]),
    );

    await task3.addCollection(session2, collection);
    await ProcessContextModule.waitForTestTasks();

    expect((await task1.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([[session1.account.id, {discreteActionCount: 1, continuousActionCount: 0}]]),
    );
    expect((await task2.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([[session2.account.id, {discreteActionCount: 1, continuousActionCount: 0}]]),
    );
    expect((await task3.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([[session2.account.id, {discreteActionCount: 2, continuousActionCount: 1}]]),
    );

    await task3.updatePriority(session3, "High");
    await ProcessContextModule.waitForTestTasks();

    expect((await task1.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([[session1.account.id, {discreteActionCount: 1, continuousActionCount: 0}]]),
    );
    expect((await task2.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([[session2.account.id, {discreteActionCount: 1, continuousActionCount: 0}]]),
    );
    expect((await task3.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([
            [session2.account.id, {discreteActionCount: 2, continuousActionCount: 1}],
            [session3.account.id, {discreteActionCount: 1, continuousActionCount: 0}],
        ]),
    );

    const time1 = testTaskClock.now();
    const time2 = testTaskClock.now();

    await task3.updatePriority(session3, "Low", {time: time2});
    await ProcessContextModule.waitForTestTasks();

    expect((await task1.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([[session1.account.id, {discreteActionCount: 1, continuousActionCount: 0}]]),
    );
    expect((await task2.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([[session2.account.id, {discreteActionCount: 1, continuousActionCount: 0}]]),
    );
    expect((await task3.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([
            [session2.account.id, {discreteActionCount: 2, continuousActionCount: 1}],
            [session3.account.id, {discreteActionCount: 2, continuousActionCount: 0}],
        ]),
    );

    await task3.updatePriority(session1, "Low", {time: time2});
    await ProcessContextModule.waitForTestTasks();

    expect((await task1.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([[session1.account.id, {discreteActionCount: 1, continuousActionCount: 0}]]),
    );
    expect((await task2.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([[session2.account.id, {discreteActionCount: 1, continuousActionCount: 0}]]),
    );
    expect((await task3.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([
            [session2.account.id, {discreteActionCount: 2, continuousActionCount: 1}],
            [session3.account.id, {discreteActionCount: 2, continuousActionCount: 0}],
        ]),
    );

    await task3.updatePriority(session3, "Medium", {time: time1});
    await ProcessContextModule.waitForTestTasks();

    expect((await task1.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([[session1.account.id, {discreteActionCount: 1, continuousActionCount: 0}]]),
    );
    expect((await task2.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([[session2.account.id, {discreteActionCount: 1, continuousActionCount: 0}]]),
    );
    expect((await task3.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([
            [session2.account.id, {discreteActionCount: 2, continuousActionCount: 1}],
            [session3.account.id, {discreteActionCount: 2, continuousActionCount: 0}],
        ]),
    );

    await task3.updatePriority(session1, "Medium");
    await ProcessContextModule.waitForTestTasks();

    expect((await task1.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([[session1.account.id, {discreteActionCount: 1, continuousActionCount: 0}]]),
    );
    expect((await task2.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([[session2.account.id, {discreteActionCount: 1, continuousActionCount: 0}]]),
    );
    expect((await task3.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([
            [session2.account.id, {discreteActionCount: 2, continuousActionCount: 1}],
            [session3.account.id, {discreteActionCount: 2, continuousActionCount: 0}],
            [session1.account.id, {discreteActionCount: 1, continuousActionCount: 0}],
        ]),
    );

    await task1.updateAssignee(session1, session3);
    await ProcessContextModule.waitForTestTasks();

    expect((await task1.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([[session1.account.id, {discreteActionCount: 2, continuousActionCount: 0}]]),
    );
    expect((await task2.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([[session2.account.id, {discreteActionCount: 1, continuousActionCount: 0}]]),
    );
    expect((await task3.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([
            [session2.account.id, {discreteActionCount: 2, continuousActionCount: 1}],
            [session3.account.id, {discreteActionCount: 2, continuousActionCount: 0}],
            [session1.account.id, {discreteActionCount: 1, continuousActionCount: 0}],
        ]),
    );

    await task1.updateTitle(session3, wordTaskTitleTestScenario.update0);
    await ProcessContextModule.waitForTestTasks();

    expect((await task1.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([
            [session1.account.id, {discreteActionCount: 2, continuousActionCount: 0}],
            [session3.account.id, {discreteActionCount: 0, continuousActionCount: 1}],
        ]),
    );
    expect((await task2.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([[session2.account.id, {discreteActionCount: 1, continuousActionCount: 0}]]),
    );
    expect((await task3.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([
            [session2.account.id, {discreteActionCount: 2, continuousActionCount: 1}],
            [session3.account.id, {discreteActionCount: 2, continuousActionCount: 0}],
            [session1.account.id, {discreteActionCount: 1, continuousActionCount: 0}],
        ]),
    );

    await task1.updateTitle(session3, wordTaskTitleTestScenario.update1);
    await ProcessContextModule.waitForTestTasks();

    expect((await task1.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([
            [session1.account.id, {discreteActionCount: 2, continuousActionCount: 0}],
            [session3.account.id, {discreteActionCount: 0, continuousActionCount: 2}],
        ]),
    );
    expect((await task2.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([[session2.account.id, {discreteActionCount: 1, continuousActionCount: 0}]]),
    );
    expect((await task3.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([
            [session2.account.id, {discreteActionCount: 2, continuousActionCount: 1}],
            [session3.account.id, {discreteActionCount: 2, continuousActionCount: 0}],
            [session1.account.id, {discreteActionCount: 1, continuousActionCount: 0}],
        ]),
    );

    await task1.updateTitle(session1, wordTaskTitleTestScenario.update2);
    await ProcessContextModule.waitForTestTasks();

    expect((await task1.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([
            [session1.account.id, {discreteActionCount: 2, continuousActionCount: 1}],
            [session3.account.id, {discreteActionCount: 0, continuousActionCount: 2}],
        ]),
    );
    expect((await task2.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([[session2.account.id, {discreteActionCount: 1, continuousActionCount: 0}]]),
    );
    expect((await task3.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([
            [session2.account.id, {discreteActionCount: 2, continuousActionCount: 1}],
            [session3.account.id, {discreteActionCount: 2, continuousActionCount: 0}],
            [session1.account.id, {discreteActionCount: 1, continuousActionCount: 0}],
        ]),
    );

    await task1.updateTitle(session1, wordTaskTitleTestScenario.update2);
    await ProcessContextModule.waitForTestTasks();

    expect((await task1.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([
            [session1.account.id, {discreteActionCount: 2, continuousActionCount: 1}],
            [session3.account.id, {discreteActionCount: 0, continuousActionCount: 2}],
        ]),
    );
    expect((await task2.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([[session2.account.id, {discreteActionCount: 1, continuousActionCount: 0}]]),
    );
    expect((await task3.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([
            [session2.account.id, {discreteActionCount: 2, continuousActionCount: 1}],
            [session3.account.id, {discreteActionCount: 2, continuousActionCount: 0}],
            [session1.account.id, {discreteActionCount: 1, continuousActionCount: 0}],
        ]),
    );

    await task1.updateTitle(session3, wordTaskTitleTestScenario.update3);
    await ProcessContextModule.waitForTestTasks();

    expect((await task1.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([
            [session1.account.id, {discreteActionCount: 2, continuousActionCount: 1}],
            [session3.account.id, {discreteActionCount: 0, continuousActionCount: 3}],
        ]),
    );
    expect((await task2.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([[session2.account.id, {discreteActionCount: 1, continuousActionCount: 0}]]),
    );
    expect((await task3.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([
            [session2.account.id, {discreteActionCount: 2, continuousActionCount: 1}],
            [session3.account.id, {discreteActionCount: 2, continuousActionCount: 0}],
            [session1.account.id, {discreteActionCount: 1, continuousActionCount: 0}],
        ]),
    );

    await updateOurAccountName(session2.action(), "Foo Bar");
    await ProcessContextModule.waitForTestTasks();

    expect((await task1.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([
            [session1.account.id, {discreteActionCount: 2, continuousActionCount: 1}],
            [session3.account.id, {discreteActionCount: 0, continuousActionCount: 3}],
        ]),
    );
    expect((await task2.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([[session2.account.id, {discreteActionCount: 1, continuousActionCount: 0}]]),
    );
    expect((await task3.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([
            [session2.account.id, {discreteActionCount: 2, continuousActionCount: 1}],
            [session3.account.id, {discreteActionCount: 2, continuousActionCount: 0}],
            [session1.account.id, {discreteActionCount: 1, continuousActionCount: 0}],
        ]),
    );

    await task3.updateParentTask(session2, task2);
    await ProcessContextModule.waitForTestTasks();

    expect((await task1.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([
            [session1.account.id, {discreteActionCount: 2, continuousActionCount: 1}],
            [session3.account.id, {discreteActionCount: 0, continuousActionCount: 3}],
        ]),
    );
    expect((await task2.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([[session2.account.id, {discreteActionCount: 1, continuousActionCount: 0}]]),
    );
    expect((await task3.getIndexDocWithVersion()).approximateActionCountByAccountId.get()).toEqual(
        new Map([
            [session2.account.id, {discreteActionCount: 3, continuousActionCount: 1}],
            [session3.account.id, {discreteActionCount: 2, continuousActionCount: 0}],
            [session1.account.id, {discreteActionCount: 1, continuousActionCount: 0}],
        ]),
    );
});

test("updates search affinity points for task when it\u2019s marked as active", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const task = await TestTask.create(session1);

    const getTaskSearchAffinityPoints = async (session: TestSpaceSession) => {
        const affinities = await internalGetSearchAffinityEntities(session.action(), {
            spaceId: space.id,
            limit: 10,
        });

        return affinities.find(affinity => affinity.entityId === `Task:${task.id}`)?.points ?? null;
    };

    expect(await getTaskSearchAffinityPoints(session1)).toEqual(null);
    expect(await getTaskSearchAffinityPoints(session2)).toEqual(null);

    await task.updateAssigneeStatus(session1, "Active");
    await ProcessContextModule.waitForTestTasks();

    expect(await getTaskSearchAffinityPoints(session1)).toEqual(null);
    expect(await getTaskSearchAffinityPoints(session2)).toEqual(null);

    await task.updateAssignee(session1, session1);
    await ProcessContextModule.waitForTestTasks();

    expect(await getTaskSearchAffinityPoints(session1)).toEqual(null);
    expect(await getTaskSearchAffinityPoints(session2)).toEqual(null);

    await task.updateAssigneeStatus(session1, "Active");
    await ProcessContextModule.waitForTestTasks();

    expect(await getTaskSearchAffinityPoints(session1)).toBeCloseTo(150);
    expect(await getTaskSearchAffinityPoints(session2)).toEqual(null);

    await task.updateAssigneeStatus(session1, "Inactive");
    await ProcessContextModule.waitForTestTasks();

    expect(await getTaskSearchAffinityPoints(session1)).toEqual(null);
    expect(await getTaskSearchAffinityPoints(session2)).toEqual(null);

    await task.updateAssigneeStatus(session1, "Active");
    await ProcessContextModule.waitForTestTasks();

    expect(await getTaskSearchAffinityPoints(session1)).toBeCloseTo(150);
    expect(await getTaskSearchAffinityPoints(session2)).toEqual(null);

    await task.updateAssignee(session1, session2);
    await ProcessContextModule.waitForTestTasks();

    expect(await getTaskSearchAffinityPoints(session1)).toEqual(null);
    expect(await getTaskSearchAffinityPoints(session2)).toEqual(null);

    // Intentionally using `session1` as the actor here to test updating affinity on
    // another account's behalf.
    await task.updateAssigneeStatus(session1, "Active");
    await ProcessContextModule.waitForTestTasks();

    expect(await getTaskSearchAffinityPoints(session1)).toEqual(null);
    expect(await getTaskSearchAffinityPoints(session2)).toBeCloseTo(150);

    await task.updateAssigneeStatus(session2, "Inactive");
    await ProcessContextModule.waitForTestTasks();

    expect(await getTaskSearchAffinityPoints(session1)).toEqual(null);
    expect(await getTaskSearchAffinityPoints(session2)).toEqual(null);

    await task.updateAssigneeStatus(session2, "Active");
    await ProcessContextModule.waitForTestTasks();

    expect(await getTaskSearchAffinityPoints(session1)).toEqual(null);
    expect(await getTaskSearchAffinityPoints(session2)).toBeCloseTo(150);

    await task.updateAssignee(session1, session1, {assigneeStatus: "Active"});
    await ProcessContextModule.waitForTestTasks();

    expect(await getTaskSearchAffinityPoints(session1)).toBeCloseTo(150);
    expect(await getTaskSearchAffinityPoints(session2)).toEqual(null);

    await task.delete(session1);
    await ProcessContextModule.waitForTestTasks();

    expect(await getTaskSearchAffinityPoints(session1)).toEqual(null);
    expect(await getTaskSearchAffinityPoints(session2)).toEqual(null);

    await task.undelete(session1);
    await ProcessContextModule.waitForTestTasks();

    expect(await getTaskSearchAffinityPoints(session1)).toBeCloseTo(150);
    expect(await getTaskSearchAffinityPoints(session2)).toEqual(null);
});

test("adds search affinity points for task collection when it\u2019s added to a task", async () => {
    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();

    const task1 = await TestTask.create(session1);
    const task2 = await TestTask.create(session2);
    const task3 = await TestTask.create(session1);

    const collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);

    await ProcessContextModule.waitForTestTasks();

    const getTaskCollectionSearchAffinityPoints = async (session: TestSpaceSession) => {
        const affinities = await internalGetSearchAffinityEntities(session.action(), {
            spaceId: space.id,
            limit: 10,
        });

        return (
            affinities.find(affinity => affinity.entityId === `TaskCollection:${collection.id}`)
                ?.points ?? null
        );
    };

    expect(await getTaskCollectionSearchAffinityPoints(session1)).toBeCloseTo(3);
    expect(await getTaskCollectionSearchAffinityPoints(session2)).toEqual(null);

    await task1.addCollection(session1, collection);
    await ProcessContextModule.waitForTestTasks();

    expect(await getTaskCollectionSearchAffinityPoints(session1)).toBeCloseTo(3.2);
    expect(await getTaskCollectionSearchAffinityPoints(session2)).toEqual(null);

    await task2.addCollection(session2, collection);
    await ProcessContextModule.waitForTestTasks();

    expect(await getTaskCollectionSearchAffinityPoints(session1)).toBeCloseTo(3.2);
    expect(await getTaskCollectionSearchAffinityPoints(session2)).toBeCloseTo(0.2);

    await task3.addCollection(session1, collection);
    await ProcessContextModule.waitForTestTasks();

    expect(await getTaskCollectionSearchAffinityPoints(session1)).toBeCloseTo(3.4);
    expect(await getTaskCollectionSearchAffinityPoints(session2)).toBeCloseTo(0.2);
});

test("updating account name updates inlined creator account name of 100+ tasks in index", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const tasks = await runAllPromises(createArrayWithLength(250, () => TestTask.create(session1)));

    await ProcessContextModule.waitForTestTasks();

    const newAccountName = generateId();

    expect(session1.account.initialName).not.toEqual(session2.account.initialName);
    expect(session1.account.initialName).not.toEqual(newAccountName);

    expect(
        await runAllPromises(
            tasks.map(async task => {
                const taskIndexDoc = await task.getIndexDoc();
                return {
                    workingAccountName: taskIndexDoc.creator.workingAccountName,
                    workingAccountNameVersion: taskIndexDoc.creator.workingAccountNameVersion,
                };
            }),
        ),
    ).toEqual(
        createArrayWithLength(250, () => ({
            workingAccountName: session1.account.initialName,
            workingAccountNameVersion: 0,
        })),
    );

    await updateOurAccountName(session1.action(), newAccountName);

    await ProcessContextModule.waitForTestTasks();

    expect(
        await runAllPromises(
            tasks.map(async task => {
                const taskIndexDoc = await task.getIndexDoc();
                return {
                    workingAccountName: taskIndexDoc.creator.workingAccountName,
                    workingAccountNameVersion: taskIndexDoc.creator.workingAccountNameVersion,
                };
            }),
        ),
    ).toEqual(
        createArrayWithLength(250, () => ({
            workingAccountName: newAccountName,
            workingAccountNameVersion: 1,
        })),
    );
});
