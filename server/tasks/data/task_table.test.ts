import {CalendarDate} from "@internationalized/date";
import {addHours} from "date-fns";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    TestSessionItem,
    createTestSession,
} from "~/server/dynamo/test_helpers/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/create_test_space.js";
import {JobDescription} from "~/server/jobs/core/job_description.js";
import {addSpaceAccountForTest} from "~/server/spaces/create_space_for_test.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {commitTaskActionTransaction} from "~/server/tasks/data/commit_task_action_transaction.js";
import {commitTaskActionTransactionBeforeExecuteTestCheckpoint} from "~/server/tasks/data/commit_task_action_transaction_before_execute_test_checkpoint.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {AccessLevel} from "~/shared/access/access_policy.js";
import {
    FailedPreconditionError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {
    HybridLogicalClock,
    HybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {assertOrderKey, initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {wordTaskTitleTestScenario} from "~/shared/tasks/test_helpers/task_title_test_scenarios.js";

let jobs: Array<JobDescription> = [];

afterEach(() => {
    jobs = [];
});

const context = createTestContext({
    spacesInjection,
    tasksInjection,
    processJob: async (context, job) => {
        jobs.push(job);
    },
});

// Old style tests shadow the `context` variable and add some modules.
const baseContext = context;

describe("old style", () => {
    const context = baseContext;

    const space = createTestSpace(context);
    const session1 = createTestSession(context, space);
    const session2 = createTestSession(context, space);
    const session3 = createTestSession(context, space);
    const otherSpace = createTestSpace(context);
    const otherSession = createTestSession(context, otherSpace);
    const sharedSession = createTestSession(context, space);

    beforeAll(async () => {
        await addSpaceAccountForTest(context, {
            spaceId: otherSpace.id,
            accountId: sharedSession.accountId,
        });
    });

    const taskAccount1 = {
        accountId: session1.accountId,
        workingAccountName: session1.account.initialData.name,
        workingAccountNameVersion: session1.account.initialData.nameVersion,
    };

    const taskAccount2 = {
        accountId: session2.accountId,
        workingAccountName: session2.account.initialData.name,
        workingAccountNameVersion: session2.account.initialData.nameVersion,
    };

    const clock = new HybridLogicalClock(unsynchronizedSystemClock);

    function getCurrentTaskTime() {
        return new TaskFilterableTime({
            absoluteTime: clock.now(),
            setterTimeZone: defaultTimeZone,
        });
    }

    function getUnreasonableTime(): HybridLogicalTime {
        return [addHours(new Date(clock.now()[0]), 1).getTime(), 0];
    }

    function getUnreasonableTaskTime() {
        return new TaskFilterableTime({
            absoluteTime: getUnreasonableTime(),
            setterTimeZone: defaultTimeZone,
        });
    }

    async function createPublicTask(
        session: TestSessionItem,
        spaceId: SpaceId,
        level: AccessLevel = "Edit",
    ) {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session), spaceId, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: level === "Manage" ? {level, generation: 0} : {level},
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        return {taskId, collectionId};
    }

    test("can create a task", async () => {
        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: generateId(),
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);
    });

    test("can\u2019t create task in space you don\u2019t have access to", async () => {
        await expect(
            commitTaskActionTransaction(context.action(session1), otherSpace.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: generateId(),
                    taskAction: {
                        type: "Create",
                        creator: {accountId: session1.accountId, from: null},
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can\u2019t create a task twice", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "Create",
                        creator: {accountId: session1.accountId, from: null},
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("can\u2019t create a task with the wrong account as the creator", async () => {
        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: getUnreasonableTime(),
                    taskId: generateId(),
                    taskAction: {
                        type: "Create",
                        creator: {accountId: session1.accountId, from: null},
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).rejects.toThrow(InvalidArgumentError);
    });

    test("can delete a task", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Delete",
                },
            },
        ]);
    });

    test("can\u2019t delete a task that doesn\u2019t exist", async () => {
        const taskId = generateId<TaskId>();

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "Delete",
                    },
                },
            ]),
        ).rejects.toThrow(NotFoundError);
    });

    test("can\u2019t delete a task twice", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Delete",
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "Delete",
                    },
                },
            ]),
        ).rejects.toThrow("Task was deleted");
    });

    test("can\u2019t delete a task with the same time as task creation", async () => {
        const taskId = generateId<TaskId>();

        const createdTime = clock.now();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: createdTime,
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: createdTime,
                    taskId,
                    taskAction: {
                        type: "Delete",
                    },
                },
            ]),
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("can\u2019t delete a task with a time earlier than task creation", async () => {
        const taskId = generateId<TaskId>();

        const deletedTime = clock.now();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: deletedTime,
                    taskId,
                    taskAction: {
                        type: "Delete",
                    },
                },
            ]),
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("can\u2019t delete a task with an unreasonable time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: getUnreasonableTime(),
                    taskId,
                    taskAction: {
                        type: "Delete",
                    },
                },
            ]),
        ).rejects.toThrow(InvalidArgumentError);
    });

    test("can\u2019t delete a task that\u2019s not yours", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "Delete",
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can delete a task that\u2019s in a collection you specifically can edit", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Delete",
                },
            },
        ]);
    });

    test("can\u2019t delete a task that\u2019s only in a collection you specifically can view", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            [taskAccount2.accountId, {level: "View"}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "Delete",
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can delete a task that\u2019s in a collection you can edit by default", async () => {
        const {taskId} = await createPublicTask(session1, space.id);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Delete",
                },
            },
        ]);
    });

    test("can\u2019t delete a task that\u2019s only in a collection you can view by default", async () => {
        const {taskId} = await createPublicTask(session1, space.id, "View");

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "Delete",
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can\u2019t delete a task that\u2019s only in a collection space accounts can edit by default if you\u2019re from a different space", async () => {
        const {taskId} = await createPublicTask(session1, space.id);

        await expect(
            commitTaskActionTransaction(context.action(otherSession), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "Delete",
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can undelete a task", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Delete",
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Undelete",
                },
            },
        ]);
    });

    test("can undelete a task twice if there\u2019s another delete", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Delete",
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Undelete",
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Delete",
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Undelete",
                },
            },
        ]);
    });

    test("can undelete a task twice if there\u2019s another delete in one transaction", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Delete",
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Undelete",
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Delete",
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Undelete",
                },
            },
        ]);
    });

    test("can\u2019t undelete a task twice", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Delete",
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Undelete",
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "Undelete",
                    },
                },
            ]),
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("can\u2019t a task that doesn\u2019t exist", async () => {
        const taskId = generateId<TaskId>();

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "Undelete",
                    },
                },
            ]),
        ).rejects.toThrow(NotFoundError);
    });

    test("can\u2019t undelete a task with the same time as the deletion time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        const deletedTime = clock.now();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: deletedTime,
                taskId,
                taskAction: {
                    type: "Delete",
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: deletedTime,
                    taskId,
                    taskAction: {
                        type: "Undelete",
                    },
                },
            ]),
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("can\u2019t undelete a task with a time before the deletion time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        const undeletedTime = clock.now();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Delete",
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: undeletedTime,
                    taskId,
                    taskAction: {
                        type: "Undelete",
                    },
                },
            ]),
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("can\u2019t undelete a task with an unreasonable time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Delete",
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: getUnreasonableTime(),
                    taskId,
                    taskAction: {
                        type: "Undelete",
                    },
                },
            ]),
        ).rejects.toThrow(InvalidArgumentError);
    });

    test("can\u2019t undelete a task that isn\u2019t yours", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Delete",
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "Undelete",
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can\u2019t undelete a task in a collection you don\u2019t have edit access to", async () => {
        const {taskId} = await createPublicTask(session1, space.id, "View");

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Delete",
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "Undelete",
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can undelete a task in a collection you have edit access to", async () => {
        const {taskId} = await createPublicTask(session1, space.id);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Delete",
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Undelete",
                },
            },
        ]);
    });

    test("can update a task\u2019s title", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: wordTaskTitleTestScenario.update0,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: wordTaskTitleTestScenario.update1,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: wordTaskTitleTestScenario.update2,
                },
            },
        ]);
    });

    test("can update a task\u2019s title in any order", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: wordTaskTitleTestScenario.update1,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: wordTaskTitleTestScenario.update2,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: wordTaskTitleTestScenario.update0,
                },
            },
        ]);
    });

    test("can\u2019t update a task title for a task that doesn\u2019t exist", async () => {
        const taskId = generateId<TaskId>();

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                },
            ]),
        ).rejects.toThrow(NotFoundError);
    });

    test("can\u2019t update a deleted task\u2019s title", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Delete",
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                },
            ]),
        ).rejects.toThrow("Task was deleted");
    });

    test("can\u2019t update a task title that\u2019s not yours", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can update a task\u2019s title that\u2019s in a collection you can edit", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: wordTaskTitleTestScenario.update0,
                },
            },
        ]);
    });

    test("can\u2019t update a task\u2019s title that\u2019s only in a collection you specifically can view", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            [taskAccount2.accountId, {level: "View"}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can add a task to a collection", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);
    });

    test("can\u2019t add a task you don\u2019t have access to to a collection", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session2.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount2.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collectionId,
                        orderKey: assertOrderKey("a0"),
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can\u2019t add a task to a collection you don\u2019t have access to", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session2.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount2.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collectionId,
                        orderKey: assertOrderKey("a0"),
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can add a task that\u2019s not yours to a collection", async () => {
        const taskId = generateId<TaskId>();
        const collectionId1 = generateId<TaskCollectionId>();
        const collectionId2 = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId: collectionId1,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session2.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount2.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId: collectionId2,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId2,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId1,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);
    });

    test("can\u2019t add a task to a collection you don\u2019t have edit access to", async () => {
        const taskId = generateId<TaskId>();
        const collectionId1 = generateId<TaskCollectionId>();
        const collectionId2 = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId: collectionId1,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            [taskAccount2.accountId, {level: "View"}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId: collectionId2,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId2,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collectionId1,
                        orderKey: assertOrderKey("a0"),
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId1,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);
    });

    test("can\u2019t add a task to a collection with an unreasonable update time", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: getUnreasonableTime(),
                    taskId,
                    taskAction: {
                        type: "AddCollection",
                        collectionId: collectionId,
                        orderKey: assertOrderKey("a0"),
                    },
                },
            ]),
        ).rejects.toThrow(InvalidArgumentError);
    });

    test("can delete a task from a collection", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "RemoveCollection",
                    collectionId: collectionId,
                },
            },
        ]);
    });

    test("can\u2019t delete a task from a collection with an unreasonable time", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: getUnreasonableTime(),
                    taskId,
                    taskAction: {
                        type: "RemoveCollection",
                        collectionId: collectionId,
                    },
                },
            ]),
        ).rejects.toThrow(InvalidArgumentError);
    });

    test("can\u2019t delete a task from a collection you don\u2019t have access to", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "RemoveCollection",
                        collectionId: collectionId,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can\u2019t delete a task from a collection you don\u2019t have edit access to", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            [taskAccount2.accountId, {level: "View"}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "RemoveCollection",
                        collectionId: collectionId,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can delete a task from a collection you have edit access to", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "RemoveCollection",
                    collectionId: collectionId,
                },
            },
        ]);
    });

    test("can create a collection", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);
    });

    test("can\u2019t create a collection with no creator", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
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
                            accountGrantById: new Map([
                                [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            ]),
                            defaultGrant: null,
                            urlGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "Task collection creator must exactly match the task action transaction actor",
            ),
        );
    });

    test("can\u2019t create a collection with the wrong creator", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "Create",
                        creator: {accountId: session2.account.id, from: null},
                        name: "Test",
                        accessPolicy: {
                            type: "Local",
                            accountGrantById: new Map([
                                [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            ]),
                            defaultGrant: null,
                            urlGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can\u2019t create a collection twice", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "Create",
                        creator: {accountId: session1.account.id, from: null},
                        name: "Test",
                        accessPolicy: {
                            type: "Local",
                            accountGrantById: new Map([
                                [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            ]),
                            defaultGrant: null,
                            urlGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("can\u2019t create a collection with the wrong account in access policy", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "Create",
                        creator: {accountId: session1.account.id, from: null},
                        name: "Test",
                        accessPolicy: {
                            type: "Local",
                            accountGrantById: new Map([
                                [taskAccount2.accountId, {level: "Manage", generation: 0}],
                            ]),
                            defaultGrant: null,
                            urlGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow(
            new InvalidArgumentError(
                "Account actor must have `Manage` access level on anything they create",
            ),
        );
    });

    test("can\u2019t create a collection with an unreasonable created time", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: getUnreasonableTime(),
                    collectionId,
                    collectionAction: {
                        type: "Create",
                        creator: {accountId: session1.account.id, from: null},
                        name: "Test",
                        accessPolicy: {
                            type: "Local",
                            accountGrantById: new Map([
                                [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            ]),
                            defaultGrant: null,
                            urlGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow(InvalidArgumentError);
    });

    test("can\u2019t create a collection without our account as a manager", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "Create",
                        creator: {accountId: session1.account.id, from: null},
                        name: "Test",
                        accessPolicy: {
                            type: "Local",
                            accountGrantById: new Map([]),
                            defaultGrant: null,
                            urlGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow(InvalidArgumentError);
    });

    test("can delete a collection", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Delete",
                },
            },
        ]);
    });

    test("can\u2019t delete a collection that doesn\u2019t exist", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "Delete",
                    },
                },
            ]),
        ).rejects.toThrow(NotFoundError);
    });

    test("can\u2019t delete a collection twice", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Delete",
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "Delete",
                    },
                },
            ]),
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("can\u2019t delete a collection with the created time", async () => {
        const collectionId = generateId<TaskCollectionId>();

        const createdTime = clock.now();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: createdTime,
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: createdTime,
                    collectionId,
                    collectionAction: {
                        type: "Delete",
                    },
                },
            ]),
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("can\u2019t delete a collection with a time before the created time", async () => {
        const collectionId = generateId<TaskCollectionId>();

        const deletedTime = clock.now();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: deletedTime,
                    collectionId,
                    collectionAction: {
                        type: "Delete",
                    },
                },
            ]),
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("can\u2019t delete a collection with an unreasonable deleted time", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: getUnreasonableTime(),
                    collectionId,
                    collectionAction: {
                        type: "Delete",
                    },
                },
            ]),
        ).rejects.toThrow(InvalidArgumentError);
    });

    test("can\u2019t delete a collection you don\u2019t have access to", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "Delete",
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can\u2019t delete a collection you only have access to as an editor", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "Delete",
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can delete a collection you have access to as a manager", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            [taskAccount2.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Delete",
                },
            },
        ]);
    });

    test("can undelete a collection", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Delete",
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Undelete",
                },
            },
        ]);
    });

    test("can\u2019t undelete a collection that doesn\u2019t exist", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "Undelete",
                    },
                },
            ]),
        ).rejects.toThrow(NotFoundError);
    });

    test("can undelete a collection twice if there\u2019s another delete", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Delete",
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Undelete",
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Delete",
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Undelete",
                },
            },
        ]);
    });

    test("can undelete a collection twice if there\u2019s another delete in one transaction", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Delete",
                },
            },
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Undelete",
                },
            },
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Delete",
                },
            },
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Undelete",
                },
            },
        ]);
    });

    test("can\u2019t undelete a collection twice", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Delete",
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Undelete",
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "Undelete",
                    },
                },
            ]),
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("can\u2019t undelete a collection with the deleted time", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        const deletedTime = clock.now();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: deletedTime,
                collectionId,
                collectionAction: {
                    type: "Delete",
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: deletedTime,
                    collectionId,
                    collectionAction: {
                        type: "Undelete",
                    },
                },
            ]),
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("can\u2019t undelete a collection a time before the deleted time", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        const undeletedTime = clock.now();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Delete",
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: undeletedTime,
                    collectionId,
                    collectionAction: {
                        type: "Undelete",
                    },
                },
            ]),
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("can\u2019t undelete a collection with an unreasonable time", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Delete",
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: getUnreasonableTime(),
                    collectionId,
                    collectionAction: {
                        type: "Undelete",
                    },
                },
            ]),
        ).rejects.toThrow(InvalidArgumentError);
    });

    test("can\u2019t undelete a collection you don\u2019t have access to", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Delete",
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "Undelete",
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can\u2019t undelete a collection you only have access to as an editor", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Delete",
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "Undelete",
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can undelete a collection you have access to as a manager", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            [taskAccount2.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Delete",
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Undelete",
                },
            },
        ]);
    });

    test("can update a collection\u2019s name", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "UpdateName",
                    name: "test2",
                },
            },
        ]);
    });

    test("can\u2019t update a collection name for a collection that doesn\u2019t exist", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "UpdateName",
                        name: "test2",
                    },
                },
            ]),
        ).rejects.toThrow(NotFoundError);
    });

    test("can\u2019t update a deleted collection\u2019s name", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Delete",
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "UpdateName",
                        name: "test2",
                    },
                },
            ]),
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("can\u2019t update a collection name that\u2019s not yours", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "UpdateName",
                        name: "test2",
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can\u2019t update a collection name with an unreasonable time", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: getUnreasonableTime(),
                    collectionId,
                    collectionAction: {
                        type: "UpdateName",
                        name: "test2",
                    },
                },
            ]),
        ).rejects.toThrow(InvalidArgumentError);
    });

    test("can\u2019t update a collection name you don\u2019t have access to", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "UpdateName",
                        name: "test2",
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can\u2019t update a collection name you only have access to as an editor", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "UpdateName",
                        name: "test2",
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can update a collection name you have access to as a manager", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            [taskAccount2.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "UpdateName",
                    name: "test2",
                },
            },
        ]);
    });

    test("can update a collection\u2019s color", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "UpdateColor",
                    color: "purple",
                },
            },
        ]);
    });

    test("can\u2019t update a collection color for a collection that doesn\u2019t exist", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "UpdateColor",
                        color: "purple",
                    },
                },
            ]),
        ).rejects.toThrow(NotFoundError);
    });

    test("can\u2019t update a deleted collection\u2019s color", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Delete",
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "UpdateColor",
                        color: "purple",
                    },
                },
            ]),
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("can\u2019t update a collection color that\u2019s not yours", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "UpdateColor",
                        color: "purple",
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can\u2019t update a collection color with an unreasonable time", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: getUnreasonableTime(),
                    collectionId,
                    collectionAction: {
                        type: "UpdateColor",
                        color: "purple",
                    },
                },
            ]),
        ).rejects.toThrow(InvalidArgumentError);
    });

    test("can\u2019t update a collection color you don\u2019t have access to", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "UpdateColor",
                        color: "purple",
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can\u2019t update a collection color you only have access to as an editor", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "UpdateColor",
                        color: "purple",
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can update a collection color you have access to as a manager", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            [taskAccount2.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "UpdateColor",
                    color: "purple",
                },
            },
        ]);
    });

    test("can update a collection\u2019s access policy", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage", generation: 0}],
                            [session3.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);
    });

    test("can\u2019t update a collection access policy for a collection that doesn\u2019t exist", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "UpdateAccessPolicy",
                        accessPolicy: {
                            type: "Local",
                            accountGrantById: new Map([
                                [session1.accountId, {level: "Manage", generation: 0}],
                                [session3.accountId, {level: "Edit"}],
                            ]),
                            defaultGrant: null,
                            urlGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow(NotFoundError);
    });

    test("can\u2019t update a deleted collection\u2019s access policy", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Delete",
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "UpdateAccessPolicy",
                        accessPolicy: {
                            type: "Local",
                            accountGrantById: new Map([
                                [session1.accountId, {level: "Manage", generation: 0}],
                                [session3.accountId, {level: "Edit"}],
                            ]),
                            defaultGrant: null,
                            urlGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("can\u2019t update a collection access policy that\u2019s not yours", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "UpdateAccessPolicy",
                        accessPolicy: {
                            type: "Local",
                            accountGrantById: new Map([
                                [session1.accountId, {level: "Manage", generation: 0}],
                                [session3.accountId, {level: "Edit"}],
                            ]),
                            defaultGrant: null,
                            urlGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can\u2019t update a collection access policy with an unreasonable time", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: getUnreasonableTime(),
                    collectionId,
                    collectionAction: {
                        type: "UpdateAccessPolicy",
                        accessPolicy: {
                            type: "Local",
                            accountGrantById: new Map([
                                [session1.accountId, {level: "Manage", generation: 0}],
                                [session3.accountId, {level: "Edit"}],
                            ]),
                            defaultGrant: null,
                            urlGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow(InvalidArgumentError);
    });

    test("can\u2019t update a collection access policy you don\u2019t have access to", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "UpdateAccessPolicy",
                        accessPolicy: {
                            type: "Local",
                            accountGrantById: new Map([
                                [session1.accountId, {level: "Manage", generation: 0}],
                                [session3.accountId, {level: "Edit"}],
                            ]),
                            defaultGrant: null,
                            urlGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can\u2019t update a collection access policy you only have access to as an editor", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "UpdateAccessPolicy",
                        accessPolicy: {
                            type: "Local",
                            accountGrantById: new Map([
                                [session1.accountId, {level: "Manage", generation: 0}],
                                [session3.accountId, {level: "Edit"}],
                            ]),
                            defaultGrant: null,
                            urlGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can update a collection access policy you have access to as a manager", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            [taskAccount2.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage", generation: 0}],
                            [session3.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);
    });

    test("can\u2019t update a collection access policy with no manage grants", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            [taskAccount2.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "UpdateAccessPolicy",
                        accessPolicy: {
                            type: "Local",
                            accountGrantById: new Map([
                                [session1.accountId, {level: "Edit"}],
                                [session3.accountId, {level: "Edit"}],
                            ]),
                            defaultGrant: null,
                            urlGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow("Can\u2019t update access policy so that no one has manage access");

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "UpdateAccessPolicy",
                        accessPolicy: {
                            type: "Local",
                            accountGrantById: new Map([]),
                            defaultGrant: {level: "Edit"},
                            urlGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow("Can\u2019t update access policy so that no one has manage access");

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount2.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 1},
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([]),
                        defaultGrant: {level: "Manage", generation: 1},
                        urlGrant: null,
                    },
                },
            },
        ]);
    });

    test("can update a collection access policy to remove access from yourself", async () => {
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            [taskAccount2.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount2.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "UpdateAccessPolicy",
                        accessPolicy: {
                            type: "Local",
                            accountGrantById: new Map([
                                [taskAccount1.accountId, {level: "Manage", generation: 0}],
                                [taskAccount2.accountId, {level: "Manage", generation: 0}],
                            ]),
                            defaultGrant: null,
                            urlGrant: null,
                        },
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can\u2019t create task twice race condition", async () => {
        const taskId = generateId<TaskId>();

        const pausePromise = commitTaskActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
            session1.accountId,
        );

        const commit1Promise = commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        const {unpause} = await pausePromise;

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session2.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        unpause();

        await expect(commit1Promise).rejects.toThrow(FailedPreconditionError);
    });

    test("can\u2019t create collection twice race condition", async () => {
        const collectionId = generateId<TaskCollectionId>();

        const pausePromise = commitTaskActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
            session1.accountId,
        );

        const commit1Promise = commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        const {unpause} = await pausePromise;

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session2.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount2.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        unpause();

        await expect(commit1Promise).rejects.toThrow(FailedPreconditionError);
    });

    // Our authorization code is implemented with the reasoning: if you had access in a
    // small window of time (<1 min) before the commit we allow the action.
    test("can update task when collection you have access to is removed in a race condition", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: wordTaskTitleTestScenario.update0,
                },
            },
        ]);

        const pausePromise = commitTaskActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
            session2.accountId,
        );

        const commitPromise = commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: wordTaskTitleTestScenario.update1,
                },
            },
        ]);

        const {unpause} = await pausePromise;

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "RemoveCollection",
                    collectionId: collectionId,
                },
            },
        ]);

        unpause();

        await expect(commitPromise).resolves.not.toThrow(PermissionDeniedError);
    });

    // Our authorization code is implemented with the reasoning: if you had access in a
    // small window of time (<1 min) before the commit we allow the action.
    test("can update task when collection you have access to removes your access in a race condition", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: wordTaskTitleTestScenario.update0,
                },
            },
        ]);

        const pausePromise = commitTaskActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
            session2.accountId,
        );

        const commitPromise = commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: wordTaskTitleTestScenario.update1,
                },
            },
        ]);

        const {unpause} = await pausePromise;

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "UpdateAccessPolicy",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            [taskAccount2.accountId, {level: "View"}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
        ]);

        unpause();

        await expect(commitPromise).resolves.not.toThrow(PermissionDeniedError);
    });

    test("can update task due date", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateDueDate",
                    dueDate: new CalendarDate(2023, 7, 12),
                },
            },
        ]);
    });

    test("can\u2019t update task due date with unreasonable updated time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: getUnreasonableTime(),
                    taskId,
                    taskAction: {
                        type: "UpdateDueDate",
                        dueDate: new CalendarDate(2023, 7, 12),
                    },
                },
            ]),
        ).rejects.toThrow(InvalidArgumentError);
    });

    test("can update task priority", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "Medium",
                },
            },
        ]);
    });

    test("can\u2019t update priority with unreasonable updated time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: getUnreasonableTime(),
                    taskId,
                    taskAction: {
                        type: "UpdatePriority",
                        priority: "Medium",
                    },
                },
            ]),
        ).rejects.toThrow(InvalidArgumentError);
    });

    test("can update task layout", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateLayout",
                    layout: "Project",
                },
            },
        ]);
    });

    test("can\u2019t update layout with unreasonable updated time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: getUnreasonableTime(),
                    taskId,
                    taskAction: {
                        type: "UpdateLayout",
                        layout: "Project",
                    },
                },
            ]),
        ).rejects.toThrow(InvalidArgumentError);
    });

    test("can update task parent", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);
    });

    test("can\u2019t update task parent with unreasonable update time", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: getUnreasonableTime(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: taskId1,
                    },
                },
            ]),
        ).rejects.toThrow(InvalidArgumentError);
    });

    test("can update task parent in one transaction", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);
    });

    test("can update task parent in two transactions (scenario 1)", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);
    });

    test("can update task parent in two transactions (scenario 2)", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);
    });

    test("can update task parent and parent position at the same time", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                    parentPosition: {orderTime: clock.now(), orderKey: assertOrderKey("aZZZ")},
                },
            },
        ]);
    });

    test("can\u2019t update task parent and parent position with unreasonable time at the same time", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: taskId1,
                        parentPosition: {
                            orderTime: getUnreasonableTime(),
                            orderKey: assertOrderKey("aZZZ"),
                        },
                    },
                },
            ]),
        ).rejects.toThrow(new InvalidArgumentError("Action `orderTime` is too far in the future"));
    });

    test("can\u2019t update task parent on a task that doesn\u2019t exist", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: taskId1,
                    },
                },
            ]),
        ).rejects.toThrow(new NotFoundError("Task not found"));
    });

    test("can\u2019t update task parent with a task that doesn\u2019t exist", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: taskId1,
                    },
                },
            ]),
        ).rejects.toThrow(new NotFoundError("Parent task not found"));
    });

    test("can\u2019t update task parent to deleted task", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Delete",
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: taskId1,
                    },
                },
            ]),
        ).rejects.toThrow(new FailedPreconditionError("Parent task is deleted"));
    });

    test("can\u2019t update task parent where grandparent is a deleted task", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();
        const taskId3 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Delete",
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId2,
                },
            },
        ]);
    });

    test("can\u2019t update task parent on a task you don\u2019t have edit access to", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session2.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: taskId1,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can\u2019t update task parent to a task you don\u2019t have edit access to", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session2.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: taskId1,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can\u2019t update task parent to a task you have view but not edit access to", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session2.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount2.accountId, {level: "Manage", generation: 0}],
                            [taskAccount1.accountId, {level: "View"}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session2.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: taskId1,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can update task parent to a task when you have edit access", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session2.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount2.accountId, {level: "Manage", generation: 0}],
                            [taskAccount1.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session2.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);
    });

    test("child tasks inherit the permissions of their parent task", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session2.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount2.accountId, {level: "Manage", generation: 0}],
                            [taskAccount1.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session2.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session2.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: wordTaskTitleTestScenario.update0,
                },
            },
        ]);
    });

    test("child tasks inherit the permissions of their parent task multiple levels up", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();
        const taskId3 = generateId<TaskId>();
        const taskId4 = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId4,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId3,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId3,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId4,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId3,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId2,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId4,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId3,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: wordTaskTitleTestScenario.update0,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: wordTaskTitleTestScenario.update0,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: wordTaskTitleTestScenario.update0,
                },
            },
        ]);
    });

    test("child tasks don\u2019t inherit the permissions of their deleted parent task", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session2.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount2.accountId, {level: "Manage", generation: 0}],
                            [taskAccount1.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session2.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session2.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: wordTaskTitleTestScenario.update0,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Delete",
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update1,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("child tasks don\u2019t inherit the permissions of their deleted parent task multiple levels up", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();
        const taskId3 = generateId<TaskId>();
        const taskId4 = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                            [taskAccount2.accountId, {level: "Edit"}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId4,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId3,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId3,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId4,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId3,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId2,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId4,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId3,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: wordTaskTitleTestScenario.update0,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: wordTaskTitleTestScenario.update0,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: wordTaskTitleTestScenario.update0,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Delete",
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId4,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update1,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId3,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update1,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("child tasks can be nested more than 5 levels deep", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();
        const taskId3 = generateId<TaskId>();
        const taskId4 = generateId<TaskId>();
        const taskId5 = generateId<TaskId>();
        const taskId6 = generateId<TaskId>();
        const taskId7 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId5,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId6,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId7,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId2,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId3,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId5,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId4,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId6,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId5,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId7,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId6,
                },
            },
        ]);
    });

    test("child tasks can\u2019t create a circular dependency", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();
        const taskId3 = generateId<TaskId>();
        const taskId4 = generateId<TaskId>();
        const taskId5 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId5,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId2,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId3,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId5,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId4,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId1,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: taskId5,
                    },
                },
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "Updating task\u2019s `parentTaskId` would create a circular dependency",
            ),
        );
    });

    test("child tasks can\u2019t create a circular dependency even in race conditions (2 tasks)", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 0},
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        const pausePromise = commitTaskActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
            session2.accountId,
        );

        const commitPromise = commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);

        const {unpause} = await pausePromise;

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId2,
                },
            },
        ]);

        unpause();

        await expect(commitPromise).rejects.toThrow(
            new FailedPreconditionError(
                "Updating task\u2019s `parentTaskId` would create a circular dependency",
            ),
        );
    });

    test("child tasks can\u2019t create a circular dependency even in race conditions (3 tasks)", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();
        const taskId3 = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 0},
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);

        const pausePromise = commitTaskActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
            session2.accountId,
        );

        const commitPromise = commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId2,
                },
            },
        ]);

        const {unpause} = await pausePromise;

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId3,
                },
            },
        ]);

        unpause();

        await expect(commitPromise).rejects.toThrow(
            new FailedPreconditionError(
                "Updating task\u2019s `parentTaskId` would create a circular dependency",
            ),
        );
    });

    test("child tasks can\u2019t create a circular dependency even in race conditions (5 tasks, scenario 1)", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();
        const taskId3 = generateId<TaskId>();
        const taskId4 = generateId<TaskId>();
        const taskId5 = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 0},
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId5,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId5,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId2,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId3,
                },
            },
        ]);

        const pausePromise = commitTaskActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
            session2.accountId,
        );

        const commitPromise = commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId5,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId4,
                },
            },
        ]);

        const {unpause} = await pausePromise;

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId5,
                },
            },
        ]);

        unpause();

        await expect(commitPromise).rejects.toThrow(
            new FailedPreconditionError(
                "Updating task\u2019s `parentTaskId` would create a circular dependency",
            ),
        );
    });

    test("child tasks can\u2019t create a circular dependency even in race conditions (5 tasks, scenario 2)", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();
        const taskId3 = generateId<TaskId>();
        const taskId4 = generateId<TaskId>();
        const taskId5 = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 0},
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId5,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId5,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId2,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId3,
                },
            },
        ]);

        const pausePromise = commitTaskActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
            session2.accountId,
        );

        const commitPromise = commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId5,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId4,
                },
            },
        ]);

        const {unpause} = await pausePromise;

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId5,
                },
            },
        ]);

        unpause();

        await expect(commitPromise).rejects.toThrow(
            new FailedPreconditionError(
                "Updating task\u2019s `parentTaskId` would create a circular dependency",
            ),
        );
    });

    test("child tasks can\u2019t create a circular dependency even in race conditions (5 tasks, scenario 3)", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();
        const taskId3 = generateId<TaskId>();
        const taskId4 = generateId<TaskId>();
        const taskId5 = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 0},
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId5,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId5,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId2,
                },
            },
        ]);

        const pausePromise = commitTaskActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
            session2.accountId,
        );

        const commitPromise = commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId5,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId4,
                },
            },
        ]);

        const {unpause} = await pausePromise;

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId3,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId5,
                },
            },
        ]);

        unpause();

        await expect(commitPromise).rejects.toThrow(
            new FailedPreconditionError(
                "Updating task\u2019s `parentTaskId` would create a circular dependency",
            ),
        );
    });

    test("child tasks can\u2019t create a circular dependency even in race conditions (5 tasks, scenario 4)", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();
        const taskId3 = generateId<TaskId>();
        const taskId4 = generateId<TaskId>();
        const taskId5 = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 0},
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId5,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId5,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId2,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId5,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId4,
                },
            },
        ]);

        const pausePromise = commitTaskActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
            session2.accountId,
        );

        const commitPromise = commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId3,
                },
            },
        ]);

        const {unpause} = await pausePromise;

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId5,
                },
            },
        ]);

        unpause();

        await expect(commitPromise).rejects.toThrow(
            new FailedPreconditionError(
                "Updating task\u2019s `parentTaskId` would create a circular dependency",
            ),
        );
    });

    test("child tasks can\u2019t create a circular dependency even in race conditions (5 tasks, scenario 5)", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();
        const taskId3 = generateId<TaskId>();
        const taskId4 = generateId<TaskId>();
        const taskId5 = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 0},
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId5,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId5,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId2,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId5,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId4,
                },
            },
        ]);

        const pausePromise = commitTaskActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
            session2.accountId,
        );

        const commitPromise = commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId3,
                },
            },
        ]);

        const {unpause} = await pausePromise;

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId5,
                },
            },
        ]);

        unpause();

        await expect(commitPromise).rejects.toThrow(
            new FailedPreconditionError(
                "Updating task\u2019s `parentTaskId` would create a circular dependency",
            ),
        );
    });

    test("child tasks can\u2019t create a circular dependency even in race conditions (9 tasks)", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();
        const taskId3 = generateId<TaskId>();
        const taskId4 = generateId<TaskId>();
        const taskId5 = generateId<TaskId>();
        const taskId6 = generateId<TaskId>();
        const taskId7 = generateId<TaskId>();
        const taskId8 = generateId<TaskId>();
        const taskId9 = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 0},
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId5,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId5,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId6,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId6,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId7,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId7,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId8,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId8,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId9,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId9,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId2,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId3,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId6,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId5,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId7,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId6,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId8,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId7,
                },
            },
        ]);

        const pausePromise = commitTaskActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
            session2.accountId,
        );

        const commitPromise = commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId6,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId4,
                },
            },
        ]);

        const {unpause} = await pausePromise;

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: null,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId9,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId9,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId8,
                },
            },
        ]);

        unpause();

        await expect(commitPromise).rejects.toThrow(
            new FailedPreconditionError(
                "Updating task\u2019s `parentTaskId` would create a circular dependency",
            ),
        );
    });

    test("can create circular dependency involving deleted task", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();
        const taskId3 = generateId<TaskId>();
        const taskId4 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId2,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId3,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId1,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: taskId4,
                    },
                },
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "Updating task\u2019s `parentTaskId` would create a circular dependency",
            ),
        );

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Delete",
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId4,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "Undelete",
                    },
                },
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError("Undeleting task would create a circular dependency"),
        );
    });

    test("can use undelete to create circular dependency involving deleted task", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();
        const taskId3 = generateId<TaskId>();
        const taskId4 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId2,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId3,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId1,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: taskId4,
                    },
                },
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "Updating task\u2019s `parentTaskId` would create a circular dependency",
            ),
        );

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Delete",
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId4,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "Undelete",
                    },
                },
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError("Undeleting task would create a circular dependency"),
        );

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "Delete",
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Undelete",
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId3,
                    taskAction: {
                        type: "Undelete",
                    },
                },
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError("Undeleting task would create a circular dependency"),
        );
    });

    test("can\u2019t create a circular dependency with undelete even in race conditions", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();
        const taskId3 = generateId<TaskId>();
        const taskId4 = generateId<TaskId>();
        const taskId5 = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 0},
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId5,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId5,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId2,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId3,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId5,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId4,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Delete",
                },
            },
        ]);

        const pausePromise = commitTaskActionTransactionBeforeExecuteTestCheckpoint.pauseForTest(
            session2.accountId,
        );

        const commitPromise = commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId5,
                },
            },
        ]);

        const {unpause} = await pausePromise;

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Undelete",
                },
            },
        ]);

        unpause();

        await expect(commitPromise).rejects.toThrow(
            new FailedPreconditionError(
                "Updating task\u2019s `parentTaskId` would create a circular dependency",
            ),
        );
    });

    test("can create a circular dependency with delete", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();
        const taskId3 = generateId<TaskId>();
        const taskId4 = generateId<TaskId>();
        const taskId5 = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 0},
                        urlGrant: null,
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId5,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId5,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId2,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId4,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId3,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId5,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId4,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Delete",
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId5,
                },
            },
        ]);
    });

    test("can remove the parent of a child task when you don\u2019t have access to the parent task", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();
        const collectionId1 = generateId<TaskCollectionId>();
        const collectionId2 = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId: collectionId1,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId: collectionId2,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 0},
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId1,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session2.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId2,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: taskId1,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: null,
                },
            },
        ]);
    });

    test("can change the parent of a child task when you don\u2019t have access to the parent task", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();
        const taskId3 = generateId<TaskId>();
        const collectionId1 = generateId<TaskCollectionId>();
        const collectionId2 = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId: collectionId1,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId: collectionId2,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 0},
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId1,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session2.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId2,
                    orderKey: assertOrderKey("a0"),
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session2.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId3,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId2,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: taskId1,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId3,
                },
            },
        ]);
    });

    test("can delete a child task when you don\u2019t have access to the parent task", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();
        const collectionId1 = generateId<TaskCollectionId>();
        const collectionId2 = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId: collectionId1,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId: collectionId2,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [session1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: {level: "Manage", generation: 0},
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId1,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session2.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId2,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: taskId1,
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Delete",
                },
            },
        ]);
    });

    test("can\u2019t update task parent order key when there is no parent", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateParentPosition",
                        parentPosition: {orderTime: clock.now(), orderKey: initialOrderKey},
                    },
                },
            ]),
        ).rejects.toThrow(new FailedPreconditionError("Task doesn\u2019t have a parent"));
    });

    test("can update task parent order key", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentPosition",
                    parentPosition: {orderTime: clock.now(), orderKey: initialOrderKey},
                },
            },
        ]);
    });

    test("can\u2019t update task parent order key with unreasonable updated time", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: getUnreasonableTime(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateParentPosition",
                        parentPosition: {orderTime: clock.now(), orderKey: initialOrderKey},
                    },
                },
            ]),
        ).rejects.toThrow(new InvalidArgumentError("Action time too far in the future"));
    });

    test("can\u2019t update task parent order key when parent is deleted", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Delete",
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateParentPosition",
                        parentPosition: {orderTime: clock.now(), orderKey: initialOrderKey},
                    },
                },
            ]),
        ).rejects.toThrow(new FailedPreconditionError("Parent task is deleted"));
    });

    test("can\u2019t update task parent order key when you don\u2019t have edit access to parent", async () => {
        const taskId1 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        const {taskId: taskId2} = await createPublicTask(session2, space.id);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateParentPosition",
                        parentPosition: {orderTime: clock.now(), orderKey: initialOrderKey},
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentPosition",
                    parentPosition: {orderTime: clock.now(), orderKey: initialOrderKey},
                },
            },
        ]);
    });

    test("can\u2019t update task parent order key if order time is unreasonable", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "UpdateParentTaskId",
                    parentTaskId: taskId1,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateParentPosition",
                        parentPosition: {
                            orderTime: getUnreasonableTime(),
                            orderKey: initialOrderKey,
                        },
                    },
                },
            ]),
        ).rejects.toThrow(new InvalidArgumentError("Action `orderTime` is too far in the future"));
    });

    test("can update task status", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateStatus",
                    status: {
                        type: "Closed",
                        closerId: session1.accountId,
                        closedTime: getCurrentTaskTime(),
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateStatus",
                    status: {type: "Open"},
                },
            },
        ]);
    });

    test("can\u2019t update task status with unreasonable updated time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: getUnreasonableTime(),
                    taskId,
                    taskAction: {
                        type: "UpdateStatus",
                        status: {
                            type: "Closed",
                            closerId: session1.accountId,
                            closedTime: getCurrentTaskTime(),
                        },
                    },
                },
            ]),
        ).rejects.toThrow(new InvalidArgumentError("Action time too far in the future"));
    });

    test("can\u2019t update task status with unreasonable closed time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateStatus",
                        status: {
                            type: "Closed",
                            closerId: session1.accountId,
                            closedTime: getUnreasonableTaskTime(),
                        },
                    },
                },
            ]),
        ).rejects.toThrow(new InvalidArgumentError("Action `closedTime` is too far in the future"));
    });

    test("can\u2019t update task status with a closer other than your account", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateStatus",
                        status: {
                            type: "Closed",
                            closerId: session2.accountId,
                            closedTime: getCurrentTaskTime(),
                        },
                    },
                },
            ]),
        ).rejects.toThrow(
            new PermissionDeniedError("Can only close a task with yourself as the closer"),
        );
    });

    test("can update task status and assignee status at the same time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateStatus",
                    status: {
                        type: "Closed",
                        closerId: session1.accountId,
                        closedTime: getCurrentTaskTime(),
                    },
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateStatus",
                        status: {type: "Open"},
                        assigneeStatus: {type: "Active", activatedTime: getUnreasonableTaskTime()},
                    },
                },
            ]),
        ).rejects.toThrow(
            new InvalidArgumentError("Action `activatedTime` is too far in the future"),
        );
    });

    test("can\u2019t update task status and assignee status if assignee status has an unreasonable time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateStatus",
                    status: {
                        type: "Closed",
                        closerId: session1.accountId,
                        closedTime: getCurrentTaskTime(),
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateStatus",
                    status: {type: "Open"},
                    assigneeStatus: {type: "Active", activatedTime: getCurrentTaskTime()},
                },
            },
        ]);
    });

    test("can update task assignee", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssignee",
                    assignee: {
                        assigneeId: session2.accountId,
                        assignerId: session1.accountId,
                        assignedTime: getCurrentTaskTime(),
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssignee",
                    assignee: null,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssignee",
                    assignee: {
                        assigneeId: session1.accountId,
                        assignerId: session1.accountId,
                        assignedTime: getCurrentTaskTime(),
                    },
                },
            },
        ]);
    });

    test("can\u2019t update task assignee with unreasonable updated time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: getUnreasonableTime(),
                    taskId,
                    taskAction: {
                        type: "UpdateAssignee",
                        assignee: {
                            assigneeId: session2.accountId,
                            assignerId: session1.accountId,
                            assignedTime: getCurrentTaskTime(),
                        },
                    },
                },
            ]),
        ).rejects.toThrow(new InvalidArgumentError("Action time too far in the future"));
    });

    test("can\u2019t update task assignee with unreasonable assigned time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateAssignee",
                        assignee: {
                            assigneeId: session2.accountId,
                            assignerId: session1.accountId,
                            assignedTime: getUnreasonableTaskTime(),
                        },
                    },
                },
            ]),
        ).rejects.toThrow(
            new InvalidArgumentError("Action `assignedTime` is too far in the future"),
        );
    });

    test("can\u2019t update task assignee with an assigner other than your account", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateAssignee",
                        assignee: {
                            assigneeId: session2.accountId,
                            assignerId: session2.accountId,
                            assignedTime: getCurrentTaskTime(),
                        },
                    },
                },
            ]),
        ).rejects.toThrow(
            new PermissionDeniedError("Can only assign a task with yourself as the assigner"),
        );
    });

    test("can\u2019t update task assignee with an assignee outside the current space", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateAssignee",
                        assignee: {
                            assigneeId: otherSession.accountId,
                            assignerId: session1.accountId,
                            assignedTime: getCurrentTaskTime(),
                        },
                    },
                },
            ]),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "Can\u2019t assign a task to an account outside of the current space",
            ),
        );
    });

    test("can update task assignee status", async () => {
        const {taskId} = await createPublicTask(session1, space.id);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssignee",
                    assignee: {
                        assigneeId: session2.accountId,
                        assignerId: session1.accountId,
                        assignedTime: getCurrentTaskTime(),
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssigneeStatus",
                    assigneeStatus: {
                        type: "Active",
                        activatedTime: getCurrentTaskTime(),
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssigneeStatus",
                    assigneeStatus: {type: "Inactive"},
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssigneeStatus",
                    assigneeStatus: {
                        type: "Active",
                        activatedTime: getCurrentTaskTime(),
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session2), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssigneeStatus",
                    assigneeStatus: {type: "Inactive"},
                },
            },
        ]);
    });

    test("can\u2019t update task assignee status with unreasonable updated time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssignee",
                    assignee: {
                        assigneeId: session2.accountId,
                        assignerId: session1.accountId,
                        assignedTime: getCurrentTaskTime(),
                    },
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: getUnreasonableTime(),
                    taskId,
                    taskAction: {
                        type: "UpdateAssigneeStatus",
                        assigneeStatus: {
                            type: "Active",
                            activatedTime: getCurrentTaskTime(),
                        },
                    },
                },
            ]),
        ).rejects.toThrow(new InvalidArgumentError("Action time too far in the future"));
    });

    test("can\u2019t update task assignee status with unreasonable activated time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssignee",
                    assignee: {
                        assigneeId: session2.accountId,
                        assignerId: session1.accountId,
                        assignedTime: getCurrentTaskTime(),
                    },
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateAssigneeStatus",
                        assigneeStatus: {
                            type: "Active",
                            activatedTime: getUnreasonableTaskTime(),
                        },
                    },
                },
            ]),
        ).rejects.toThrow(
            new InvalidArgumentError("Action `activatedTime` is too far in the future"),
        );
    });

    test("can update task assignee position", async () => {
        const {taskId} = await createPublicTask(session1, space.id);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssignee",
                    assignee: {
                        assigneeId: session1.accountId,
                        assignerId: session1.accountId,
                        assignedTime: getCurrentTaskTime(),
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssigneeStatus",
                    assigneeStatus: {
                        type: "Active",
                        activatedTime: getCurrentTaskTime(),
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssigneePosition",
                    accountId: session1.accountId,
                    position: {orderTime: clock.now(), orderKey: assertOrderKey("a2")},
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssigneePosition",
                    accountId: session1.accountId,
                    position: {orderTime: clock.now(), orderKey: assertOrderKey("a3")},
                },
            },
        ]);
    });

    test("can\u2019t update task assignee position when another account is assigned", async () => {
        const {taskId} = await createPublicTask(session1, space.id);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssignee",
                    assignee: {
                        assigneeId: session2.accountId,
                        assignerId: session1.accountId,
                        assignedTime: getCurrentTaskTime(),
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssigneeStatus",
                    assigneeStatus: {
                        type: "Active",
                        activatedTime: getCurrentTaskTime(),
                    },
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateAssigneePosition",
                        accountId: session1.accountId,
                        position: {orderTime: clock.now(), orderKey: assertOrderKey("a2")},
                    },
                },
            ]),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "Can only update the task\u2019s assignee position if you are the task\u2019s assignee",
            ),
        );
    });

    test("can\u2019t update task assignee position when no account is assigned", async () => {
        const {taskId} = await createPublicTask(session1, space.id);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssigneeStatus",
                    assigneeStatus: {
                        type: "Active",
                        activatedTime: getCurrentTaskTime(),
                    },
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateAssigneePosition",
                        accountId: session1.accountId,
                        position: {orderTime: clock.now(), orderKey: assertOrderKey("a2")},
                    },
                },
            ]),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "Can only update the task\u2019s assignee position if you are the task\u2019s assignee",
            ),
        );
    });

    test("can\u2019t update task assignee position with an account id other than your own", async () => {
        const {taskId} = await createPublicTask(session1, space.id);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssignee",
                    assignee: {
                        assigneeId: session1.accountId,
                        assignerId: session1.accountId,
                        assignedTime: getCurrentTaskTime(),
                    },
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssigneeStatus",
                    assigneeStatus: {
                        type: "Active",
                        activatedTime: getCurrentTaskTime(),
                    },
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateAssigneePosition",
                        accountId: session2.accountId,
                        position: {orderTime: clock.now(), orderKey: assertOrderKey("a2")},
                    },
                },
            ]),
        ).rejects.toThrow(
            new PermissionDeniedError(
                "Must use the actor `AccountId` when updating the task\u2019s assignee position",
            ),
        );
    });

    test("can\u2019t update task assignee position with unreasonable order time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssignee",
                    assignee: {
                        assigneeId: session1.accountId,
                        assignerId: session1.accountId,
                        assignedTime: getCurrentTaskTime(),
                    },
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateAssigneePosition",
                        accountId: session2.accountId,
                        position: {
                            orderTime: getUnreasonableTime(),
                            orderKey: assertOrderKey("a2"),
                        },
                    },
                },
            ]),
        ).rejects.toThrow(new InvalidArgumentError("Action `orderTime` is too far in the future"));
    });

    test("can update task assignee and assignee status at the same time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateAssignee",
                    assignee: {
                        assigneeId: session2.accountId,
                        assignerId: session1.accountId,
                        assignedTime: getCurrentTaskTime(),
                    },
                    assigneeStatus: {
                        type: "Active",
                        activatedTime: getCurrentTaskTime(),
                    },
                },
            },
        ]);
    });

    test("can\u2019t update task assignee and assignee status with unreasonable time at the same time", async () => {
        const taskId = generateId<TaskId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateAssignee",
                        assignee: {
                            assigneeId: session2.accountId,
                            assignerId: session1.accountId,
                            assignedTime: getCurrentTaskTime(),
                        },
                        assigneeStatus: {
                            type: "Active",
                            activatedTime: getUnreasonableTaskTime(),
                        },
                    },
                },
            ]),
        ).rejects.toThrow(
            new InvalidArgumentError("Action `activatedTime` is too far in the future"),
        );
    });

    test("can update task position in a collection", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateCollectionPosition",
                    collectionId,
                    position: {orderTime: clock.now(), orderKey: assertOrderKey("a1")},
                },
            },
        ]);
    });

    test("can\u2019t update task position with an unreasonable update time", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: getUnreasonableTime(),
                    taskId,
                    taskAction: {
                        type: "UpdateCollectionPosition",
                        collectionId,
                        position: {orderTime: clock.now(), orderKey: assertOrderKey("a1")},
                    },
                },
            ]),
        ).rejects.toThrow(new InvalidArgumentError("Action time too far in the future"));
    });

    test("can\u2019t update task position with an unreasonable order time", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateCollectionPosition",
                        collectionId,
                        position: {
                            orderTime: getUnreasonableTime(),
                            orderKey: assertOrderKey("a1"),
                        },
                    },
                },
            ]),
        ).rejects.toThrow(new InvalidArgumentError("Action `orderTime` is too far in the future"));
    });

    test("can\u2019t update task position with a task that doesn\u2019t exist", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: generateId(),
                    taskAction: {
                        type: "UpdateCollectionPosition",
                        collectionId,
                        position: {orderTime: clock.now(), orderKey: assertOrderKey("a1")},
                    },
                },
            ]),
        ).rejects.toThrow(new NotFoundError("Task not found"));
    });

    test("can\u2019t update task position with a task that\u2019s not in the collection", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId2,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId: taskId1,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateCollectionPosition",
                        collectionId,
                        position: {orderTime: clock.now(), orderKey: assertOrderKey("a1")},
                    },
                },
            ]),
        ).rejects.toThrow(new FailedPreconditionError("Task is not in collection"));
    });

    test("can\u2019t update task position with a task that was removed from the collection", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "RemoveCollection",
                    collectionId: collectionId,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateCollectionPosition",
                        collectionId,
                        position: {orderTime: clock.now(), orderKey: assertOrderKey("a1")},
                    },
                },
            ]),
        ).rejects.toThrow(new FailedPreconditionError("Task is not in collection"));
    });

    test("can\u2019t update task position when you don\u2019t have access to the collection", async () => {
        const taskId = generateId<TaskId>();
        const collectionId = generateId<TaskCollectionId>();

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "Create",
                    creator: {accountId: session1.account.id, from: null},
                    name: "Test",
                    accessPolicy: {
                        type: "Local",
                        accountGrantById: new Map([
                            [taskAccount1.accountId, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    },
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "Create",
                    creator: {accountId: session1.accountId, from: null},
                    creatorTimeZone: defaultTimeZone,
                },
            },
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "AddCollection",
                    collectionId: collectionId,
                    orderKey: assertOrderKey("a0"),
                },
            },
        ]);

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "RemoveCollection",
                    collectionId: collectionId,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateCollectionPosition",
                        collectionId,
                        position: {orderTime: clock.now(), orderKey: assertOrderKey("a1")},
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can\u2019t update task position when you only have view access to the collection", async () => {
        const {taskId, collectionId} = await createPublicTask(session1, space.id, "View");

        await commitTaskActionTransaction(context.action(session1), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "RemoveCollection",
                    collectionId: collectionId,
                },
            },
        ]);

        await expect(
            commitTaskActionTransaction(context.action(session2), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateCollectionPosition",
                        collectionId,
                        position: {orderTime: clock.now(), orderKey: assertOrderKey("a1")},
                    },
                },
            ]),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can\u2019t update a task\u2019s title with an account in a different space", async () => {
        const {taskId} = await createPublicTask(session1, space.id);

        await expect(
            commitTaskActionTransaction(context.action(otherSession), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                },
            ]),
        ).rejects.toThrow(new PermissionDeniedError("Account doesn\u2019t have access to space"));
    });

    test("can\u2019t update a task\u2019s title in the context of the wrong space", async () => {
        const {taskId} = await createPublicTask(session1, space.id);

        await expect(
            commitTaskActionTransaction(context.action(sharedSession), otherSpace.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate: wordTaskTitleTestScenario.update0,
                    },
                },
            ]),
        ).rejects.toThrow(new PermissionDeniedError("Account doesn\u2019t have access to space"));

        await commitTaskActionTransaction(context.action(sharedSession), space.id, [
            {
                type: "UpdateTask",
                time: clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate: wordTaskTitleTestScenario.update0,
                },
            },
        ]);
    });

    test("can\u2019t update a collection\u2019s name with an account in a different space", async () => {
        const {collectionId} = await createPublicTask(session1, space.id, "Manage");

        await expect(
            commitTaskActionTransaction(context.action(otherSession), space.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "UpdateName",
                        name: "New Collection Name",
                    },
                },
            ]),
        ).rejects.toThrow(new PermissionDeniedError("Account doesn\u2019t have access to space"));
    });

    test("can\u2019t update a collection\u2019s name in the context of the wrong space", async () => {
        const {collectionId} = await createPublicTask(session1, space.id, "Manage");

        await expect(
            commitTaskActionTransaction(context.action(sharedSession), otherSpace.id, [
                {
                    type: "UpdateCollection",
                    time: clock.now(),
                    collectionId,
                    collectionAction: {
                        type: "UpdateName",
                        name: "New Collection Name",
                    },
                },
            ]),
        ).rejects.toThrow(new PermissionDeniedError("Account doesn\u2019t have access to space"));

        await commitTaskActionTransaction(context.action(sharedSession), space.id, [
            {
                type: "UpdateCollection",
                time: clock.now(),
                collectionId,
                collectionAction: {
                    type: "UpdateName",
                    name: "New Collection Name",
                },
            },
        ]);
    });

    test("updating task parents commits extra update children count action", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();
        const taskId3 = generateId<TaskId>();

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId1,
                    taskAction: {
                        type: "Create",
                        creator: {accountId: session1.accountId, from: null},
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([]),
        });

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "Create",
                        creator: {accountId: session1.accountId, from: null},
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([]),
        });

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId3,
                    taskAction: {
                        type: "Create",
                        creator: {accountId: session1.accountId, from: null},
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([]),
        });

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId3,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: taskId1,
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: taskId1,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 1,
                        removedChildTaskCount: 0,
                        addedClosedChildTaskCount: 0,
                        removedClosedChildTaskCount: 0,
                    },
                },
            ]),
        });

        expect(
            (
                await commitTaskActionTransaction(context.action(session1), space.id, [
                    {
                        type: "UpdateTask",
                        time: clock.now(),
                        taskId: taskId3,
                        taskAction: {
                            type: "UpdateParentTaskId",
                            parentTaskId: taskId2,
                        },
                    },
                ])
            ).extraActions
                .slice()
                .sort((a, b) =>
                    defaultCompareStrings(
                        "taskId" in a ? a.taskId : "",
                        "taskId" in b ? b.taskId : "",
                    ),
                ),
        ).toEqual(
            cast<Array<TaskAction>>([
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: taskId1,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 1,
                        removedChildTaskCount: 1,
                        addedClosedChildTaskCount: 0,
                        removedClosedChildTaskCount: 0,
                    },
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 1,
                        removedChildTaskCount: 0,
                        addedClosedChildTaskCount: 0,
                        removedClosedChildTaskCount: 0,
                    },
                },
            ]).sort((a, b) =>
                defaultCompareStrings("taskId" in a ? a.taskId : "", "taskId" in b ? b.taskId : ""),
            ),
        );

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId3,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: null,
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 1,
                        removedChildTaskCount: 1,
                        addedClosedChildTaskCount: 0,
                        removedClosedChildTaskCount: 0,
                    },
                },
            ]),
        });
    });

    test("opening and closing a task commits extra update children count action", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId1,
                    taskAction: {
                        type: "Create",
                        creator: {accountId: session1.accountId, from: null},
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([]),
        });

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "Create",
                        creator: {accountId: session1.accountId, from: null},
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([]),
        });

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: taskId1,
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: taskId1,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 1,
                        removedChildTaskCount: 0,
                        addedClosedChildTaskCount: 0,
                        removedClosedChildTaskCount: 0,
                    },
                },
            ]),
        });

        const actionTime1 = clock.now();

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: actionTime1,
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateStatus",
                        status: {
                            type: "Closed",
                            closerId: session1.accountId,
                            closedTime: new TaskFilterableTime({
                                absoluteTime: actionTime1,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: taskId1,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 1,
                        removedChildTaskCount: 0,
                        addedClosedChildTaskCount: 1,
                        removedClosedChildTaskCount: 0,
                    },
                },
            ]),
        });

        const actionTime2 = clock.now();

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: actionTime2,
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateStatus",
                        status: {
                            type: "Closed",
                            closerId: session1.accountId,
                            closedTime: new TaskFilterableTime({
                                absoluteTime: actionTime2,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([]),
        });

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateStatus",
                        status: {type: "Open"},
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: taskId1,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 1,
                        removedChildTaskCount: 0,
                        addedClosedChildTaskCount: 1,
                        removedClosedChildTaskCount: 1,
                    },
                },
            ]),
        });

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateStatus",
                        status: {type: "Open"},
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([]),
        });

        const actionTime3 = clock.now();

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: actionTime3,
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateStatus",
                        status: {
                            type: "Closed",
                            closerId: session1.accountId,
                            closedTime: new TaskFilterableTime({
                                absoluteTime: actionTime3,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: taskId1,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 1,
                        removedChildTaskCount: 0,
                        addedClosedChildTaskCount: 2,
                        removedClosedChildTaskCount: 1,
                    },
                },
            ]),
        });
    });

    test("changing parents of a closed a task commits extra update children count action", async () => {
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();
        const taskId3 = generateId<TaskId>();

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId1,
                    taskAction: {
                        type: "Create",
                        creator: {accountId: session1.accountId, from: null},
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([]),
        });

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "Create",
                        creator: {accountId: session1.accountId, from: null},
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([]),
        });

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId3,
                    taskAction: {
                        type: "Create",
                        creator: {accountId: session1.accountId, from: null},
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([]),
        });

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId3,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: taskId1,
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: taskId1,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 1,
                        removedChildTaskCount: 0,
                        addedClosedChildTaskCount: 0,
                        removedClosedChildTaskCount: 0,
                    },
                },
            ]),
        });

        const actionTime1 = clock.now();

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: actionTime1,
                    taskId: taskId3,
                    taskAction: {
                        type: "UpdateStatus",
                        status: {
                            type: "Closed",
                            closerId: session1.accountId,
                            closedTime: new TaskFilterableTime({
                                absoluteTime: actionTime1,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: taskId1,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 1,
                        removedChildTaskCount: 0,
                        addedClosedChildTaskCount: 1,
                        removedClosedChildTaskCount: 0,
                    },
                },
            ]),
        });

        expect(
            (
                await commitTaskActionTransaction(context.action(session1), space.id, [
                    {
                        type: "UpdateTask",
                        time: clock.now(),
                        taskId: taskId3,
                        taskAction: {
                            type: "UpdateParentTaskId",
                            parentTaskId: taskId2,
                        },
                    },
                ])
            ).extraActions
                .slice()
                .sort((a, b) =>
                    defaultCompareStrings(
                        "taskId" in a ? a.taskId : "",
                        "taskId" in b ? b.taskId : "",
                    ),
                ),
        ).toEqual(
            cast<Array<TaskAction>>([
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: taskId1,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 1,
                        removedChildTaskCount: 1,
                        addedClosedChildTaskCount: 1,
                        removedClosedChildTaskCount: 1,
                    },
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 1,
                        removedChildTaskCount: 0,
                        addedClosedChildTaskCount: 1,
                        removedClosedChildTaskCount: 0,
                    },
                },
            ]).sort((a, b) =>
                defaultCompareStrings("taskId" in a ? a.taskId : "", "taskId" in b ? b.taskId : ""),
            ),
        );

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId3,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: null,
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 1,
                        removedChildTaskCount: 1,
                        addedClosedChildTaskCount: 1,
                        removedClosedChildTaskCount: 1,
                    },
                },
            ]),
        });
    });

    test("moving multiple open and closed tasks around commits extra update children count action", async () => {
        const parentTaskId1 = generateId<TaskId>();
        const parentTaskId2 = generateId<TaskId>();
        const taskId1 = generateId<TaskId>();
        const taskId2 = generateId<TaskId>();
        const taskId3 = generateId<TaskId>();

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: parentTaskId1,
                    taskAction: {
                        type: "Create",
                        creator: {accountId: session1.accountId, from: null},
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([]),
        });

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: parentTaskId2,
                    taskAction: {
                        type: "Create",
                        creator: {accountId: session1.accountId, from: null},
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([]),
        });

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId1,
                    taskAction: {
                        type: "Create",
                        creator: {accountId: session1.accountId, from: null},
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([]),
        });

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "Create",
                        creator: {accountId: session1.accountId, from: null},
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([]),
        });

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId3,
                    taskAction: {
                        type: "Create",
                        creator: {accountId: session1.accountId, from: null},
                        creatorTimeZone: defaultTimeZone,
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([]),
        });

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId1,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: parentTaskId1,
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTaskId1,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 1,
                        removedChildTaskCount: 0,
                        addedClosedChildTaskCount: 0,
                        removedClosedChildTaskCount: 0,
                    },
                },
            ]),
        });

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: parentTaskId1,
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTaskId1,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 2,
                        removedChildTaskCount: 0,
                        addedClosedChildTaskCount: 0,
                        removedClosedChildTaskCount: 0,
                    },
                },
            ]),
        });

        expect(
            (
                await commitTaskActionTransaction(context.action(session1), space.id, [
                    {
                        type: "UpdateTask",
                        time: clock.now(),
                        taskId: taskId1,
                        taskAction: {
                            type: "UpdateParentTaskId",
                            parentTaskId: parentTaskId2,
                        },
                    },
                ])
            ).extraActions
                .slice()
                .sort((a, b) =>
                    defaultCompareStrings(
                        "taskId" in a ? a.taskId : "",
                        "taskId" in b ? b.taskId : "",
                    ),
                ),
        ).toEqual(
            cast<Array<TaskAction>>([
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTaskId1,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 2,
                        removedChildTaskCount: 1,
                        addedClosedChildTaskCount: 0,
                        removedClosedChildTaskCount: 0,
                    },
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTaskId2,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 1,
                        removedChildTaskCount: 0,
                        addedClosedChildTaskCount: 0,
                        removedClosedChildTaskCount: 0,
                    },
                },
            ]).sort((a, b) =>
                defaultCompareStrings("taskId" in a ? a.taskId : "", "taskId" in b ? b.taskId : ""),
            ),
        );

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: clock.now(),
                    taskId: taskId3,
                    taskAction: {
                        type: "UpdateParentTaskId",
                        parentTaskId: parentTaskId1,
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTaskId1,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 3,
                        removedChildTaskCount: 1,
                        addedClosedChildTaskCount: 0,
                        removedClosedChildTaskCount: 0,
                    },
                },
            ]),
        });

        expect(
            (
                await commitTaskActionTransaction(context.action(session1), space.id, [
                    {
                        type: "UpdateTask",
                        time: clock.now(),
                        taskId: taskId1,
                        taskAction: {
                            type: "UpdateParentTaskId",
                            parentTaskId: parentTaskId1,
                        },
                    },
                ])
            ).extraActions
                .slice()
                .sort((a, b) =>
                    defaultCompareStrings(
                        "taskId" in a ? a.taskId : "",
                        "taskId" in b ? b.taskId : "",
                    ),
                ),
        ).toEqual(
            cast<Array<TaskAction>>([
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTaskId1,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 4,
                        removedChildTaskCount: 1,
                        addedClosedChildTaskCount: 0,
                        removedClosedChildTaskCount: 0,
                    },
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTaskId2,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 1,
                        removedChildTaskCount: 1,
                        addedClosedChildTaskCount: 0,
                        removedClosedChildTaskCount: 0,
                    },
                },
            ]).sort((a, b) =>
                defaultCompareStrings("taskId" in a ? a.taskId : "", "taskId" in b ? b.taskId : ""),
            ),
        );

        expect(
            (
                await commitTaskActionTransaction(context.action(session1), space.id, [
                    {
                        type: "UpdateTask",
                        time: clock.now(),
                        taskId: taskId3,
                        taskAction: {
                            type: "UpdateParentTaskId",
                            parentTaskId: parentTaskId2,
                        },
                    },
                ])
            ).extraActions
                .slice()
                .sort((a, b) =>
                    defaultCompareStrings(
                        "taskId" in a ? a.taskId : "",
                        "taskId" in b ? b.taskId : "",
                    ),
                ),
        ).toEqual(
            cast<Array<TaskAction>>([
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTaskId1,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 4,
                        removedChildTaskCount: 2,
                        addedClosedChildTaskCount: 0,
                        removedClosedChildTaskCount: 0,
                    },
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTaskId2,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 2,
                        removedChildTaskCount: 1,
                        addedClosedChildTaskCount: 0,
                        removedClosedChildTaskCount: 0,
                    },
                },
            ]).sort((a, b) =>
                defaultCompareStrings("taskId" in a ? a.taskId : "", "taskId" in b ? b.taskId : ""),
            ),
        );

        const actionTime1 = clock.now();

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: actionTime1,
                    taskId: taskId2,
                    taskAction: {
                        type: "UpdateStatus",
                        status: {
                            type: "Closed",
                            closerId: session1.accountId,
                            closedTime: new TaskFilterableTime({
                                absoluteTime: actionTime1,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTaskId1,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 4,
                        removedChildTaskCount: 2,
                        addedClosedChildTaskCount: 1,
                        removedClosedChildTaskCount: 0,
                    },
                },
            ]),
        });

        const actionTime2 = clock.now();

        expect(
            await commitTaskActionTransaction(context.action(session1), space.id, [
                {
                    type: "UpdateTask",
                    time: actionTime2,
                    taskId: taskId3,
                    taskAction: {
                        type: "UpdateStatus",
                        status: {
                            type: "Closed",
                            closerId: session1.accountId,
                            closedTime: new TaskFilterableTime({
                                absoluteTime: actionTime2,
                                setterTimeZone: defaultTimeZone,
                            }),
                        },
                    },
                },
            ]),
        ).toMatchObject({
            extraActions: cast<Array<TaskAction>>([
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTaskId2,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 2,
                        removedChildTaskCount: 1,
                        addedClosedChildTaskCount: 1,
                        removedClosedChildTaskCount: 0,
                    },
                },
            ]),
        });

        expect(
            (
                await commitTaskActionTransaction(context.action(session1), space.id, [
                    {
                        type: "UpdateTask",
                        time: clock.now(),
                        taskId: taskId2,
                        taskAction: {
                            type: "UpdateParentTaskId",
                            parentTaskId: parentTaskId2,
                        },
                    },
                ])
            ).extraActions
                .slice()
                .sort((a, b) =>
                    defaultCompareStrings(
                        "taskId" in a ? a.taskId : "",
                        "taskId" in b ? b.taskId : "",
                    ),
                ),
        ).toEqual(
            cast<Array<TaskAction>>([
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTaskId1,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 4,
                        removedChildTaskCount: 3,
                        addedClosedChildTaskCount: 1,
                        removedClosedChildTaskCount: 1,
                    },
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTaskId2,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 3,
                        removedChildTaskCount: 1,
                        addedClosedChildTaskCount: 2,
                        removedClosedChildTaskCount: 0,
                    },
                },
            ]).sort((a, b) =>
                defaultCompareStrings("taskId" in a ? a.taskId : "", "taskId" in b ? b.taskId : ""),
            ),
        );

        expect(
            (
                await commitTaskActionTransaction(context.action(session1), space.id, [
                    {
                        type: "UpdateTask",
                        time: clock.now(),
                        taskId: taskId1,
                        taskAction: {
                            type: "UpdateParentTaskId",
                            parentTaskId: parentTaskId2,
                        },
                    },
                ])
            ).extraActions
                .slice()
                .sort((a, b) =>
                    defaultCompareStrings(
                        "taskId" in a ? a.taskId : "",
                        "taskId" in b ? b.taskId : "",
                    ),
                ),
        ).toEqual(
            cast<Array<TaskAction>>([
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTaskId1,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 4,
                        removedChildTaskCount: 4,
                        addedClosedChildTaskCount: 1,
                        removedClosedChildTaskCount: 1,
                    },
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTaskId2,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 4,
                        removedChildTaskCount: 1,
                        addedClosedChildTaskCount: 2,
                        removedClosedChildTaskCount: 0,
                    },
                },
            ]).sort((a, b) =>
                defaultCompareStrings("taskId" in a ? a.taskId : "", "taskId" in b ? b.taskId : ""),
            ),
        );

        expect(
            (
                await commitTaskActionTransaction(context.action(session1), space.id, [
                    {
                        type: "UpdateTask",
                        time: clock.now(),
                        taskId: taskId3,
                        taskAction: {
                            type: "UpdateParentTaskId",
                            parentTaskId: parentTaskId1,
                        },
                    },
                ])
            ).extraActions
                .slice()
                .sort((a, b) =>
                    defaultCompareStrings(
                        "taskId" in a ? a.taskId : "",
                        "taskId" in b ? b.taskId : "",
                    ),
                ),
        ).toEqual(
            cast<Array<TaskAction>>([
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTaskId1,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 5,
                        removedChildTaskCount: 4,
                        addedClosedChildTaskCount: 2,
                        removedClosedChildTaskCount: 1,
                    },
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTaskId2,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 4,
                        removedChildTaskCount: 2,
                        addedClosedChildTaskCount: 2,
                        removedClosedChildTaskCount: 1,
                    },
                },
            ]).sort((a, b) =>
                defaultCompareStrings("taskId" in a ? a.taskId : "", "taskId" in b ? b.taskId : ""),
            ),
        );

        expect(
            (
                await commitTaskActionTransaction(context.action(session1), space.id, [
                    {
                        type: "UpdateTask",
                        time: clock.now(),
                        taskId: taskId3,
                        taskAction: {
                            type: "UpdateParentTaskId",
                            parentTaskId: parentTaskId2,
                        },
                    },
                ])
            ).extraActions
                .slice()
                .sort((a, b) =>
                    defaultCompareStrings(
                        "taskId" in a ? a.taskId : "",
                        "taskId" in b ? b.taskId : "",
                    ),
                ),
        ).toEqual(
            cast<Array<TaskAction>>([
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTaskId1,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 5,
                        removedChildTaskCount: 5,
                        addedClosedChildTaskCount: 2,
                        removedClosedChildTaskCount: 2,
                    },
                },
                {
                    type: "UpdateTask",
                    time: expect.any(Array),
                    taskId: parentTaskId2,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: 5,
                        removedChildTaskCount: 2,
                        addedClosedChildTaskCount: 3,
                        removedClosedChildTaskCount: 1,
                    },
                },
            ]).sort((a, b) =>
                defaultCompareStrings("taskId" in a ? a.taskId : "", "taskId" in b ? b.taskId : ""),
            ),
        );
    });
});
